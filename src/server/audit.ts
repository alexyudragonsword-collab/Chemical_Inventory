// Hash-chained, append-only audit log.
//
// Every event: hash = sha256(prevHash + "\n" + seq + "\n" + canonicalJson(core))
// where core = {seq, eventType, actorId, onBehalfSystem, entityType, entityId,
// payload, witnessId, createdAt}. Writers serialize on a transaction-scoped
// advisory lock so `seq` stays dense with no forks; unique constraints on seq
// and prevHash are belt-and-braces. The table itself rejects UPDATE/DELETE via
// a trigger (see the audit_append_only migration).

import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export const GENESIS_HASH = "chemtrack-genesis-2026";

/** Advisory lock key reserved for audit chain writes. */
const AUDIT_LOCK_KEY = 42;

type Tx = Prisma.TransactionClient | PrismaClient;

/** Deterministic JSON: object keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function computeEventHash(input: {
  prevHash: string;
  seq: bigint;
  eventType: string;
  actorId: string | null;
  onBehalfSystem: boolean;
  entityType: string;
  entityId: string;
  payload: unknown;
  witnessId: string | null;
  createdAtIso: string;
}): string {
  const core = canonicalJson({
    seq: input.seq.toString(),
    eventType: input.eventType,
    actorId: input.actorId,
    onBehalfSystem: input.onBehalfSystem,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload,
    witnessId: input.witnessId,
    createdAt: input.createdAtIso,
  });
  return createHash("sha256")
    .update(input.prevHash + "\n" + input.seq.toString() + "\n" + core)
    .digest("hex");
}

export type WitnessRule = {
  /** Container is a controlled/licensed substance. */
  controlled?: boolean;
  /** Quantity correction whose relative change exceeds the witness threshold. */
  correctionExceedsThreshold?: boolean;
};

export class WitnessRequiredError extends Error {
  constructor(reason: string) {
    super(`Witness signature required: ${reason}`);
    this.name = "WitnessRequiredError";
  }
}

export type AuditEventInput = {
  eventType: string;
  actorId?: string | null;
  onBehalfSystem?: boolean;
  entityType: string;
  entityId: string;
  payload: Prisma.InputJsonValue;
  witnessId?: string | null;
  witnessRule?: WitnessRule;
};

/**
 * Append one event to the chain. MUST be called inside the caller's
 * transaction so the business change and its audit record commit atomically.
 * Throws WitnessRequiredError when the rule demands a witness and none (or the
 * actor themselves) is supplied — rolling back the whole transaction.
 */
export async function writeAuditEvent(tx: Tx, input: AuditEventInput) {
  const actorId = input.actorId ?? null;
  const witnessId = input.witnessId ?? null;

  if (input.witnessRule?.controlled && !witnessId) {
    throw new WitnessRequiredError("controlled substance");
  }
  if (input.witnessRule?.correctionExceedsThreshold && !witnessId) {
    throw new WitnessRequiredError("correction above threshold");
  }
  if (witnessId && witnessId === actorId) {
    throw new WitnessRequiredError("witness must be a different person");
  }

  // Serialize chain writers for the rest of this transaction.
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);

  const last = await tx.auditEvent.findFirst({
    orderBy: { seq: "desc" },
    select: { seq: true, hash: true },
  });
  const seq = (last?.seq ?? 0n) + 1n;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const createdAt = new Date();

  const hash = computeEventHash({
    prevHash,
    seq,
    eventType: input.eventType,
    actorId,
    onBehalfSystem: input.onBehalfSystem ?? false,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload,
    witnessId,
    createdAtIso: createdAt.toISOString(),
  });

  return tx.auditEvent.create({
    data: {
      seq,
      eventType: input.eventType,
      actorId,
      onBehalfSystem: input.onBehalfSystem ?? false,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload,
      witnessId,
      prevHash,
      hash,
      createdAt,
    },
  });
}

/** Witness threshold for stocktake corrections (deck: 20%). */
export const CORRECTION_WITNESS_THRESHOLD = 0.2;

export function correctionNeedsWitness(before: number, after: number): boolean {
  if (before === 0) return after !== 0;
  return Math.abs(after - before) / Math.abs(before) > CORRECTION_WITNESS_THRESHOLD;
}
