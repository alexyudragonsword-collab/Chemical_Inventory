"use server";

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";
import { verifyAuditChain } from "../../../../../scripts/verify-audit-chain";

export async function verifyChainAction(): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  if (!can(user, "view_audit")) return { ok: false, message: "Not authorized" };

  const result = await verifyAuditChain(prisma as PrismaClient);
  return result.ok
    ? { ok: true, message: `Hash chain verified — ${result.checked} events intact.` }
    : { ok: false, message: `CHAIN BROKEN at seq ${result.firstBreakSeq}: ${result.detail}` };
}
