// Stocktake domain: a counting session that surfaces discrepancies live and
// ends in a sign-off that is blocked until every discrepancy carries a
// resolution or an annotation — the control the auditors asked for.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/server/audit";
import { AuthzError, can, type SessionUser } from "@/server/authz";
import { adjustQuantity, DomainError } from "@/server/inventory";

export async function startStocktake(user: SessionUser, labId: string) {
  if (!can(user, "start_stocktake", labId)) throw new AuthzError("denied", "start_stocktake");
  const existing = await prisma.stocktakeSession.findFirst({
    where: { labId, status: { in: ["OPEN", "PAUSED", "AWAITING_SIGNOFF"] } },
  });
  if (existing) throw new DomainError("A stocktake for this lab is already in progress");

  return prisma.$transaction(async (tx) => {
    const session = await tx.stocktakeSession.create({ data: { labId, startedById: user.id } });
    await writeAuditEvent(tx, {
      eventType: "stocktake.started",
      actorId: user.id,
      entityType: "stocktake",
      entityId: session.id,
      payload: { labId },
    });
    return session;
  });
}

/**
 * Record one scan. Classification:
 *  - unknown code                     -> UNEXPECTED (no container link)
 *  - container from another lab      -> UNEXPECTED (with Claim action)
 *  - counted != system quantity      -> MISMATCH
 *  - matched but past expiry         -> EXPIRED
 *  - otherwise                       -> NONE (match)
 */
export async function recordScan(
  user: SessionUser,
  sessionId: string,
  scannedCode: string,
  countedQuantity: number | null,
) {
  const session = await prisma.stocktakeSession.findUnique({ where: { id: sessionId } });
  if (!session || (session.status !== "OPEN" && session.status !== "PAUSED")) {
    throw new DomainError("Session is not open for counting");
  }
  if (!can(user, "start_stocktake", session.labId)) throw new AuthzError("denied", "stocktake_scan");

  const container = await prisma.container.findUnique({
    where: { code: scannedCode },
    include: { substance: { select: { name: true } } },
  });

  let discrepancy: "NONE" | "MISMATCH" | "UNEXPECTED" | "EXPIRED" = "NONE";
  if (!container || container.labId !== session.labId) discrepancy = "UNEXPECTED";
  else if (
    countedQuantity !== null &&
    Math.abs(countedQuantity - container.currentQuantity.toNumber()) > 1e-9
  )
    discrepancy = "MISMATCH";
  else if (container.expiryDate && container.expiryDate < new Date()) discrepancy = "EXPIRED";

  return prisma.stocktakeCount.upsert({
    where: { sessionId_scannedCode: { sessionId, scannedCode } },
    update: {
      countedQuantity: countedQuantity === null ? null : new Prisma.Decimal(countedQuantity),
      discrepancy,
      countedById: user.id,
      countedAt: new Date(),
    },
    create: {
      sessionId,
      scannedCode,
      containerId: container && container.labId === session.labId ? container.id : container?.id ?? null,
      locationId: container?.locationId ?? null,
      countedQuantity: countedQuantity === null ? null : new Prisma.Decimal(countedQuantity),
      countedById: user.id,
      discrepancy,
    },
  });
}

/** Resolve a MISMATCH by correcting the system quantity (audited CORRECT). */
export async function resolveByCorrection(
  user: SessionUser,
  countId: string,
  witnessId?: string,
) {
  const count = await prisma.stocktakeCount.findUnique({
    where: { id: countId },
    include: { session: true },
  });
  if (!count?.containerId || count.countedQuantity === null) {
    throw new DomainError("Nothing to correct on this row");
  }
  await adjustQuantity({
    user,
    containerId: count.containerId,
    mode: "CORRECT",
    amount: count.countedQuantity.toNumber(),
    reason: `Stocktake ${count.sessionId.slice(-8)}`,
    witnessId,
  });
  await prisma.stocktakeCount.update({
    where: { id: countId },
    data: { resolution: "CORRECTED" },
  });
}

