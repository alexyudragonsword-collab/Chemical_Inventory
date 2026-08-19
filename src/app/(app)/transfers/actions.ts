"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/server/audit";
import { AuthzError, authorizeContainer } from "@/server/authz";
import { DomainError, transferCustody } from "@/server/inventory";
import { requireUser } from "@/server/session";

export async function acceptTransferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const requestId = String(formData.get("requestId"));

  const request = await prisma.transferRequest.findUnique({
    where: { id: requestId },
    include: { container: { include: { substance: { select: { isControlled: true } } } } },
  });
  if (!request || request.status !== "PENDING") return;

  const container = request.container;
  const mode = authorizeContainer(user, "approve_transfer", {
    id: container.id,
    labId: container.labId,
    custodianId: container.custodianId,
    isControlled: container.substance.isControlled,
  });
  if (mode !== "editable") return;

  // Receiving lab: the requester's workspace lab if they manage/belong to one.
  const requesterMembership = await prisma.labMembership.findFirst({
    where: { userId: request.requesterId },
    orderBy: { isManager: "desc" },
  });

  try {
    await transferCustody({
      user,
      containerId: container.id,
      toUserId: request.requesterId,
      toLabId: requesterMembership?.labId,
      reason: `Transfer request ${request.id.slice(-6)} accepted`,
      requestId: request.id,
    });
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthzError) {
      return;
    }
    throw error;
  }

  await prisma.transferRequest.update({
    where: { id: request.id },
    data: { status: "ACCEPTED", resolvedAt: new Date() },
  });
  revalidatePath("/transfers");
  revalidatePath("/inventory");
  return;
}

export async function declineTransferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const requestId = String(formData.get("requestId"));

  const request = await prisma.transferRequest.findUnique({
    where: { id: requestId },
    include: { container: { include: { substance: { select: { isControlled: true } } } } },
  });
  if (!request || request.status !== "PENDING") return;

  const mode = authorizeContainer(user, "approve_transfer", {
    id: request.container.id,
    labId: request.container.labId,
    custodianId: request.container.custodianId,
    isControlled: request.container.substance.isControlled,
  });
  if (mode !== "editable") return;

  await prisma.$transaction(async (tx) => {
    await tx.transferRequest.update({
      where: { id: request.id },
      data: { status: "DECLINED", resolvedAt: new Date() },
    });
    await writeAuditEvent(tx, {
      eventType: "transfer.declined",
      actorId: user.id,
      entityType: "container",
      entityId: request.containerId,
      payload: { containerCode: request.container.code, requestId: request.id },
    });
  });
  revalidatePath("/transfers");
  return;
}

export async function cancelTransferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const requestId = String(formData.get("requestId"));
  const request = await prisma.transferRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== "PENDING") return;
  if (request.requesterId !== user.id) return;

  await prisma.transferRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED", resolvedAt: new Date() },
  });
  revalidatePath("/transfers");
  return;
}
