// Storage-compatibility engine. The three-state matrix (compatible /
// segregate / never together) is derived from GHS storage classes via the
// seeded CompatibilityRule table — no separately maintained rule set.

import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export type Verdict = "COMPATIBLE" | "SEGREGATE" | "NEVER_TOGETHER";

export type CompatibilityConflict = {
  classA: string;
  classB: string;
  verdict: Verdict;
  substanceA: string;
  substanceB: string;
  containerCodes: string[];
};

const SEVERITY: Record<Verdict, number> = {
  COMPATIBLE: 0,
  SEGREGATE: 1,
  NEVER_TOGETHER: 2,
};

export function pairKey(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

export async function loadRuleMap(tx: Tx): Promise<Map<string, Verdict>> {
  const rules = await tx.compatibilityRule.findMany();
  return new Map(rules.map((r) => [`${r.classA}|${r.classB}`, r.verdict]));
}

export function verdictFor(rules: Map<string, Verdict>, a: string, b: string): Verdict {
  const [x, y] = pairKey(a, b);
  return rules.get(`${x}|${y}`) ?? "COMPATIBLE";
}

/**
 * Check whether adding a substance of `storageClass` to a location conflicts
 * with what the location (cabinet subtree) already holds.
 */
export async function checkPlacement(
  tx: Tx,
  locationId: string,
  storageClass: string | null,
): Promise<{ verdict: Verdict; conflicts: CompatibilityConflict[] }> {
  if (!storageClass) return { verdict: "COMPATIBLE", conflicts: [] };

  const cabinetIds = await locationSubtreeIds(tx, await cabinetRootId(tx, locationId));
  const residents = await tx.container.findMany({
    where: { locationId: { in: cabinetIds }, status: { in: ["ACTIVE", "EMPTY"] } },
    include: { substance: { include: { ghs: { select: { storageClass: true } } } } },
  });

  const rules = await loadRuleMap(tx);
  const conflicts: CompatibilityConflict[] = [];
  let worst: Verdict = "COMPATIBLE";
  for (const resident of residents) {
    const residentClass = resident.substance.ghs?.storageClass;
    if (!residentClass) continue;
    const verdict = verdictFor(rules, storageClass, residentClass);
    if (verdict === "COMPATIBLE") continue;
    if (SEVERITY[verdict] > SEVERITY[worst]) worst = verdict;
    const existing = conflicts.find(
      (c) => c.classB === residentClass && c.substanceB === resident.substance.name,
    );
    if (existing) existing.containerCodes.push(resident.code);
    else
      conflicts.push({
        classA: storageClass,
        classB: residentClass,
        verdict,
        substanceA: "(incoming)",
        substanceB: resident.substance.name,
        containerCodes: [resident.code],
      });
  }
  return { verdict: worst, conflicts };
}

/**
 * Full scan of one cabinet: pairwise verdicts of everything inside.
 * Used by the compatibility screen and the nightly re-check.
 */
export async function scanCabinet(
  tx: Tx,
  cabinetId: string,
): Promise<{ conflicts: CompatibilityConflict[]; containerCount: number; totalVolumeL: number }> {
  const ids = await locationSubtreeIds(tx, cabinetId);
  const residents = await tx.container.findMany({
    where: { locationId: { in: ids }, status: { in: ["ACTIVE", "EMPTY"] } },
    include: { substance: { include: { ghs: { select: { storageClass: true } } } } },
  });
  const rules = await loadRuleMap(tx);

  const conflicts: CompatibilityConflict[] = [];
  for (let i = 0; i < residents.length; i++) {
    for (let j = i + 1; j < residents.length; j++) {
      const a = residents[i];
      const b = residents[j];
      const classA = a.substance.ghs?.storageClass;
      const classB = b.substance.ghs?.storageClass;
      if (!classA || !classB) continue;
      const verdict = verdictFor(rules, classA, classB);
      if (verdict === "COMPATIBLE") continue;
      const existing = conflicts.find(
        (c) =>
          (c.substanceA === a.substance.name && c.substanceB === b.substance.name) ||
          (c.substanceA === b.substance.name && c.substanceB === a.substance.name),
      );
      if (existing) {
        for (const code of [a.code, b.code]) {
          if (!existing.containerCodes.includes(code)) existing.containerCodes.push(code);
        }
      } else {
        conflicts.push({
          classA,
          classB,
          verdict,
          substanceA: a.substance.name,
          substanceB: b.substance.name,
          containerCodes: [a.code, b.code],
        });
      }
    }
  }

  let totalVolumeL = 0;
  for (const r of residents) {
    if (r.unit === "L") totalVolumeL += r.currentQuantity.toNumber();
    else if (r.unit === "ML") totalVolumeL += r.currentQuantity.toNumber() / 1000;
  }

  return { conflicts, containerCount: residents.length, totalVolumeL };
}

/** Walk up to the top-most ancestor (the cabinet) of a location. */
export async function cabinetRootId(tx: Tx, locationId: string): Promise<string> {
  let current = await tx.storageLocation.findUnique({
    where: { id: locationId },
    select: { id: true, parentId: true },
  });
  while (current?.parentId) {
    current = await tx.storageLocation.findUnique({
      where: { id: current.parentId },
      select: { id: true, parentId: true },
    });
  }
  return current?.id ?? locationId;
}

/** The location plus all its descendants. */
export async function locationSubtreeIds(tx: Tx, rootId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await tx.storageLocation.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}
