// Walk the entire audit chain and recompute every hash.
// Exits non-zero on the first break. Also exposed to the audit viewer's
// "Verify integrity" button via verifyAuditChain().

import { PrismaClient } from "@prisma/client";
import { GENESIS_HASH, computeEventHash } from "../src/server/audit";

export type ChainVerification = {
  ok: boolean;
  checked: number;
  firstBreakSeq?: string;
  detail?: string;
};

export async function verifyAuditChain(prisma: PrismaClient): Promise<ChainVerification> {
  const BATCH = 500;
  let expectedPrev = GENESIS_HASH;
  let expectedSeq = 1n;
  let checked = 0;
  let cursor: bigint | undefined;

  for (;;) {
    const events = await prisma.auditEvent.findMany({
      orderBy: { seq: "asc" },
      take: BATCH,
      ...(cursor !== undefined ? { skip: 1, cursor: { seq: cursor } } : {}),
    });
    if (events.length === 0) break;

    for (const e of events) {
      if (e.seq !== expectedSeq) {
        return {
          ok: false,
          checked,
          firstBreakSeq: e.seq.toString(),
          detail: `sequence gap: expected ${expectedSeq}, found ${e.seq}`,
        };
      }
      if (e.prevHash !== expectedPrev) {
        return {
          ok: false,
          checked,
          firstBreakSeq: e.seq.toString(),
          detail: `prevHash mismatch at seq ${e.seq}`,
        };
      }
      const recomputed = computeEventHash({
        prevHash: e.prevHash,
        seq: e.seq,
        eventType: e.eventType,
        actorId: e.actorId,
        onBehalfSystem: e.onBehalfSystem,
        entityType: e.entityType,
        entityId: e.entityId,
        payload: e.payload,
        witnessId: e.witnessId,
        createdAtIso: e.createdAt.toISOString(),
      });
      if (recomputed !== e.hash) {
        return {
          ok: false,
          checked,
          firstBreakSeq: e.seq.toString(),
          detail: `hash mismatch at seq ${e.seq}: event content altered`,
        };
      }
      expectedPrev = e.hash;
      expectedSeq = e.seq + 1n;
      checked++;
    }
    cursor = events[events.length - 1].seq;
  }

  return { ok: true, checked };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await verifyAuditChain(prisma);
    if (result.ok) {
      console.log(`Audit chain OK — ${result.checked} events verified.`);
    } else {
      console.error(
        `AUDIT CHAIN BROKEN after ${result.checked} events at seq ${result.firstBreakSeq}: ${result.detail}`,
      );
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run as a CLI only when executed directly.
if (process.argv[1]?.endsWith("verify-audit-chain.ts")) {
  main();
}
