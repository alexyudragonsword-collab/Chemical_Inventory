// "My chemicals" — the core list. Scope is a removable filter chip: with it,
// the user's editable set; without it, the whole estate with steppers
// disabled on out-of-scope rows (same table, no mode switch).

import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeContainer } from "@/server/authz";
import { buildInventoryWhere, HAZARD_FILTERS } from "@/server/queries";
import { requireUser } from "@/server/session";
import { formatQuantity } from "@/server/units";
import { ControlledPill, ExpiryPill, HazardPill, StatusPill } from "@/components/pills";
import { RowAdjust } from "@/components/row-adjust";
import { RequestTransferButton } from "@/components/request-transfer-button";

export const dynamic = "force-dynamic";

type Search = {
  q?: string;
  scope?: string;
  hazard?: string;
  status?: string;
  low?: string;
  lab?: string;
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const scopeMine = params.scope !== "all";
  const q = params.q ?? "";

  const where: Prisma.ContainerWhereInput = buildInventoryWhere(user, params);

  const [containers, labs] = await Promise.all([
    prisma.container.findMany({
      where,
      include: {
        substance: { include: { ghs: { select: { storageClass: true } } } },
        lab: { select: { code: true } },
        location: { select: { code: true, name: true } },
        custodian: { select: { name: true } },
        // Disposal record for the "Disposed" registry view (empty otherwise).
        transactions: {
          where: { kind: "DISPOSE" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, reason: true },
        },
      },
      orderBy: [{ substance: { name: "asc" } }, { code: "asc" }],
      take: 500,
    }),
    prisma.lab.findMany({ select: { code: true }, orderBy: { code: "asc" } }),
  ]);

  const rows = containers
    .map((c) => ({
      container: c,
      mode: authorizeContainer(user, "deduct", {
        id: c.id,
        labId: c.labId,
        custodianId: c.custodianId,
        isControlled: c.substance.isControlled,
      }),
      belowMin:
        c.status === "ACTIVE" &&
        c.substance.minStockLevel !== null &&
        c.substance.minStockUnit === c.unit &&
        c.currentQuantity.toNumber() < c.substance.minStockLevel.toNumber(),
    }))
    .filter((r) => (params.low ? r.belowMin : true));

  const editableCount = rows.filter((r) => r.mode === "editable").length;

  const chip = (label: string, href: string, active: boolean) => (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-line bg-card text-muted hover:bg-paper"
      }`}
    >
      {label}
    </Link>
  );

  const qs = (patch: Partial<Search>) => {
    const merged = { ...params, ...patch };
    const parts = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
    return `/inventory${parts.length ? `?${parts.join("&")}` : ""}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-teal-deep">
            {scopeMine ? "My chemicals" : "All chemicals"}
          </h1>
          <p className="text-sm text-muted">
            Inventory · {scopeMine ? "My custody" : "Whole estate"} · {rows.length} containers
          </p>
        </div>
        <a
          href={`/api/export/csv?${new URLSearchParams(
            Object.entries(params).filter(([, v]) => v) as [string, string][],
          )}`}
          className="rounded-md border border-line bg-card px-3 py-1.5 text-sm text-muted hover:bg-paper"
        >
          Export CSV
        </a>
      </div>

      {/* Filter chips */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {scopeMine
          ? chip("Scope: My custody ×", qs({ scope: "all" }), true)
          : chip("Scope: All labs ×", qs({ scope: undefined }), false)}
        {chip("Hazard: All", qs({ hazard: undefined }), !params.hazard)}
        {Object.keys(HAZARD_FILTERS).map((h) =>
          chip(h[0].toUpperCase() + h.slice(1), qs({ hazard: h }), params.hazard === h),
        )}
        <span className="mx-1 text-line">|</span>
        {chip("In date", qs({ status: undefined }), !params.status)}
        {chip("Expiring ≤30 d", qs({ status: "expiring" }), params.status === "expiring")}
        {chip("Expired", qs({ status: "expired" }), params.status === "expired")}
        {chip("Disposed", qs({ status: params.status === "disposed" ? undefined : "disposed" }), params.status === "disposed")}
        {chip("Low stock only", qs({ low: params.low ? undefined : "1" }), Boolean(params.low))}
        {!scopeMine && (
          <>
            <span className="mx-1 text-line">|</span>
            {chip("Lab: All", qs({ lab: undefined }), !params.lab)}
            {labs.map((l) => chip(l.code, qs({ lab: l.code }), params.lab === l.code))}
          </>
        )}
      </div>

      {q && (
        <p className="mt-2 text-sm text-muted">
          Search: “{q}” — <Link href={qs({ q: undefined })} className="text-teal underline">clear</Link>
        </p>
      )}

      {/* Scope banner */}
      {rows.length > 0 && editableCount < rows.length && (
        <div className="mt-3 rounded-md border border-accent/30 bg-accent-soft px-4 py-2 text-sm">
          You can adjust {editableCount} of the {rows.length} rows shown. Rows marked 🔒 sit in
          another custody — use <em>Request transfer</em> to ask their custodian.
        </div>
      )}

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Chemical</th>
              <th className="px-2 py-2.5">CAS</th>
              <th className="px-2 py-2.5">Hazard</th>
              <th className="px-2 py-2.5">Location</th>
              <th className="px-2 py-2.5 text-right">Pack</th>
              <th className="px-2 py-2.5 text-right">Remaining</th>
              <th className="px-2 py-2.5">Expiry</th>
              <th className="px-4 py-2.5">Adjust</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ container: c, mode, belowMin }) => (
              <tr
                key={c.id}
                className={`border-b border-line last:border-0 ${
                  mode === "editable" ? "" : "bg-paper/60 text-muted"
                }`}
              >
                <td className="px-4 py-2">
                  <Link href={`/chemicals/${c.substanceId}`} className="font-medium text-ink hover:text-teal hover:underline">
                    {c.substance.name}
                  </Link>
                  <span className="ml-2 text-xs text-muted">{c.code}</span>
                  {c.substance.isControlled && (
                    <span className="ml-2">
                      <ControlledPill />
                    </span>
                  )}
                  {c.status !== "ACTIVE" && (
                    <span className="ml-2">
                      <StatusPill status={c.status} />
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-xs">{c.substance.casNumber ?? "—"}</td>
                <td className="px-2 py-2">
                  <HazardPill storageClass={c.substance.ghs?.storageClass} />
                </td>
                <td className="px-2 py-2 text-xs">
                  {c.lab.code}
                  {c.location ? ` · ${c.location.code}` : ""}
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  {formatQuantity(c.initialQuantity.toNumber(), c.unit)}
                </td>
                <td className={`px-2 py-2 text-right font-medium whitespace-nowrap ${belowMin ? "text-warning" : ""}`}>
                  {formatQuantity(c.currentQuantity.toNumber(), c.unit)}
                  {belowMin && <span className="ml-1 text-xs">low</span>}
                </td>
                <td className="px-2 py-2">
                  <ExpiryPill expiryDate={c.expiryDate} />
                </td>
                <td className="px-4 py-2">
                  {c.status === "DISPOSED" ? (
                    <span className="text-xs text-muted">
                      Disposed {c.transactions[0]?.createdAt.toLocaleDateString("en-GB") ?? ""}
                      {c.transactions[0]?.reason ? ` — ${c.transactions[0].reason}` : ""}
                    </span>
                  ) : (
                  <div className="flex items-center gap-2">
                    <RowAdjust
                      target={{
                        containerId: c.id,
                        code: c.code,
                        substanceName: c.substance.name,
                        cas: c.substance.casNumber,
                        unit: c.unit,
                        currentQuantity: c.currentQuantity.toNumber(),
                        packSize: c.initialQuantity.toNumber(),
                        minLevel:
                          c.substance.minStockLevel !== null && c.substance.minStockUnit === c.unit
                            ? c.substance.minStockLevel.toNumber()
                            : null,
                        isControlled: c.substance.isControlled,
                      }}
                      mode={mode}
                      custodianName={c.custodian?.name ?? null}
                    />
                    {mode === "request-only" && <RequestTransferButton containerId={c.id} compact />}
                  </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  No containers match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
