// Dashboard — answers "what needs me today?" before anything else, scoped
// deliberately to the user's custody (estate-wide numbers live in Reports).

import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { custodyWhere } from "@/server/queries";
import { requireUser } from "@/server/session";
import { formatQuantity } from "@/server/units";
import { ExpiryPill } from "@/components/pills";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const custody = custodyWhere(user);
  const now = new Date();
  const soon = new Date(Date.now() + 30 * 86_400_000);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [
    workspaceLab,
    custodyCount,
    addedThisWeek,
    expiringSoon,
    expired,
    belowMinContainers,
    openRequests,
    recent,
  ] = await Promise.all([
    user.workspaceLabId
      ? prisma.lab.findUnique({
          where: { id: user.workspaceLabId },
          select: { code: true, name: true },
        })
      : null,
    prisma.container.count({ where: { ...activeCustody(custody) } }),
    prisma.container.count({
      where: { ...activeCustody(custody), createdAt: { gte: weekAgo } },
    }),
    prisma.container.findMany({
      where: { ...activeCustody(custody), expiryDate: { gte: now, lte: soon } },
      include: { substance: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.container.findMany({
      where: { ...activeCustody(custody), expiryDate: { lt: now } },
      include: { substance: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.container.findMany({
      where: { ...activeCustody(custody), substance: { minStockLevel: { not: null } } },
      include: { substance: { select: { name: true, minStockLevel: true, minStockUnit: true } } },
    }),
    prisma.transferRequest.findMany({
      where: { currentCustodianId: user.id, status: "PENDING" },
      include: {
        container: { include: { substance: { select: { name: true } } } },
      },
    }),
    prisma.inventoryTransaction.findMany({
      where: { container: custody },
      include: {
        container: { include: { substance: { select: { name: true } } } },
        auditEvent: { include: { actor: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const belowMin = belowMinContainers.filter(
    (c) =>
      c.substance.minStockLevel !== null &&
      c.substance.minStockUnit === c.unit &&
      c.currentQuantity.toNumber() < c.substance.minStockLevel.toNumber(),
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <h1 className="text-xl font-semibold text-teal-deep">
        {greeting}, {user.name.split(" ")[0] ?? user.name}
      </h1>
      <p className="text-sm text-muted">
        {workspaceLab ? `${workspaceLab.code} — ${workspaceLab.name} · ` : ""}
        {custodyCount} containers in your custody
      </p>

      {/* KPI tiles */}
      <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="In my custody" value={custodyCount} note={addedThisWeek > 0 ? `▲ ${addedThisWeek} this week` : "—"} href="/inventory" />
        <Kpi
          label="Expiring ≤ 30 days"
          value={expiringSoon.length}
          note={expired.length > 0 ? `${expired.length} already expired` : "none expired"}
          tone={expiringSoon.length > 0 ? "warning" : "ok"}
          href="/inventory?status=expiring"
        />
        <Kpi
          label="Below min level"
          value={belowMin.length}
          note={belowMin.length > 0 ? "Reorder suggested" : "All within limits"}
          tone={belowMin.length > 0 ? "warning" : "ok"}
          href="/inventory?low=1"
        />
        <Kpi
          label="Open requests"
          value={openRequests.length}
          note={openRequests.length > 0 ? "Awaiting your decision" : "—"}
          tone={openRequests.length > 0 ? "info" : "neutral"}
          href="/transfers"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {/* Needs your action */}
        <section className="rounded-lg border border-line bg-card">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-teal-deep">
            Needs your action
          </h2>
          <ul className="divide-y divide-line">
            {expired.map((c) => (
              <ActionRow
                key={c.id}
                title={`${c.substance.name} — ${c.code}`}
                detail={`Expired ${Math.ceil((now.getTime() - c.expiryDate!.getTime()) / 86_400_000)} days ago`}
                href={`/chemicals/${c.substanceId}`}
                tone="danger"
              />
            ))}
            {expiringSoon.slice(0, 4).map((c) => (
              <ActionRow
                key={c.id}
                title={`${c.substance.name} — ${c.code}`}
                detail={`Expires in ${Math.ceil((c.expiryDate!.getTime() - now.getTime()) / 86_400_000)} days`}
                href={`/chemicals/${c.substanceId}`}
                tone="warning"
              />
            ))}
            {belowMin.slice(0, 3).map((c) => (
              <ActionRow
                key={c.id}
                title={c.substance.name}
                detail={`Below min (${formatQuantity(c.currentQuantity.toNumber(), c.unit)} / ${formatQuantity(
                  c.substance.minStockLevel!.toNumber(),
                  c.unit,
                )})`}
                href="/inventory?low=1"
                tone="warning"
              />
            ))}
            {openRequests.map((r) => (
              <ActionRow
                key={r.id}
                title={`${r.container.substance.name} — ${r.container.code}`}
                detail="Transfer request awaiting your decision"
                href="/transfers"
                tone="info"
              />
            ))}
            {expired.length + expiringSoon.length + belowMin.length + openRequests.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted">
                Nothing needs you right now.
              </li>
            )}
          </ul>
        </section>

        {/* Recent activity */}
        <section className="rounded-lg border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-teal-deep">Recent activity in my custody</h2>
            <Link href="/inventory" className="text-xs text-teal hover:underline">
              View all
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-muted uppercase">
                <th className="px-4 py-2">Time</th>
                <th className="px-2 py-2">Chemical</th>
                <th className="px-2 py-2">Action</th>
                <th className="px-2 py-2 text-right">Change</th>
                <th className="px-2 py-2 text-right">Remaining</th>
                <th className="px-4 py-2">By</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((t) => {
                const delta = t.quantityAfter.toNumber() - t.quantityBefore.toNumber();
                return (
                  <tr key={t.id} className="border-t border-line">
                    <td className="px-4 py-2 text-xs whitespace-nowrap text-muted">
                      {formatTime(t.createdAt)}
                    </td>
                    <td className="px-2 py-2">
                      {t.container.substance.name}
                      <span className="ml-1 text-xs text-muted">{t.container.code}</span>
                    </td>
                    <td className="px-2 py-2 text-xs">{kindLabel(t.kind)}</td>
                    <td className={`px-2 py-2 text-right whitespace-nowrap ${delta < 0 ? "text-danger" : "text-ok"}`}>
                      {delta > 0 ? "+" : "−"} {formatQuantity(Math.abs(delta), t.unit)}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {formatQuantity(t.quantityAfter.toNumber(), t.unit)}
                    </td>
                    <td className="px-4 py-2 text-xs">{t.auditEvent.actor?.name ?? "system"}</td>
                  </tr>
                );
              })}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function activeCustody(custody: Prisma.ContainerWhereInput): Prisma.ContainerWhereInput {
  return { AND: [custody, { status: { in: ["ACTIVE", "EMPTY"] } }] };
}

function Kpi({
  label,
  value,
  note,
  tone = "neutral",
  href,
}: {
  label: string;
  value: number;
  note: string;
  tone?: "neutral" | "warning" | "ok" | "info";
  href: string;
}) {
  const noteColor =
    tone === "warning" ? "text-warning" : tone === "ok" ? "text-ok" : tone === "info" ? "text-info" : "text-muted";
  return (
    <Link href={href} className="rounded-lg border border-line bg-card p-4 hover:border-teal">
      <div className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-ink">{value}</div>
      <div className={`mt-1 text-xs ${noteColor}`}>{note}</div>
    </Link>
  );
}

function ActionRow({
  title,
  detail,
  href,
  tone,
}: {
  title: string;
  detail: string;
  href: string;
  tone: "danger" | "warning" | "info";
}) {
  const dot = tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-info";
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{title}</span>
          <span className="block text-xs text-muted">{detail}</span>
        </span>
        <span className="text-xs text-teal">Open</span>
      </Link>
    </li>
  );
}

function formatTime(date: Date): string {
  const today = new Date().toDateString();
  if (date.toDateString() === today) {
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function kindLabel(kind: string): string {
  return kind === "CHECK_IN" ? "Check-in" : kind[0] + kind.slice(1).toLowerCase();
}
