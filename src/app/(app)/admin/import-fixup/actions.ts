"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/server/audit";
import { can } from "@/server/authz";
import { normalizeUnit } from "@/server/units";
import { requireUser } from "@/server/session";

async function requireFixupAccess(labId?: string) {
  const user = await requireUser();
  if (!can(user, "resolve_import_fixup", labId)) {
    throw new Error("Not authorized to resolve import corrections");
  }
  return user;
}

/** Remove resolved keys from a container's pendingCorrection payload. */
function withoutKeys(
  pending: Prisma.JsonValue | null,
  keys: string[],
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!pending || typeof pending !== "object" || Array.isArray(pending)) return Prisma.DbNull;
  const next = { ...(pending as Record<string, unknown>) };
  for (const key of keys) delete next[key];
  return Object.keys(next).length ? (next as Prisma.InputJsonValue) : Prisma.DbNull;
}

export async function assignCustodianAction(formData: FormData) {
  const containerId = String(formData.get("containerId"));
  const userId = String(formData.get("userId"));
  if (!userId) return;

  const container = await prisma.container.findUniqueOrThrow({ where: { id: containerId } });
  const actor = await requireFixupAccess(container.labId);
  const custodian = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  await prisma.$transaction(async (tx) => {
    await tx.container.update({
      where: { id: containerId },
      data: {
        custodianId: userId,
        pendingCorrection: withoutKeys(container.pendingCorrection, ["custodian", "pi"]),
      },
    });
    // Membership so the custody rule can see them in the lab.
    await tx.labMembership.upsert({
      where: { userId_labId: { userId, labId: container.labId } },
      update: {},
      create: { userId, labId: container.labId },
    });
    await writeAuditEvent(tx, {
      eventType: "container.fixup",
      actorId: actor.id,
      entityType: "container",
      entityId: containerId,
      payload: {
        containerCode: container.code,
        field: "custodian",
        after: custodian.name,
        reason: "Legacy import correction",
      },
    });
  });
  revalidatePath("/admin/import-fixup");
}

export async function fixLocationAction(formData: FormData) {
  const containerId = String(formData.get("containerId"));
  const locationId = String(formData.get("locationId"));
  if (!locationId) return;

  const container = await prisma.container.findUniqueOrThrow({ where: { id: containerId } });
  const actor = await requireFixupAccess(container.labId);
  const location = await prisma.storageLocation.findUniqueOrThrow({ where: { id: locationId } });

  await prisma.$transaction(async (tx) => {
    await tx.container.update({
      where: { id: containerId },
      data: {
        locationId,
        pendingCorrection: withoutKeys(container.pendingCorrection, ["rawLocation"]),
      },
    });
    await writeAuditEvent(tx, {
      eventType: "container.fixup",
      actorId: actor.id,
      entityType: "container",
      entityId: containerId,
      payload: {
        containerCode: container.code,
        field: "location",
        after: location.code,
        reason: "Legacy import correction",
      },
    });
  });
  revalidatePath("/admin/import-fixup");
}

export async function fixUnitAction(formData: FormData) {
  const containerId = String(formData.get("containerId"));
  const rawUnit = String(formData.get("unit"));
  const quantityRaw = formData.get("quantity");

  const unit = normalizeUnit(rawUnit);
  if (!unit) return;

  const container = await prisma.container.findUniqueOrThrow({ where: { id: containerId } });
  const actor = await requireFixupAccess(container.labId);
  const quantity =
    quantityRaw !== null && String(quantityRaw).trim() !== ""
      ? Number(quantityRaw)
      : container.currentQuantity.toNumber();
  if (!Number.isFinite(quantity) || quantity < 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.container.update({
      where: { id: containerId },
      data: {
        unit,
        currentQuantity: new Prisma.Decimal(quantity),
        initialQuantity: new Prisma.Decimal(quantity),
        pendingCorrection: withoutKeys(container.pendingCorrection, ["unit", "quantity"]),
      },
    });
    await writeAuditEvent(tx, {
      eventType: "container.fixup",
      actorId: actor.id,
      entityType: "container",
      entityId: containerId,
      payload: {
        containerCode: container.code,
        field: "unit",
        before: `${container.currentQuantity} ${container.unit}`,
        after: `${quantity} ${unit}`,
        reason: "Legacy import correction",
      },
    });
  });
  revalidatePath("/admin/import-fixup");
}

export async function setCasAction(formData: FormData) {
  const substanceId = String(formData.get("substanceId"));
  const cas = String(formData.get("cas")).trim();
  if (!/^\d{2,7}-\d{2}-\d$/.test(cas)) return;

  const actor = await requireFixupAccess();
  const substance = await prisma.substance.findUniqueOrThrow({ where: { id: substanceId } });

  await prisma.$transaction(async (tx) => {
    await tx.substance.update({
      where: { id: substanceId },
      data: { casNumber: cas, needsCasEnrichment: false },
    });
    await writeAuditEvent(tx, {
      eventType: "substance.fixup",
      actorId: actor.id,
      entityType: "substance",
      entityId: substanceId,
      payload: { substance: substance.name, field: "casNumber", after: cas },
    });
  });
  revalidatePath("/admin/import-fixup");
}
