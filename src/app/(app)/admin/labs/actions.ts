"use server";

import { revalidatePath } from "next/cache";
import { LocationKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/server/audit";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";

async function requireLabAdmin() {
  const user = await requireUser();
  if (!can(user, "manage_labs")) throw new Error("Admin only");
  return user;
}

export async function createLabAction(formData: FormData): Promise<void> {
  const admin = await requireLabAdmin();
  const siteId = String(formData.get("siteId"));
  const code = String(formData.get("code")).trim();
  const name = String(formData.get("name")).trim();
  if (!siteId || !code || !name) return;
  if (await prisma.lab.findUnique({ where: { code } })) return;

  await prisma.$transaction(async (tx) => {
    const lab = await tx.lab.create({ data: { siteId, code, name } });
    await tx.alertThresholdSetting.create({ data: { labId: lab.id } });
    await writeAuditEvent(tx, {
      eventType: "lab.created",
      actorId: admin.id,
      entityType: "lab",
      entityId: lab.id,
      payload: { code, name },
    });
  });
  revalidatePath("/admin/labs");
}

export async function createSiteAction(formData: FormData): Promise<void> {
  await requireLabAdmin();
  const name = String(formData.get("name")).trim();
  if (!name) return;
  await prisma.site.upsert({ where: { name }, update: {}, create: { name } });
  revalidatePath("/admin/labs");
}

export async function createLocationAction(formData: FormData): Promise<void> {
  const admin = await requireLabAdmin();
  const labId = String(formData.get("labId"));
  const parentId = String(formData.get("parentId")) || null;
  const code = String(formData.get("code")).trim();
  const name = String(formData.get("name")).trim() || null;
  const kind = String(formData.get("kind")) as LocationKind;
  const capacity = formData.get("capacity") ? Number(formData.get("capacity")) : null;
  const maxVolumeL = formData.get("maxVolumeL") ? Number(formData.get("maxVolumeL")) : null;
  if (!labId || !code) return;

  await prisma.$transaction(async (tx) => {
    const location = await tx.storageLocation.upsert({
      where: { labId_code: { labId, code } },
      update: { name, kind, capacity, maxVolumeL: maxVolumeL ? new Prisma.Decimal(maxVolumeL) : null, parentId },
      create: {
        labId,
        parentId,
        code,
        name,
        kind,
        capacity,
        maxVolumeL: maxVolumeL ? new Prisma.Decimal(maxVolumeL) : null,
      },
    });
    await writeAuditEvent(tx, {
      eventType: "location.saved",
      actorId: admin.id,
      entityType: "location",
      entityId: location.id,
      payload: { labId, code, kind, capacity, maxVolumeL },
    });
  });
  revalidatePath("/admin/labs");
}

export async function saveThresholdsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const labId = String(formData.get("labId"));
  if (!can(user, "manage_alert_rules", labId)) return;

  const expiryWarningDays = Number(formData.get("expiryWarningDays"));
  const lowStockPercent = Number(formData.get("lowStockPercent"));
  const sdsRereadDays = Number(formData.get("sdsRereadDays"));
  if (![expiryWarningDays, lowStockPercent, sdsRereadDays].every((n) => Number.isFinite(n) && n > 0)) return;

  await prisma.alertThresholdSetting.upsert({
    where: { labId },
    update: { expiryWarningDays, lowStockPercent, sdsRereadDays },
    create: { labId, expiryWarningDays, lowStockPercent, sdsRereadDays },
  });
  revalidatePath("/admin/labs");
  revalidatePath("/safety/alerts");
}
