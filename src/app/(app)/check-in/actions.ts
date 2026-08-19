"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthzError } from "@/server/authz";
import { checkInContainers } from "@/server/checkin";
import { checkPlacement } from "@/server/compatibility";
import { DomainError } from "@/server/inventory";
import { normalizeUnit } from "@/server/units";
import { requireUser } from "@/server/session";

export type IdentifyMatch = {
  substanceId: string;
  name: string;
  casNumber: string | null;
  storageClass: string | null;
  isControlled: boolean;
  supplier: string | null;
  catalogNumber: string | null;
  matchedBy: "catalog" | "cas" | "name";
};

/** Step 1: match a scanned/typed identifier against the catalogue. */
export async function identifyProductAction(query: string): Promise<IdentifyMatch[]> {
  await requireUser();
  const q = query.trim();
  if (!q) return [];

  const [byCatalog, bySubstance] = await Promise.all([
    prisma.supplierProduct.findMany({
      where: { catalogNumber: { contains: q, mode: "insensitive" } },
      include: { substance: { include: { ghs: { select: { storageClass: true } } } } },
      take: 5,
    }),
    prisma.substance.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { casNumber: { contains: q, mode: "insensitive" } },
        ],
      },
      include: { ghs: { select: { storageClass: true } }, supplierProducts: { take: 1 } },
      take: 8,
      orderBy: { name: "asc" },
    }),
  ]);

  const results: IdentifyMatch[] = [];
  for (const p of byCatalog) {
    results.push({
      substanceId: p.substanceId,
      name: p.substance.name,
      casNumber: p.substance.casNumber,
      storageClass: p.substance.ghs?.storageClass ?? null,
      isControlled: p.substance.isControlled,
      supplier: p.supplier,
      catalogNumber: p.catalogNumber,
      matchedBy: "catalog",
    });
  }
  for (const s of bySubstance) {
    if (results.some((r) => r.substanceId === s.id)) continue;
    results.push({
      substanceId: s.id,
      name: s.name,
      casNumber: s.casNumber,
      storageClass: s.ghs?.storageClass ?? null,
      isControlled: s.isControlled,
      supplier: s.supplierProducts[0]?.supplier ?? null,
      catalogNumber: s.supplierProducts[0]?.catalogNumber ?? null,
      matchedBy: s.casNumber && s.casNumber.includes(q) ? "cas" : "name",
    });
  }
  return results.slice(0, 8);
}

const newSubstanceSchema = z.object({
  name: z.string().trim().min(2),
  casNumber: z.string().trim().optional(),
  storageClass: z.string().trim().optional(),
  supplier: z.string().trim().optional(),
  catalogNumber: z.string().trim().optional(),
});

/** Step 1 fallback: product with no catalogue match (~one line in ten). */
export async function createSubstanceAction(input: unknown): Promise<
  { ok: true; match: IdentifyMatch } | { ok: false; error: string }
> {
  await requireUser();
  const parsed = newSubstanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Name is required (min 2 characters)" };
  const data = parsed.data;
  const cas = data.casNumber && /^\d{2,7}-\d{2}-\d$/.test(data.casNumber) ? data.casNumber : null;

  const substance = await prisma.substance.create({
    data: {
      name: data.name,
      casNumber: cas,
      needsCasEnrichment: !cas,
      ghs: data.storageClass ? { create: { storageClass: data.storageClass } } : undefined,
      supplierProducts:
        data.supplier && data.catalogNumber
          ? { create: { supplier: data.supplier, catalogNumber: data.catalogNumber } }
          : undefined,
    },
  });
  return {
    ok: true,
    match: {
      substanceId: substance.id,
      name: substance.name,
      casNumber: substance.casNumber,
      storageClass: data.storageClass ?? null,
      isControlled: false,
      supplier: data.supplier ?? null,
      catalogNumber: data.catalogNumber ?? null,
      matchedBy: "name",
    },
  };
}

export type PlacementCheck = {
  verdict: "COMPATIBLE" | "SEGREGATE" | "NEVER_TOGETHER";
  conflicts: { substance: string; storageClass: string; verdict: string }[];
  shelfLoad?: { count: number; capacity: number | null };
};

/** Step 3: live storage-rule check when a shelf is chosen. */
export async function checkPlacementAction(
  locationId: string,
  substanceId: string,
): Promise<PlacementCheck> {
  await requireUser();
  const substance = await prisma.substance.findUnique({
    where: { id: substanceId },
    include: { ghs: { select: { storageClass: true } } },
  });
  const result = await checkPlacement(prisma, locationId, substance?.ghs?.storageClass ?? null);
  const location = await prisma.storageLocation.findUnique({
    where: { id: locationId },
    select: { capacity: true, _count: { select: { containers: { where: { status: { in: ["ACTIVE", "EMPTY"] } } } } } },
  });
  return {
    verdict: result.verdict,
    conflicts: result.conflicts.map((c) => ({
      substance: c.substanceB,
      storageClass: c.classB,
      verdict: c.verdict,
    })),
    shelfLoad: location
      ? { count: location._count.containers, capacity: location.capacity }
      : undefined,
  };
}

const checkInSchema = z.object({
  substanceId: z.string().min(1),
  labId: z.string().min(1),
  locationId: z.string().nullable(),
  lotNumber: z.string().trim().nullable(),
  expiryDate: z.string().nullable(),
  packSize: z.coerce.number().positive(),
  unit: z.string(),
  count: z.coerce.number().int().min(1).max(50),
  grade: z.string().trim().nullable(),
  poNumber: z.string().trim().nullable(),
  overrideReason: z.string().trim().nullable(),
});

export async function checkInAction(
  input: unknown,
): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = checkInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;
  const unit = normalizeUnit(data.unit);
  if (!unit) return { ok: false, error: "Unknown unit" };

  try {
    const created = await checkInContainers(user, {
      substanceId: data.substanceId,
      labId: data.labId,
      locationId: data.locationId,
      lotNumber: data.lotNumber || null,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      packSize: data.packSize,
      unit,
      count: data.count,
      grade: data.grade || null,
      poNumber: data.poNumber || null,
      overrideReason: data.overrideReason || null,
    });
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { ok: true, codes: created.map((c) => c.code) };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    if (error instanceof AuthzError)
      return { ok: false, error: "You cannot receive stock into this lab." };
    console.error("checkInAction failed", error);
    return { ok: false, error: "Unexpected error — nothing was recorded." };
  }
}
