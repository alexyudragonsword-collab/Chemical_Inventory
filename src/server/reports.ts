// Standing report queries. Four reports cover the recurring questions;
// everything else is a filtered export.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { convert, sameDimension, unitLabel } from "@/server/units";

export type ReportPeriod = { from: Date; to: Date };

export function defaultPeriod(): ReportPeriod {
  const to = new Date();
  const from = new Date(to.getFullYear(), 0, 1);
  return { from, to };
}

/** Consumption: DEDUCT volumes grouped by substance, project and month. */
export async function consumptionReport(period: ReportPeriod, labCode?: string) {
  const transactions = await prisma.inventoryTransaction.findMany({
    where: {
      kind: "DEDUCT",
      createdAt: { gte: period.from, lte: period.to },
      ...(labCode ? { container: { lab: { code: labCode } } } : {}),
    },
    include: {
      container: {
        include: {
          substance: { select: { id: true, name: true } },
          lab: { select: { code: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  type Row = {
    substance: string;
    lab: string;
    project: string;
    used: number;
    unit: string;
    events: number;
  };
  const rows = new Map<string, Row>();
  const monthly = new Map<string, number>(); // volume in mL-equivalents for the chart
  for (const t of transactions) {
    const used = t.quantityBefore.toNumber() - t.quantityAfter.toNumber();
    const key = `${t.container.substance.id}|${t.container.lab.code}|${t.projectCode ?? "—"}|${t.unit}`;
    const row = rows.get(key) ?? {
      substance: t.container.substance.name,
      lab: t.container.lab.code,
      project: t.projectCode ?? "—",
      used: 0,
      unit: unitLabel(t.unit),
      events: 0,
    };
    row.used += used;
    row.events += 1;
    rows.set(key, row);

    if (sameDimension(t.unit, "ML")) {
      const month = t.createdAt.toISOString().slice(0, 7);
      monthly.set(month, (monthly.get(month) ?? 0) + convert(used, t.unit, "L"));
    }
  }
  return {
    rows: [...rows.values()].sort((a, b) => b.used - a.used),
    monthlySolventLitres: [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)),
    transactionCount: transactions.length,
  };
}

/** Regulated substances: every movement of controlled material. */
export async function regulatedReport(period: ReportPeriod) {
  return prisma.inventoryTransaction.findMany({
    where: {
      createdAt: { gte: period.from, lte: period.to },
      container: { substance: { isControlled: true } },
    },
    include: {
      container: {
        include: {
          substance: { select: { name: true, casNumber: true } },
          lab: { select: { code: true } },
        },
      },
      auditEvent: {
        include: { actor: { select: { name: true } }, witness: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Waste & disposal: DISPOSE events grouped by waste stream. */
export async function wasteReport(period: ReportPeriod) {
  const disposals = await prisma.inventoryTransaction.findMany({
    where: { kind: "DISPOSE", createdAt: { gte: period.from, lte: period.to } },
    include: {
      container: {
        include: {
          substance: { select: { name: true } },
          lab: { select: { code: true } },
        },
      },
      auditEvent: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const byStream = new Map<string, { count: number; items: string[] }>();
  for (const d of disposals) {
    const payload = d.auditEvent.payload as Record<string, unknown>;
    const stream = typeof payload.wasteStream === "string" && payload.wasteStream ? payload.wasteStream : "Unspecified";
    const entry = byStream.get(stream) ?? { count: 0, items: [] };
    entry.count++;
    if (entry.items.length < 5) entry.items.push(d.container.substance.name);
    byStream.set(stream, entry);
  }
  return { disposals, byStream };
}

/** Stock health: expiry buckets, dormancy, write-off risk. */
export async function stockHealthReport(client: PrismaClient = prisma) {
  const containers = await client.container.findMany({
    where: { status: "ACTIVE" },
    include: {
      substance: { select: { name: true } },
      lab: { select: { code: true } },
      transactions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const now = Date.now();
  const buckets = { expired: 0, days30: 0, days90: 0, days365: 0, later: 0, none: 0 };
  const dormant: { code: string; substance: string; lab: string; lastMovement: Date | null }[] = [];
  const writeOffRisk: { code: string; substance: string; lab: string; daysToExpiry: number; remainingPct: number }[] = [];

  for (const c of containers) {
    const expiry = c.expiryDate?.getTime();
    if (!expiry) buckets.none++;
    else {
      const days = Math.ceil((expiry - now) / 86_400_000);
      if (days < 0) buckets.expired++;
      else if (days <= 30) buckets.days30++;
      else if (days <= 90) buckets.days90++;
      else if (days <= 365) buckets.days365++;
      else buckets.later++;

      const remainingPct =
        c.initialQuantity.toNumber() > 0
          ? c.currentQuantity.toNumber() / c.initialQuantity.toNumber()
          : 0;
      if (days >= 0 && days <= 90 && remainingPct > 0.5) {
        writeOffRisk.push({
          code: c.code,
          substance: c.substance.name,
          lab: c.lab.code,
          daysToExpiry: days,
          remainingPct: Math.round(remainingPct * 100),
        });
      }
    }
    const last = c.transactions[0]?.createdAt ?? null;
    if (!last || now - last.getTime() > 180 * 86_400_000) {
      dormant.push({ code: c.code, substance: c.substance.name, lab: c.lab.code, lastMovement: last });
    }
  }
  writeOffRisk.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  return { total: containers.length, buckets, dormant: dormant.slice(0, 50), writeOffRisk: writeOffRisk.slice(0, 50) };
}
