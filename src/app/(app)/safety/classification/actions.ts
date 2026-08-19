"use server";

import { revalidatePath } from "next/cache";
import { GhsPictogram, SignalWord } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/server/audit";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";

async function requireGhsEditor() {
  const user = await requireUser();
  if (!can(user, "edit_ghs")) throw new Error("Only the EHS Officer or Admin can edit classifications");
  return user;
}

export async function saveClassificationAction(formData: FormData) {
  const user = await requireGhsEditor();
  const substanceId = String(formData.get("substanceId"));
  const pictograms = formData.getAll("pictograms").map(String) as GhsPictogram[];
  const signalWord = String(formData.get("signalWord")) as SignalWord;
  const storageClass = String(formData.get("storageClass")) || null;

  await prisma.$transaction(async (tx) => {
    await tx.ghsClassification.upsert({
      where: { substanceId },
      update: { pictograms, signalWord, storageClass },
      create: { substanceId, pictograms, signalWord, storageClass },
    });
    await writeAuditEvent(tx, {
      eventType: "substance.ghs_updated",
      actorId: user.id,
      entityType: "substance",
      entityId: substanceId,
      payload: { pictograms, signalWord, storageClass },
    });
  });
  revalidatePath("/safety/classification");
}

export async function addStatementAction(formData: FormData) {
  const user = await requireGhsEditor();
  const substanceId = String(formData.get("substanceId"));
  const kind = String(formData.get("kind")); // "H" | "P"
  const code = String(formData.get("code")).toUpperCase().trim();
  const source = (String(formData.get("source")) || "SUPPLIER_SDS") as
    | "SUPPLIER_SDS"
    | "AUTO_DERIVED"
    | "LOCAL_EHS_RULE";
  if (!code) return;

  const classification = await prisma.ghsClassification.upsert({
    where: { substanceId },
    update: {},
    create: { substanceId },
  });

  await prisma.$transaction(async (tx) => {
    if (kind === "H") {
      if (!(await tx.hStatement.findUnique({ where: { code } }))) return;
      await tx.hStatementOnClassification.upsert({
        where: { classificationId_hCode: { classificationId: classification.id, hCode: code } },
        update: { source },
        create: { classificationId: classification.id, hCode: code, source },
      });
    } else {
      if (!(await tx.pStatement.findUnique({ where: { code } }))) return;
      await tx.pStatementOnClassification.upsert({
        where: { classificationId_pCode: { classificationId: classification.id, pCode: code } },
        update: { source },
        create: { classificationId: classification.id, pCode: code, source },
      });
    }
    await writeAuditEvent(tx, {
      eventType: "substance.ghs_statement_added",
      actorId: user.id,
      entityType: "substance",
      entityId: substanceId,
      payload: { code, source },
    });
  });
  revalidatePath("/safety/classification");
}

export async function removeStatementAction(formData: FormData) {
  const user = await requireGhsEditor();
  const substanceId = String(formData.get("substanceId"));
  const kind = String(formData.get("kind"));
  const code = String(formData.get("code"));

  const classification = await prisma.ghsClassification.findUnique({ where: { substanceId } });
  if (!classification) return;

  await prisma.$transaction(async (tx) => {
    if (kind === "H") {
      await tx.hStatementOnClassification.deleteMany({
        where: { classificationId: classification.id, hCode: code },
      });
    } else {
      await tx.pStatementOnClassification.deleteMany({
        where: { classificationId: classification.id, pCode: code },
      });
    }
    await writeAuditEvent(tx, {
      eventType: "substance.ghs_statement_removed",
      actorId: user.id,
      entityType: "substance",
      entityId: substanceId,
      payload: { code },
    });
  });
  revalidatePath("/safety/classification");
}
