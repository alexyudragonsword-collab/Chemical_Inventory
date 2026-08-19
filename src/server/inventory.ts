// Inventory domain functions. Each takes an authorized SessionUser, runs in
// one transaction with its audit event, and never trusts client-computed
// modes or resulting quantities.

import { Prisma, TransactionKind, type CanonicalUnit } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  correctionNeedsWitness,
  writeAuditEvent,
  WitnessRequiredError,
} from "@/server/audit";
import { AuthzError, authorizeContainer, type SessionUser } from "@/server/authz";

export const REVERSAL_WINDOW_MINUTES = 15;

export type AdjustMode = "DEDUCT" | "ADD" | "CORRECT";

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * Verify a witness signature: an active, different user confirming with their
 * own password. Returns the witness user id.
 */
export async function verifyWitness(
  actorId: string,
  witnessEmail: string,
  witnessPassword: string,
): Promise<string> {
  const witness = await prisma.user.findUnique({
    where: { email: witnessEmail.toLowerCase().trim() },
  });
  if (!witness || !witness.isActive || !witness.passwordHash) {
    throw new DomainError("Witness account not found or inactive");
  }
  if (witness.id === actorId) {
    throw new WitnessRequiredError("witness must be a different person");
  }
  const ok = await bcrypt.compare(witnessPassword, witness.passwordHash);
  if (!ok) throw new DomainError("Witness password incorrect");
  return witness.id;
}

async function loadContainerForUpdate(tx: Prisma.TransactionClient, containerId: string) {
  const container = await tx.container.findUnique({
    where: { id: containerId },
    include: { substance: { select: { id: true, name: true, isControlled: true } } },
  });
  if (!container) throw new DomainError("Container not found");
  return container;
}

function toAuthz(container: {
  id: string;
  labId: string;
  custodianId: string | null;
  substance: { isControlled: boolean };
}) {
  return {
    id: container.id,
    labId: container.labId,
    custodianId: container.custodianId,
    isControlled: container.substance.isControlled,
  };
}

/**
 * The one dialog's three modes: deduct, add, correct count.
 * Correction is a distinct audit event kind — it records a discrepancy, not a
 * use — and needs a witness above the 20% threshold.
 */
