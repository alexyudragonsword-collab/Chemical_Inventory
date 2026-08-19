"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sweepAlerts } from "@/server/alerts";
import { writeAuditEvent } from "@/server/audit";
import { authorizeContainer, can } from "@/server/authz";
import { requireUser } from "@/server/session";

export async function refreshAlertsAction() {
  await requireUser();
  await sweepAlerts(prisma);
  revalidatePath("/safety/alerts");
}

export async function snoozeAlertAction(formData: FormData) {
  const user = await requireUser();
  const alertId = String(formData.get("alertId"));
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return;
  if (!can(user, "manage_alert_rules", alert.labId ?? undefined) && alert.labId) {
    // Custodians may snooze alerts on their own containers.
    if (alert.containerId) {
      const container = await prisma.container.findUnique({
        where: { id: alert.containerId },
        include: { substance: { select: { isControlled: true } } },
      });
      if (
        !container ||
        authorizeContainer(user, "deduct", {
          id: container.id,
          labId: container.labId,
          custodianId: container.custodianId,
          isControlled: container.substance.isControlled,
        }) !== "editable"
      )
        return;
    } else return;
  }
  await prisma.alert.update({
    where: { id: alertId },
    data: { status: "SNOOZED", snoozedUntil: new Date(Date.now() + 7 * 86_400_000) },
  });
  revalidatePath("/safety/alerts");
}

export async function dismissAlertAction(formData: FormData) {
  const user = await requireUser();
  const alertId = String(formData.get("alertId"));
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return;
  if (!can(user, "manage_alert_rules", alert.labId ?? undefined)) return;
  await prisma.$transaction(async (tx) => {
    await tx.alert.update({ where: { id: alertId }, data: { status: "DISMISSED" } });
    await writeAuditEvent(tx, {
      eventType: "alert.dismissed",
      actorId: user.id,
      entityType: "alert",
      entityId: alertId,
      payload: { kind: alert.kind, dedupeKey: alert.dedupeKey },
    });
  });
  revalidatePath("/safety/alerts");
}

/** "Use first" — the waste-reducing alternative to disposal (deck, note). */
export async function markUseFirstAction(formData: FormData) {
  const user = await requireUser();
  const containerId = String(formData.get("containerId"));
  const container = await prisma.container.findUnique({
    where: { id: containerId },
    include: { substance: { select: { isControlled: true } } },
  });
  if (!container) return;
  const mode = authorizeContainer(user, "deduct", {
    id: container.id,
    labId: container.labId,
    custodianId: container.custodianId,
    isControlled: container.substance.isControlled,
  });
  if (mode !== "editable") return;
  await prisma.container.update({ where: { id: containerId }, data: { useFirst: true } });
  revalidatePath("/safety/alerts");
  revalidatePath("/inventory");
}

export async function markSdsReadAction(formData: FormData) {
  const user = await requireUser();
  const sdsDocumentId = String(formData.get("sdsDocumentId"));
  await prisma.sdsReadReceipt.upsert({
    where: { sdsDocumentId_userId: { sdsDocumentId, userId: user.id } },
    update: { readAt: new Date() },
    create: { sdsDocumentId, userId: user.id },
  });
  revalidatePath("/safety/sds");
  revalidatePath("/safety/alerts");
}

/** Move a conflicting container to a compatible location (suggested fix). */
export async function moveContainerAction(formData: FormData) {
  const user = await requireUser();
  const containerId = String(formData.get("containerId"));
  const toLocationId = String(formData.get("toLocationId"));
  if (!toLocationId) return;

  const container = await prisma.container.findUnique({
    where: { id: containerId },
    include: { substance: { select: { name: true, isControlled: true } } },
  });
  if (!container) return;
  const mode = authorizeContainer(user, "transfer", {
    id: container.id,
    labId: container.labId,
    custodianId: container.custodianId,
    isControlled: container.substance.isControlled,
  });
  // EHS may also resolve conflicts even without transfer rights.
  if (mode !== "editable" && user.role !== "EHS_OFFICER") return;

  const location = await prisma.storageLocation.findUnique({ where: { id: toLocationId } });
  if (!location || location.labId !== container.labId) return;

  await prisma.$transaction(async (tx) => {
    await tx.container.update({ where: { id: containerId }, data: { locationId: toLocationId } });
    await writeAuditEvent(tx, {
      eventType: "container.moved",
      actorId: user.id,
      entityType: "container",
      entityId: containerId,
      payload: {
        containerCode: container.code,
        substance: container.substance.name,
        toLocation: location.code,
        reason: "Compatibility conflict resolution",
      },
    });
  });
  revalidatePath("/safety/matrix");
  revalidatePath("/safety/alerts");
}
