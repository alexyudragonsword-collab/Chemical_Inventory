// Audit trail viewer — every change, immutable, filterable, exportable.
// Before/after on every row; denied attempts and system events included.

import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";
import { Pill } from "@/components/pills";
import { VerifyIntegrityButton } from "./verify-button";

export const dynamic = "force-dynamic";

type Search = { user?: string; type?: string; q?: string; from?: string; to?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can(user, "view_audit")) return <p className="text-sm text-muted">Not authorized.</p>;
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const PAGE_SIZE = 50;

  const where: Prisma.AuditEventWhereInput = {
    ...(params.user ? { actorId: params.user } : {}),
    ...(params.type ? { eventType: { startsWith: params.type } } : {}),
    ...(params.q ? { entityId: params.q } : {}),
    ...(params.from || params.to
      ? {
          createdAt: {
            ...(params.from ? { gte: new Date(params.from) } : {}),
            ...(params.to ? { lte: new Date(params.to + "T23:59:59") } : {}),
          },
        }
      : {}),
  };

  const [events, total, users, eventTypes] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      include: {
        actor: { select: { id: true, name: true } },
        witness: { select: { name: true } },
      },
      orderBy: { seq: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditEvent.count({ where }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.auditEvent.groupBy({ by: ["eventType"], _count: true, orderBy: { eventType: "asc" } }),
  ]);

  const qs = (patch: Partial<Search>) => {
    const merged = { ...params, ...patch };
    const parts = Object.entries(merged).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
    return `/admin/audit${parts.length ? `?${parts.join("&")}` : ""}`;
  };

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-teal-deep">Audit trail</h1>
          <p className="text-sm text-muted">Admin · Audit · {total} events · hash-chained, append-only</p>
        </div>
        <div className="flex items-center gap-2">
          <VerifyIntegrityButton />
          <a
            href="/api/export/audit"
            className="rounded-md border border-line bg-white px-3 py-1.5 text-sm text-muted hover:bg-paper"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Filters */}
      <form action="/admin/audit" className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold tracking-wide text-muted uppercase">
          From
          <input type="date" name="from" defaultValue={params.from ?? ""} className="input mt-1 w-36" />
        </label>
        <label className="text-xs font-semibold tracking-wide text-muted uppercase">
          To
          <input type="date" name="to" defaultValue={params.to ?? ""} className="input mt-1 w-36" />
        </label>
        <label className="text-xs font-semibold tracking-wide text-muted uppercase">
          User
          <select name="user" defaultValue={params.user ?? ""} className="input mt-1 w-40">
            <option value="">All</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold tracking-wide text-muted uppercase">
          Action
          <select name="type" defaultValue={params.type ?? ""} className="input mt-1 w-48">
            <option value="">All</option>
            {eventTypes.map((t) => (
              <option key={t.eventType} value={t.eventType}>
                {t.eventType} ({t._count})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold tracking-wide text-muted uppercase">
          Entity ID
          <input name="q" defaultValue={params.q ?? ""} placeholder="container id…" className="input mt-1 w-44" />
        </label>
        <button className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep">
          Filter
        </button>
      </form>

      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Seq</th>
              <th className="px-2 py-2.5">Timestamp</th>
              <th className="px-2 py-2.5">User</th>
              <th className="px-2 py-2.5">Action</th>
              <th className="px-2 py-2.5">Object</th>
              <th className="px-2 py-2.5 text-right">Before</th>
              <th className="px-2 py-2.5 text-right">After</th>
              <th className="px-4 py-2.5">Reason</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const p = e.payload as Record<string, unknown>;
              return (
                <tr key={e.id} className={`border-b border-line last:border-0 ${e.eventType === "auth.denied" ? "bg-danger-soft/40" : ""}`}>
                  <td className="px-4 py-1.5 font-mono text-xs text-muted">{e.seq.toString()}</td>
                  <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                    {e.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {e.onBehalfSystem ? <span className="text-muted">system</span> : (e.actor?.name ?? "—")}
                    {e.witness && <span className="ml-1 text-muted">(w: {e.witness.name})</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <EventTypeBadge type={e.eventType} />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {typeof p.containerCode === "string" ? p.containerCode : typeof p.substance === "string" ? p.substance : e.entityType}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap">{renderValue(p.before)}</td>
                  <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap">{renderValue(p.after)}</td>
                  <td className="max-w-64 truncate px-4 py-1.5 text-xs text-muted" title={typeof p.reason === "string" ? p.reason : undefined}>
                    {typeof p.reason === "string" ? p.reason : "—"}
                  </td>
                </tr>
              );
            })}
            {events.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">No events match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-muted">
        <span>
          Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
        </span>
        <span className="flex gap-2">
          {page > 1 && <Link href={qs({ page: String(page - 1) })} className="text-teal hover:underline">← Newer</Link>}
          {page * PAGE_SIZE < total && <Link href={qs({ page: String(page + 1) })} className="text-teal hover:underline">Older →</Link>}
        </span>
      </div>
    </div>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.length > 18 ? value.slice(0, 18) + "…" : value;
  if (typeof value === "object") return JSON.stringify(value).slice(0, 18) + "…";
  return String(value);
}

function EventTypeBadge({ type }: { type: string }) {
  if (type === "auth.denied") return <Pill tone="danger">Denied</Pill>;
  if (type.startsWith("system.")) return <Pill tone="neutral">{type.slice(7)}</Pill>;
  const short = type.split(".").pop() ?? type;
  const tone =
    short === "deduct" || short === "dispose"
      ? "warning"
      : short === "check_in" || short === "add"
        ? "ok"
        : "info";
  return <Pill tone={tone}>{short.replace("_", " ")}</Pill>;
}
