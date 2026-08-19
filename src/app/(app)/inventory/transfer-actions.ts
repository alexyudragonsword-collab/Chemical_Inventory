"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/server/audit";
import { requireUser } from "@/server/session";

export type SimpleResult = { ok: boolean; error?: string };

/** Ask the custodian of an out-of-scope container for a transfer. */
export async function requestTransferAction(
  containerId: string,
  message?: string,
): Promise<SimpleResult> {
  const user = await requireUser();
  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: { id: true, code: true, custodianId: true, status: true },
  });
  if (!container) return { ok: false, error: "Container not found" };
  if (container.custodianId === user.id) return { ok: false, error: "Already in your custody" };
  if (container.status !== "ACTIVE") return { ok: false, error: "Container is not active" };

  const existing = await prisma.transferRequest.findFirst({
    where: { containerId, requesterId: user.id, status: "PENDING" },
  });
  if (existing) return { ok: false, error: "You already have a pending request for this container" };

  await prisma.$transaction(async (tx) => {
    const request = await tx.transferRequest.create({
      data: {
        containerId,
        requesterId: user.id,
        currentCustodianId: container.custodianId,
        message: message?.trim() || null,
      },
    });
    await writeAuditEvent(tx, {
      eventType: "transfer.requested",
      actorId: user.id,
      entityType: "container",
      entityId: containerId,
      payload: { containerCode: container.code, requestId: request.id, message: message ?? null },
    });
  });

  revalidatePath("/transfers");
  return { ok: true };
}
