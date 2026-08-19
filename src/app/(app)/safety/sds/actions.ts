"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/server/audit";
import { requireUser } from "@/server/session";

const MAX_SDS_BYTES = 20 * 1024 * 1024;

export async function uploadSdsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const substanceId = String(formData.get("substanceId"));
  const revision = String(formData.get("revision")).trim();
  const supplier = String(formData.get("supplier")).trim() || null;
  const changeSummary = String(formData.get("changeSummary")).trim() || null;
  const file = formData.get("file");

  if (!substanceId || !revision) return;
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_SDS_BYTES) return;
  if (!file.name.toLowerCase().endsWith(".pdf")) return;

  const substance = await prisma.substance.findUnique({ where: { id: substanceId } });
  if (!substance) return;

  const root = process.env.FILE_STORAGE_ROOT ?? "./data/files";
  await mkdir(path.join(root, "sds"), { recursive: true });

  await prisma.$transaction(async (tx) => {
    const previous = await tx.sdsDocument.findFirst({
      where: { substanceId, status: "CURRENT" },
    });

    const doc = await tx.sdsDocument.create({
      data: {
        substanceId,
        supplier,
        revision,
        status: "CURRENT",
        issuedDate: new Date(),
        supersedesId: previous?.id ?? null,
        changeSummary,
      },
    });

    const fileKey = path.join("sds", `${doc.id}.pdf`);
    await writeFile(path.join(root, fileKey), Buffer.from(await file.arrayBuffer()));
    await tx.sdsDocument.update({ where: { id: doc.id }, data: { fileKey } });

    if (previous) {
      await tx.sdsDocument.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
    }

    await writeAuditEvent(tx, {
      eventType: "sds.uploaded",
      actorId: user.id,
      entityType: "substance",
      entityId: substanceId,
      payload: {
        substance: substance.name,
        revision,
        supplier,
        supersedes: previous?.revision ?? null,
        changeSummary,
      },
    });
  });

  revalidatePath("/safety/sds");
}