export async function adjustQuantity(opts: {
  user: SessionUser;
  containerId: string;
  mode: AdjustMode;
  /** For DEDUCT/ADD: the delta. For CORRECT: the newly counted quantity. */
  amount: number;
  reason: string;
  projectCode?: string;
  witnessId?: string;
  /** Extra context recorded in the audit payload (e.g. fume hood, checklist). */
  context?: Record<string, unknown>;
}) {
  const { user, containerId, mode, amount, reason } = opts;
  if (!reason.trim()) throw new DomainError("Purpose/reason is required");
  if (!(amount > 0) && mode !== "CORRECT") throw new DomainError("Amount must be positive");
  if (amount < 0) throw new DomainError("Quantity cannot be negative");

  // Authorize BEFORE the mutation transaction: a denied attempt must itself be
  // audited, and that event has to survive the rollback of the business change
  // (deck: "denied attempts are logged too").
  {
    const container = await loadContainerForUpdate(prisma, containerId);
    const action = mode === "DEDUCT" ? "deduct" : mode === "ADD" ? "add" : "correct";
    const accessMode = authorizeContainer(user, action, toAuthz(container));
    if (accessMode !== "editable") {
      await prisma.$transaction(async (tx) => {
        await writeAuditEvent(tx, {
          eventType: "auth.denied",
          actorId: user.id,
          entityType: "container",
          entityId: container.id,
          payload: { action, mode: accessMode, containerCode: container.code },
        });
      });
      throw new AuthzError(accessMode, action);
    }
  }

  return prisma.$transaction(async (tx) => {
    const container = await loadContainerForUpdate(tx, containerId);
    // Re-check inside the transaction: custody may have changed between the
    // pre-flight read and the serialized write.
    const action = mode === "DEDUCT" ? "deduct" : mode === "ADD" ? "add" : "correct";
    const mode_ = authorizeContainer(user, action, toAuthz(container));
    if (mode_ !== "editable") throw new AuthzError(mode_, action);
    if (container.status !== "ACTIVE" && container.status !== "EMPTY") {
      throw new DomainError(`Container is ${container.status.toLowerCase()}`);
    }

    const before = container.currentQuantity.toNumber();
    let after: number;
    switch (mode) {
      case "DEDUCT":
        after = before - amount;
        if (after < 0) throw new DomainError("Cannot deduct more than remaining quantity");
        break;
      case "ADD":
        after = before + amount;
        break;
      case "CORRECT":
        after = amount;
        break;
    }

    const witnessRule = {
      controlled: container.substance.isControlled,
      correctionExceedsThreshold: mode === "CORRECT" && correctionNeedsWitness(before, after),
    };

    const kind: TransactionKind =
      mode === "DEDUCT" ? "DEDUCT" : mode === "ADD" ? "ADD" : "CORRECT";

    const event = await writeAuditEvent(tx, {
      eventType: `container.${kind.toLowerCase()}`,
      actorId: user.id,
      entityType: "container",
      entityId: container.id,
      witnessId: opts.witnessId ?? null,
      witnessRule,
      payload: {
        containerCode: container.code,
        substance: container.substance.name,
        before,
        after,
        unit: container.unit,
        reason,
        projectCode: opts.projectCode ?? null,
        ...(opts.context ?? {}),
      },
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        auditEventId: event.id,
        containerId: container.id,
        kind,
        quantityBefore: new Prisma.Decimal(before),
        quantityAfter: new Prisma.Decimal(after),
        unit: container.unit,
        reason,
        projectCode: opts.projectCode ?? null,
        reversibleUntil: new Date(Date.now() + REVERSAL_WINDOW_MINUTES * 60_000),
      },
    });

    await tx.container.update({
      where: { id: container.id },
      data: {
        currentQuantity: new Prisma.Decimal(after),
        status: after === 0 ? "EMPTY" : "ACTIVE",
        openedAt: container.openedAt ?? (mode === "DEDUCT" ? new Date() : undefined),
      },
    });

    return { transactionId: transaction.id, before, after, unit: container.unit };
  });
}

/** Move custody of a container to another user (and their lab, if given). */
export async function transferCustody(opts: {
  user: SessionUser;
  containerId: string;
  toUserId: string;
  toLabId?: string;
  reason: string;
  requestId?: string;
  witnessId?: string;
}) {
  const { user, containerId, toUserId, reason } = opts;
  if (!reason.trim()) throw new DomainError("Reason is required");

  return prisma.$transaction(async (tx) => {
    const container = await loadContainerForUpdate(tx, containerId);
    const mode = authorizeContainer(user, "transfer", toAuthz(container));
    if (mode !== "editable") throw new AuthzError(mode, "transfer");

    const toUser = await tx.user.findUnique({ where: { id: toUserId } });
    if (!toUser || !toUser.isActive) throw new DomainError("Receiving user not found or inactive");

    const toLabId = opts.toLabId ?? container.labId;
    const movingLabs = toLabId !== container.labId;

    await writeAuditEvent(tx, {
      eventType: "container.transfer",
      actorId: user.id,
      entityType: "container",
      entityId: container.id,
      witnessId: opts.witnessId ?? null,
      witnessRule: { controlled: container.substance.isControlled },
      payload: {
        containerCode: container.code,
        from: container.custodianId,
        to: toUserId,
        fromLab: container.labId,
        toLab: toLabId,
        reason,
        requestId: opts.requestId ?? null,
      },
    });

    await tx.container.update({
      where: { id: container.id },
      data: {
        custodianId: toUserId,
        labId: toLabId,
        // A container that changes lab loses its shelf until re-assigned.
        locationId: movingLabs ? null : container.locationId,
      },
    });
    await tx.labMembership.upsert({
      where: { userId_labId: { userId: toUserId, labId: toLabId } },
      update: {},
      create: { userId: toUserId, labId: toLabId },
    });

    return { toUserName: toUser.name };
  });
}