/** Claim a foreign container found on this lab's shelf — repatriation. */
export async function claimForeignContainer(user: SessionUser, countId: string) {
  const count = await prisma.stocktakeCount.findUnique({
    where: { id: countId },
    include: { session: true },
  });
  if (!count?.containerId || count.discrepancy !== "UNEXPECTED") {
    throw new DomainError("Only unexpected containers can be claimed");
  }
  if (!can(user, "start_stocktake", count.session.labId)) throw new AuthzError("denied", "claim");

  await prisma.$transaction(async (tx) => {
    const container = await tx.container.findUniqueOrThrow({ where: { id: count.containerId! } });
    await tx.container.update({
      where: { id: container.id },
      data: { labId: count.session.labId, custodianId: user.id, locationId: count.locationId },
    });
    await writeAuditEvent(tx, {
      eventType: "container.claimed",
      actorId: user.id,
      entityType: "container",
      entityId: container.id,
      payload: {
        containerCode: container.code,
        fromLab: container.labId,
        toLab: count.session.labId,
        reason: `Found during stocktake ${count.sessionId.slice(-8)}`,
      },
    });
    await tx.stocktakeCount.update({ where: { id: countId }, data: { resolution: "CLAIMED" } });
  });
}

export async function annotateCount(user: SessionUser, countId: string, note: string) {
  if (!note.trim()) throw new DomainError("Annotation cannot be empty");
  const count = await prisma.stocktakeCount.findUnique({
    where: { id: countId },
    include: { session: true },
  });
  if (!count) throw new DomainError("Row not found");
  if (!can(user, "start_stocktake", count.session.labId)) throw new AuthzError("denied", "annotate");
  await prisma.stocktakeCount.update({
    where: { id: countId },
    data: { resolution: "ANNOTATED", note },
  });
}

/**
 * Submit for sign-off: generates MISSING rows for expected-but-unscanned
 * containers, then blocks sign-off until every discrepancy is handled.
 */
export async function submitForSignOff(user: SessionUser, sessionId: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    include: { counts: true },
  });
  if (!session || session.status !== "OPEN") throw new DomainError("Session is not open");
  if (!can(user, "start_stocktake", session.labId)) throw new AuthzError("denied", "submit");

  const expected = await prisma.container.findMany({
    where: { labId: session.labId, status: "ACTIVE" },
    select: { id: true, code: true, locationId: true },
  });
  const scanned = new Set(session.counts.map((c) => c.scannedCode));

  await prisma.$transaction(async (tx) => {
    for (const c of expected) {
      if (!scanned.has(c.code)) {
        await tx.stocktakeCount.upsert({
          where: { sessionId_scannedCode: { sessionId, scannedCode: c.code } },
          update: {},
          create: {
            sessionId,
            scannedCode: c.code,
            containerId: c.id,
            locationId: c.locationId,
            countedById: user.id,
            countedQuantity: null,
            discrepancy: "MISSING",
          },
        });
      }
    }
    await tx.stocktakeSession.update({
      where: { id: sessionId },
      data: { status: "AWAITING_SIGNOFF" },
    });
    await writeAuditEvent(tx, {
      eventType: "stocktake.submitted",
      actorId: user.id,
      entityType: "stocktake",
      entityId: sessionId,
      payload: { expected: expected.length, scanned: scanned.size },
    });
  });
}

export async function signOffStocktake(user: SessionUser, sessionId: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    include: { counts: true },
  });
  if (!session || session.status !== "AWAITING_SIGNOFF") {
    throw new DomainError("Session is not awaiting sign-off");
  }
  if (!can(user, "sign_off_stocktake", session.labId)) {
    throw new AuthzError("denied", "sign_off_stocktake");
  }

  const unresolved = session.counts.filter(
    (c) => c.discrepancy !== "NONE" && c.resolution === null,
  );
  if (unresolved.length > 0) {
    throw new DomainError(
      `${unresolved.length} discrepanc${unresolved.length === 1 ? "y" : "ies"} must be resolved or annotated before sign-off`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Missing containers annotated (not corrected) are marked MISSING.
    for (const c of session.counts) {
      if (c.discrepancy === "MISSING" && c.resolution === "ANNOTATED" && c.containerId) {
        await tx.container.update({ where: { id: c.containerId }, data: { status: "MISSING" } });
      }
    }
    await tx.stocktakeSession.update({
      where: { id: sessionId },
      data: { status: "SIGNED_OFF", signedOffById: user.id, signedOffAt: new Date() },
    });
    await writeAuditEvent(tx, {
      eventType: "stocktake.signed_off",
      actorId: user.id,
      entityType: "stocktake",
      entityId: sessionId,
      payload: {
        counts: session.counts.length,
        discrepancies: session.counts.filter((c) => c.discrepancy !== "NONE").length,
      },
    });
  });
}
