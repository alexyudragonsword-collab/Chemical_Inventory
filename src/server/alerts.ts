// Alert generation. Runs nightly in the worker and can be triggered from the
// UI. Alerts are upserted by dedupeKey so re-runs never duplicate, and
// auto-resolve when their condition clears.

import type { PrismaClient } from "@prisma/client";
import { scanCabinet } from "@/server/compatibility";
import { convert, sameDimension } from "@/server/units";

const DEFAULTS = { expiryWarningDays: 30, lowStockPercent: 25, sdsRereadDays: 14 };

export type SweepSummary = Record<string, number>;

export async function sweepAlerts(prisma: PrismaClient): Promise<SweepSummary> {
  const summary: SweepSummary = {
    expired: 0,
    expiring: 0,
    belowMin: 0,
    sdsUnread: 0,
    compatConflicts: 0,
    autoResolved: 0,
  };
  const now = new Date();
  const seen = new Set<string>();

  const thresholds = new Map(
    (await prisma.alertThresholdSetting.findMany()).map((t) => [t.labId, t]),
  );
  const labThreshold = (labId: string) => thresholds.get(labId) ?? DEFAULTS;

  async function upsert(
    dedupeKey: string,
    data: {
      kind: "EXPIRED" | "EXPIRING_SOON" | "BELOW_MIN" | "SDS_UNREAD" | "COMPAT_CONFLICT" | "QUANTITY_DRIFT";
      labId?: string | null;
      containerId?: string | null;
      substanceId?: string | null;
      locationId?: string | null;
      detail: Record<string, unknown>;
    },
  ) {
    seen.add(dedupeKey);
    await prisma.alert.upsert({
      where: { dedupeKey },
      update: {
        detail: data.detail as never,
        // Reopen resolved alerts whose condition has returned; leave
        // dismissed/snoozed alone.
        status: undefined,
      },
      create: {
        dedupeKey,
        kind: data.kind,
        labId: data.labId ?? null,
        containerId: data.containerId ?? null,
        substanceId: data.substanceId ?? null,
        locationId: data.locationId ?? null,
        detail: data.detail as never,
      },
    });
  }

  // --- Expiry --------------------------------------------------------------
  const containers = await prisma.container.findMany({
    where: { status: { in: ["ACTIVE", "EMPTY"] } },
    include: {
      substance: {
        select: { id: true, name: true, minStockLevel: true, minStockUnit: true },
      },
    },
  });

  for (const c of containers) {
    if (!c.expiryDate) continue;
    const days = Math.ceil((c.expiryDate.getTime() - now.getTime()) / 86_400_000);
    const t = labThreshold(c.labId);
    if (days < 0) {
      summary.expired++;
      await upsert(`EXPIRED:${c.id}`, {
        kind: "EXPIRED",
        labId: c.labId,
        containerId: c.id,
        substanceId: c.substance.id,
        detail: { substance: c.substance.name, containerCode: c.code, daysOverdue: -days },
      });
    } else if (days <= t.expiryWarningDays) {
      summary.expiring++;
      await upsert(`EXPIRING_SOON:${c.id}`, {
        kind: "EXPIRING_SOON",
        labId: c.labId,
        containerId: c.id,
        substanceId: c.substance.id,
        detail: { substance: c.substance.name, containerCode: c.code, daysToExpiry: days },
      });
    }
  }

  // --- Below minimum stock (per substance per lab) -------------------------
  const bySubstanceLab = new Map<string, typeof containers>();
  for (const c of containers) {
    if (c.status !== "ACTIVE") continue;
    if (c.substance.minStockLevel === null || !c.substance.minStockUnit) continue;
    const key = `${c.substance.id}:${c.labId}`;
    const list = bySubstanceLab.get(key) ?? [];
    list.push(c);
    bySubstanceLab.set(key, list);
  }
  for (const [key, list] of bySubstanceLab) {
    const s = list[0].substance;
    const minUnit = s.minStockUnit!;
    let total = 0;
    let convertible = true;
    for (const c of list) {
      if (!sameDimension(c.unit, minUnit)) {
        convertible = false;
        break;
      }
      total += convert(c.currentQuantity.toNumber(), c.unit, minUnit);
    }
    if (!convertible) continue;
    const min = s.minStockLevel!.toNumber();
    if (total < min) {
      summary.belowMin++;
      await upsert(`BELOW_MIN:${key}`, {
        kind: "BELOW_MIN",
        labId: list[0].labId,
        substanceId: s.id,
        detail: { substance: s.name, total, min, unit: minUnit },
      });
    }
  }

  // --- SDS unread: a current revision that active custodians haven't read --
  const currentSds = await prisma.sdsDocument.findMany({
    where: { status: "CURRENT", supersedesId: { not: null } },
    include: {
      substance: { select: { id: true, name: true, containers: { where: { status: "ACTIVE" }, select: { custodianId: true, labId: true } } } },
      readReceipts: { select: { userId: true } },
    },
  });
  for (const sds of currentSds) {
    const readers = new Set(sds.readReceipts.map((r) => r.userId));
    const custodians = new Set(
      sds.substance.containers.map((c) => c.custodianId).filter((id): id is string => Boolean(id)),
    );
    const unread = [...custodians].filter((id) => !readers.has(id));
    if (unread.length > 0) {
      summary.sdsUnread++;
      await upsert(`SDS_UNREAD:${sds.id}`, {
        kind: "SDS_UNREAD",
        substanceId: sds.substance.id,
        labId: sds.substance.containers[0]?.labId ?? null,
        detail: {
          substance: sds.substance.name,
          revision: sds.revision,
          unreadCount: unread.length,
          custodianCount: custodians.size,
        },
      });
    }
  }

  // --- Storage compatibility: nightly re-check of every cabinet ------------
  const cabinets = await prisma.storageLocation.findMany({
    where: { parentId: null },
    select: { id: true, code: true, name: true, labId: true },
  });
  for (const cabinet of cabinets) {
    const scan = await scanCabinet(prisma, cabinet.id);
    if (scan.conflicts.length > 0) {
      summary.compatConflicts++;
      await upsert(`COMPAT_CONFLICT:${cabinet.id}`, {
        kind: "COMPAT_CONFLICT",
        labId: cabinet.labId,
        locationId: cabinet.id,
        detail: {
          cabinet: cabinet.name ?? cabinet.code,
          conflictCount: scan.conflicts.length,
          worst: scan.conflicts.some((c) => c.verdict === "NEVER_TOGETHER")
            ? "NEVER_TOGETHER"
            : "SEGREGATE",
          pairs: scan.conflicts.slice(0, 5).map((c) => `${c.substanceA} × ${c.substanceB}`),
        },
      });
    }
  }

  // --- Auto-resolve OPEN alerts whose condition cleared --------------------
  const stale = await prisma.alert.findMany({
    where: { status: "OPEN", dedupeKey: { notIn: [...seen] } },
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.alert.updateMany({
      where: { id: { in: stale.map((a) => a.id) } },
      data: { status: "RESOLVED", resolvedAt: now },
    });
    summary.autoResolved = stale.length;
  }

  return summary;
}

/** Re-derive container quantities from their transactions and flag drift. */
export async function sweepQuantityDrift(prisma: PrismaClient): Promise<number> {
  const containers = await prisma.container.findMany({
    where: { status: { in: ["ACTIVE", "EMPTY"] } },
    select: { id: true, code: true, labId: true, currentQuantity: true },
  });
  let drifted = 0;
  for (const c of containers) {
    const transactions = await prisma.inventoryTransaction.findMany({
      where: { containerId: c.id },
      orderBy: { createdAt: "asc" },
      select: { quantityBefore: true, quantityAfter: true },
    });
    if (transactions.length === 0) continue;
    const derived = transactions[transactions.length - 1].quantityAfter.toNumber();
    if (Math.abs(derived - c.currentQuantity.toNumber()) > 1e-9) {
      drifted++;
      await prisma.alert.upsert({
        where: { dedupeKey: `QUANTITY_DRIFT:${c.id}` },
        update: { detail: { containerCode: c.code, cached: c.currentQuantity.toNumber(), derived } },
        create: {
          dedupeKey: `QUANTITY_DRIFT:${c.id}`,
          kind: "QUANTITY_DRIFT",
          labId: c.labId,
          containerId: c.id,
          detail: { containerCode: c.code, cached: c.currentQuantity.toNumber(), derived },
        },
      });
    }
  }
  return drifted;
}