/** Formal disposal: quantity to zero, status DISPOSED, container stays on record. */
export async function disposeContainer(opts: {
  user: SessionUser;
  containerId: string;
  reason: string;
  wasteStream?: string;
  witnessId?: string;
}) {
  const { user, containerId, reason } = opts;
  if (!reason.trim()) throw new DomainError("Reason is required");

  return prisma.$transaction(async (tx) => {
    const container = await loadContainerForUpdate(tx, containerId);
    const mode = authorizeContainer(user, "dispose", toAuthz(container));
    if (mode !== "editable") throw new AuthzError(mode, "dispose");
    if (container.status === "DISPOSED") throw new DomainError("Already disposed");

    const before = container.currentQuantity.toNumber();
    const event = await writeAuditEvent(tx, {
      eventType: "container.dispose",
      actorId: user.id,
      entityType: "container",
      entityId: container.id,
      witnessId: opts.witnessId ?? null,
      witnessRule: { controlled: container.substance.isControlled },
      payload: {
        containerCode: container.code,
        substance: container.substance.name,
        before,
        after: 0,
        unit: container.unit,
        reason,
        wasteStream: opts.wasteStream ?? null,
      },
    });
    await tx.inventoryTransaction.create({
      data: {
        auditEventId: event.id,
        containerId: container.id,
        kind: "DISPOSE",
        quantityBefore: new Prisma.Decimal(before),
        quantityAfter: new Prisma.Decimal(0),
        unit: container.unit,
        reason,
      },
    });
    await tx.container.update({
      where: { id: container.id },
      data: { currentQuantity: new Prisma.Decimal(0), status: "DISPOSED" },
    });
  });
}

/**
 * Compensating reversal of a recent transaction (fat-finger cover, deck: 15
 * minutes). Never mutates the original record — appends a REVERSAL.
 */
export async function reverseTransaction(opts: {
  user: SessionUser;
  transactionId: string;
}) {
  const { user, transactionId } = opts;

  return prisma.$transaction(async (tx) => {
    const original = await tx.inventoryTransaction.findUnique({
      where: { id: transactionId },
      include: { auditEvent: true, reverses: true },
    });
    if (!original) throw new DomainError("Transaction not found");
    if (original.kind === "REVERSAL") throw new DomainError("Cannot reverse a reversal");
    if (original.reversedById) throw new DomainError("Already reversed");
    if (!original.reversibleUntil || original.reversibleUntil < new Date()) {
      throw new DomainError("Reversal window has closed");
    }
    if (original.auditEvent.actorId !== user.id) {
      throw new DomainError("Only the person who recorded the change can reverse it");
    }

    const container = await loadContainerForUpdate(tx, original.containerId);
    const mode = authorizeContainer(user, "correct", toAuthz(container));
    if (mode !== "editable") throw new AuthzError(mode, "reverse");

    const current = container.currentQuantity.toNumber();
    const delta = original.quantityAfter.toNumber() - original.quantityBefore.toNumber();
    const after = current - delta;
    if (after < 0) throw new DomainError("Reversal would make quantity negative");

    const event = await writeAuditEvent(tx, {
      eventType: "container.reversal",
      actorId: user.id,
      entityType: "container",
      entityId: container.id,
      payload: {
        containerCode: container.code,
        reversedTransactionId: original.id,
        before: current,
        after,
        unit: container.unit,
        reason: `Reversal of ${original.kind.toLowerCase()} (${original.reason})`,
      },
    });

    const reversal = await tx.inventoryTransaction.create({
      data: {
        auditEventId: event.id,
        containerId: container.id,
        kind: "REVERSAL",
        quantityBefore: new Prisma.Decimal(current),
        quantityAfter: new Prisma.Decimal(after),
        unit: container.unit,
        reason: `Reversal of ${original.id}`,
      },
    });

    await tx.inventoryTransaction.update({
      where: { id: original.id },
      data: { reversedById: reversal.id },
    });
    await tx.container.update({
      where: { id: container.id },
      data: {
        currentQuantity: new Prisma.Decimal(after),
        status: after === 0 ? "EMPTY" : "ACTIVE",
      },
    });

    return { before: current, after, unit: container.unit as CanonicalUnit };
  });
}
