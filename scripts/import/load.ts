// Stage 4 — load container candidates into the live tables, idempotently,
// with full row-level provenance and audit events.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { writeAuditEvent } from "../../src/server/audit";
import {
  canonicalSpelling,
  dedupeRows,
  type ContainerCandidate,
  type DedupeResult,
} from "./normalize";
import { parseLegacyWorkbook, type ParsedSheet } from "./parse-xlsx";

export type ImportPlan = {
  fileName: string;
  fileHash: string;
  sheets: ParsedSheet[];
  dedupe: DedupeResult;
  /** Candidates that can be created (no blocking conflict). */
  importable: ContainerCandidate[];
  /** Candidates with field conflicts between duplicate rows — need a human. */
  errored: ContainerCandidate[];
  stats: Record<string, number>;
  flagCounts: Record<string, number>;
  unmatchedPeople: Map<string, number>;
};

export async function buildImportPlan(filePath: string, prisma: PrismaClient): Promise<ImportPlan> {
  const buffer = readFileSync(filePath);
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const sheets = await parseLegacyWorkbook(filePath);
  const dedupe = dedupeRows(sheets);

  const errored = dedupe.candidates.filter((c) => c.conflicts.length > 0);
  const importable = dedupe.candidates.filter((c) => c.conflicts.length === 0);

  const flagCounts: Record<string, number> = {};
  for (const c of dedupe.candidates) {
    for (const f of c.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
  }

  // Which Reserved/PI names have no matching user account?
  const users = await prisma.user.findMany({ select: { name: true } });
  const known = new Set(users.map((u) => u.name.toLowerCase().trim()));
  const unmatchedPeople = new Map<string, number>();
  for (const c of dedupe.candidates) {
    for (const person of [c.reservedBy, c.pi]) {
      if (person && !known.has(person.toLowerCase().trim())) {
        unmatchedPeople.set(person, (unmatchedPeople.get(person) ?? 0) + 1);
      }
    }
  }

  const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
  const dataRows = sheets.reduce(
    (sum, s) => sum + s.rows.filter((r) => r.kind === "DATA").length,
    0,
  );

  return {
    fileName: filePath.split("/").pop() ?? filePath,
    fileHash,
    sheets,
    dedupe,
    importable,
    errored,
    stats: {
      sheets: sheets.length,
      physicalRows: totalRows,
      dataRows,
      uniqueContainers: dedupe.candidates.length,
      importable: importable.length,
      conflicted: errored.length,
      locations: dedupe.locationDictionary.size,
      substances: new Set(dedupe.candidates.map((c) => c.substanceName.toLowerCase())).size,
    },
    flagCounts,
    unmatchedPeople,
  };
}

/** Lab identity from a permit code like "CREATE HUJ/BGU R02-08". */
export function labCodeFromPermit(permitCode: string | null, sheetName: string): string {
  const match = permitCode ? /([A-Z]\d{2}-\d{2})\s*$/.exec(permitCode.trim()) : null;
  return match ? match[1] : `LEGACY-${sheetName.toUpperCase()}`;
}

export async function applyImportPlan(
  plan: ImportPlan,
  prisma: PrismaClient,
  opts: { force?: boolean } = {},
): Promise<{ batchId: string; created: number; skippedExisting: number }> {
  const existingBatch = await prisma.importBatch.findUnique({ where: { fileHash: plan.fileHash } });
  if (existingBatch && !opts.force) {
    throw new Error(
      `This exact file was already imported (batch ${existingBatch.id}, ${existingBatch.status}). ` +
        `Re-running is a no-op; use --force to fill gaps only.`,
    );
  }

  // Reference data lookups outside the transaction.
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const userByName = new Map(users.map((u) => [u.name.toLowerCase().trim(), u.id]));
  const permitCategories = await prisma.permitCategory.findMany();
  const permitByCode = new Map(permitCategories.map((p) => [p.code, p.id]));

  let created = 0;
  let skippedExisting = 0;

  const batchId = await prisma.$transaction(
    async (tx) => {
      const batch = existingBatch
        ? await tx.importBatch.update({
            where: { id: existingBatch.id },
            data: { status: "APPLIED" },
          })
        : await tx.importBatch.create({
            data: {
              fileName: plan.fileName,
              fileHash: plan.fileHash,
              status: "APPLIED",
              stats: plan.stats,
            },
          });

      // Site + labs.
      const site = await tx.site.upsert({
        where: { name: "Legacy import" },
        update: {},
        create: { name: "Legacy import" },
      });

      const labIdByCode = new Map<string, string>();
      for (const c of plan.importable) {
        const code = labCodeFromPermit(c.permitCode, c.sheetName);
        if (labIdByCode.has(code)) continue;
        const lab = await tx.lab.upsert({
          where: { code },
          update: {},
          create: { siteId: site.id, code, name: c.labLabel ?? code },
        });
        labIdByCode.set(code, lab.id);
      }

      // Locations from the dictionary, per lab.
      // A location key can appear in several sheets; create it in each lab
      // whose containers reference it.
      const locationIdByLabAndKey = new Map<string, string>();
      for (const c of plan.importable) {
        if (!c.locationKey) continue;
        const labCode = labCodeFromPermit(c.permitCode, c.sheetName);
        const labId = labIdByCode.get(labCode)!;
        const mapKey = `${labId}:${c.locationKey}`;
        if (locationIdByLabAndKey.has(mapKey)) continue;
        const entry = plan.dedupe.locationDictionary.get(c.locationKey);
        const display = entry ? canonicalSpelling(entry.spellings) : c.rawLocation ?? c.locationKey;
        const incomplete = c.flags.has("LOCATION_INCOMPLETE");
        const location = await tx.storageLocation.upsert({
          where: { labId_code: { labId, code: display } },
          update: {},
          create: {
            labId,
            code: display,
            kind: "OTHER",
            rawAliases: entry ? [...entry.spellings.keys()] : c.rawLocation ? [c.rawLocation] : [],
            incomplete,
          },
        });
        locationIdByLabAndKey.set(mapKey, location.id);
      }

      // Substances, deduped by lower-cased name.
      const substanceIdByName = new Map<string, string>();
      for (const c of plan.importable) {
        const key = c.substanceName.toLowerCase();
        if (substanceIdByName.has(key)) continue;
        const existing = await tx.substance.findFirst({
          where: { name: { equals: c.substanceName, mode: "insensitive" } },
        });
        const substance =
          existing ??
          (await tx.substance.create({
            data: {
              name: c.substanceName,
              legacyHazardCode: c.hazardCode,
              needsCasEnrichment: true,
            },
          }));
        substanceIdByName.set(key, substance.id);
        if (c.supplier && c.catalogNumber) {
          await tx.supplierProduct.upsert({
            where: {
              substanceId_supplier_catalogNumber: {
                substanceId: substance.id,
                supplier: c.supplier,
                catalogNumber: c.catalogNumber,
              },
            },
            update: {},
            create: {
              substanceId: substance.id,
              supplier: c.supplier,
              catalogNumber: c.catalogNumber,
            },
          });
        }
      }

      // Containers.
      const containerIdBySubId = new Map<string, string>();
      for (const c of plan.importable) {
        const existing = await tx.container.findUnique({ where: { code: c.subId } });
        if (existing) {
          skippedExisting++;
          containerIdBySubId.set(c.subId, existing.id);
          continue;
        }

        const labCode = labCodeFromPermit(c.permitCode, c.sheetName);
        const labId = labIdByCode.get(labCode)!;
        const locationId = c.locationKey
          ? (locationIdByLabAndKey.get(`${labId}:${c.locationKey}`) ?? null)
          : null;
        const custodianId = c.reservedBy
          ? (userByName.get(c.reservedBy.toLowerCase().trim()) ?? null)
          : null;

        const pending: Record<string, string> = {};
        if (!custodianId) pending.custodian = c.reservedBy ?? "Unassigned";
        if (c.flags.has("PI_PENDING")) pending.pi = "Pending for Correction";
        else if (c.pi && !userByName.has(c.pi.toLowerCase().trim())) pending.pi = c.pi;
        if (c.unit === null) pending.unit = c.rawUnit ?? "(missing)";
        if (c.flags.has("LOCATION_INCOMPLETE")) pending.rawLocation = c.rawLocation ?? "(missing)";
        if (c.quantity === null) pending.quantity = "(missing)";

        const quantity = new Prisma.Decimal(c.quantity ?? 0);
        const container = await tx.container.create({
          data: {
            code: c.subId,
            substanceId: substanceIdByName.get(c.substanceName.toLowerCase())!,
            labId,
            locationId,
            custodianId,
            currentQuantity: quantity,
            initialQuantity: quantity,
            unit: c.unit ?? "UNIT",
            lotNumber: c.lotNumber,
            status: c.quantity === 0 ? "EMPTY" : "ACTIVE",
            pendingCorrection: Object.keys(pending).length ? pending : undefined,
            permitCategories: {
              create: [...c.permitCategories.entries()]
                .filter(([code]) => permitByCode.has(code))
                .map(([code, permitCode]) => ({
                  permitCategoryId: permitByCode.get(code)!,
                  permitCode,
                })),
            },
          },
        });
        containerIdBySubId.set(c.subId, container.id);
        created++;

        const event = await writeAuditEvent(tx, {
          eventType: "container.check_in",
          onBehalfSystem: true,
          entityType: "container",
          entityId: container.id,
          payload: {
            containerCode: c.subId,
            before: 0,
            after: c.quantity ?? 0,
            unit: c.unit ?? "UNIT",
            reason: `Legacy import (${plan.fileName})`,
          },
        });
        await tx.inventoryTransaction.create({
          data: {
            auditEventId: event.id,
            containerId: container.id,
            kind: "CHECK_IN",
            quantityBefore: new Prisma.Decimal(0),
            quantityAfter: quantity,
            unit: c.unit ?? "UNIT",
            reason: `Legacy import (${plan.fileName})`,
          },
        });
      }

      // Row-level provenance for EVERY physical row.
      const firstRowOfSub = new Map<string, string>(); // subId -> "sheet:row"
      for (const c of plan.dedupe.candidates) {
        const first = c.sourceRows[0];
        firstRowOfSub.set(c.subId, `${first.sheetName}:${first.rowIndex}`);
      }
      const erroredIds = new Set(plan.errored.map((c) => c.subId));

      const rowsData: Prisma.ImportRowCreateManyInput[] = [];
      for (const sheet of plan.sheets) {
        for (const row of sheet.rows) {
          let disposition: Prisma.ImportRowCreateManyInput["disposition"];
          let subId: string | null = null;
          let containerId: string | null = null;
          if (row.kind === "DATA" && row.data) {
            subId = row.data.subId;
            if (erroredIds.has(subId)) disposition = "ERROR";
            else if (firstRowOfSub.get(subId) === `${sheet.sheetName}:${row.rowIndex}`)
              disposition = "IMPORTED";
            else disposition = "MERGED_DUPLICATE";
            containerId = containerIdBySubId.get(subId) ?? null;
          } else if (row.kind === "PLACEHOLDER") {
            disposition = "SKIPPED_PLACEHOLDER";
          } else {
            disposition = "SKIPPED_STRUCTURAL";
          }
          rowsData.push({
            batchId: batch.id,
            sheetName: sheet.sheetName,
            rowIndex: row.rowIndex,
            raw: row.raw as Prisma.InputJsonValue,
            subId,
            disposition,
            containerId,
            notes:
              disposition === "ERROR"
                ? plan.errored.find((c) => c.subId === subId)?.conflicts.join("; ")
                : null,
          });
        }
      }
      await tx.importRow.createMany({ data: rowsData });

      return batch.id;
    },
    { timeout: 600_000, maxWait: 30_000 },
  );

  return { batchId, created, skippedExisting };
}
