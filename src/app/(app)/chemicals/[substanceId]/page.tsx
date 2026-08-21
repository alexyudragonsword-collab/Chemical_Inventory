// Chemical detail — everything about one substance in one scroll: identity,
// hazard, containers across labs, documents, my-custody consumption.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { authorizeContainer, isInCustody } from "@/server/authz";
import { custodyWhere } from "@/server/queries";
import { requireUser } from "@/server/session";
import { formatQuantity } from "@/server/units";
import { GhsPictogramGrid } from "@/components/ghs-pictogram-grid";
import { ControlledPill, CustodyPill, ExpiryPill, StatusPill } from "@/components/pills";
import { RowAdjust } from "@/components/row-adjust";
import { RequestTransferButton } from "@/components/request-transfer-button";

export const dynamic = "force-dynamic";

export default async function ChemicalDetailPage({
  params,
}: {
  params: Promise<{ substanceId: string }>;
}) {
  const user = await requireUser();
  const { substanceId } = await params;

  const substance = await prisma.substance.findUnique({
    where: { id: substanceId },
    include: {
      ghs: {
        include: {
          hStatements: { include: { statement: true } },
          pStatements: { include: { statement: true } },
        },
      },
      supplierProducts: true,
      sdsDocuments: { orderBy: { createdAt: "desc" } },
      containers: {
        where: { status: { notIn: ["DISPOSED"] } },
        include: {
          lab: { select: { code: true } },
          location: { select: { code: true, name: true } },
          custodian: { select: { name: true } },
        },
        orderBy: [{ lab: { code: "asc" } }, { code: "asc" }],
      },
    },
  });
  if (!substance) notFound();

  const incompatibilities = substance.ghs?.storageClass
    ? await prisma.compatibilityRule.findMany({
        where: {
          verdict: { in: ["NEVER_TOGETHER", "SEGREGATE"] },
          OR: [{ classA: substance.ghs.storageClass }, { classB: substance.ghs.storageClass }],
        },
      })
    : [];

  // Consumption over the last 6 months, my custody only (a reorder signal).
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  const consumption = await prisma.inventoryTransaction.findMany({
    where: {
      kind: "DEDUCT",
      createdAt: { gte: sixMonthsAgo },
      container: { AND: [{ substanceId }, custodyWhere(user)] },
    },
    select: { createdAt: true, quantityBefore: true, quantityAfter: true, unit: true },
  });
  const monthly = new Map<string, number>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(sixMonthsAgo);
    d.setMonth(d.getMonth() + i);
    monthly.set(d.toLocaleDateString("en-GB", { month: "short" }), 0);
  }
  let consumptionUnit = substance.containers[0]?.unit ?? "ML";
  for (const t of consumption) {
    const key = t.createdAt.toLocaleDateString("en-GB", { month: "short" });
    const used = t.quantityBefore.toNumber() - t.quantityAfter.toNumber();
    consumptionUnit = t.unit;
    if (monthly.has(key)) monthly.set(key, (monthly.get(key) ?? 0) + used);
  }
  const maxMonthly = Math.max(1, ...monthly.values());

  const labCount = new Set(substance.containers.map((c) => c.labId)).size;
  const activeH = substance.ghs?.hStatements ?? [];

  return (
    <div className="max-w-5xl">
      <p className="text-xs text-muted">
        <Link href="/inventory?scope=all" className="hover:underline">
          Inventory
        </Link>{" "}
        › All chemicals › {substance.name}
      </p>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-teal-deep">
            {substance.name}
            {substance.isControlled && (
              <span className="ml-2 align-middle">
                <ControlledPill />
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {substance.casNumber ? `CAS ${substance.casNumber}` : "CAS —"}
            {substance.ecNumber ? ` · EC ${substance.ecNumber}` : ""}
            {substance.unNumber ? ` · UN ${substance.unNumber}` : ""}
            {substance.legacyHazardCode ? ` · legacy class ${substance.legacyHazardCode}` : ""}
          </p>
          {substance.supplierProducts.length > 0 && (
            <p className="mt-1 text-xs text-muted">
              {substance.supplierProducts.map((sp) => `${sp.supplier} ${sp.catalogNumber}`).join(" · ")}
            </p>
          )}
        </div>
        <Link
          href={`/availability?substance=${substance.id}`}
          className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep"
        >
          Where is it?
        </Link>
      </div>

      {/* Hazard block */}
      <section className="mt-5 rounded-lg border border-line bg-card p-4">
        <div className="flex flex-wrap items-start gap-6">
          <GhsPictogramGrid active={substance.ghs?.pictograms ?? []} />
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              <span className="font-semibold">
                {substance.ghs?.signalWord === "NONE" || !substance.ghs
                  ? "No signal word"
                  : substance.ghs.signalWord}
              </span>
              {activeH.length > 0 && (
                <span className="ml-2 text-muted">
                  {activeH.map((h) => h.hCode).join(" · ")}
                </span>
              )}
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {activeH.slice(0, 5).map((h) => (
                <li key={h.hCode}>
                  <span className="font-medium text-ink">{h.hCode}</span> {h.statement.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Properties & handling */}
      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-card p-4">
          <h2 className="text-sm font-semibold text-teal-deep">Properties &amp; handling</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Prop label="Storage class" value={substance.ghs?.storageClass ?? "Not classified"} />
            <Prop
              label="Incompatible with"
              value={
                incompatibilities.length
                  ? incompatibilities
                      .map((r) => (r.classA === substance.ghs?.storageClass ? r.classB : r.classA))
                      .filter((c, i, arr) => arr.indexOf(c) === i)
                      .join(", ")
                  : "—"
              }
            />
            <Prop
              label="Min stock level"
              value={
                substance.minStockLevel && substance.minStockUnit
                  ? formatQuantity(substance.minStockLevel.toNumber(), substance.minStockUnit)
                  : "Not set"
              }
            />
            <Prop label="Regulated" value={substance.isControlled ? "Yes — licensed" : "No"} />
          </dl>
        </div>

        {/* Consumption chart */}
        <div className="rounded-lg border border-line bg-card p-4">
          <h2 className="text-sm font-semibold text-teal-deep">
            Consumption — last 6 months (my custody)
          </h2>
          <div className="mt-3 flex h-28 items-end gap-2">
            {[...monthly.entries()].map(([month, used]) => (
              <div key={month} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] text-muted">
                  {used > 0 ? formatQuantity(used, consumptionUnit) : ""}
                </span>
                <div
                  className="w-full rounded-t bg-teal/70"
                  style={{ height: `${Math.round((used / maxMonthly) * 80)}px` }}
                />
                <span className="text-[10px] text-muted">{month}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Containers */}
      <section className="mt-4 rounded-lg border border-line bg-card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-teal-deep">
          Containers — {substance.containers.length} across {labCount} lab{labCount === 1 ? "" : "s"}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-muted uppercase">
                <th className="px-4 py-2">Container</th>
                <th className="px-2 py-2">Lab</th>
                <th className="px-2 py-2">Custodian</th>
                <th className="px-2 py-2 text-right">Pack</th>
                <th className="px-2 py-2 text-right">Remaining</th>
                <th className="px-2 py-2">Location</th>
                <th className="px-2 py-2">Expiry</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-4 py-2">Adjust</th>
              </tr>
            </thead>
            <tbody>
              {substance.containers.map((c) => {
                const mode = authorizeContainer(user, "deduct", {
                  id: c.id,
                  labId: c.labId,
                  custodianId: c.custodianId,
                  isControlled: substance.isControlled,
                });
                const mine = isInCustody(user, {
                  id: c.id,
                  labId: c.labId,
                  custodianId: c.custodianId,
                  isControlled: substance.isControlled,
                });
                return (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-4 py-2 font-medium">
                      {c.code}
                      {mine && (
                        <span className="ml-2">
                          <CustodyPill />
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">{c.lab.code}</td>
                    <td className="px-2 py-2 text-xs">{c.custodian?.name ?? "Unassigned"}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {formatQuantity(c.initialQuantity.toNumber(), c.unit)}
                    </td>
                    <td className="px-2 py-2 text-right font-medium whitespace-nowrap">
                      {formatQuantity(c.currentQuantity.toNumber(), c.unit)}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {c.location ? (c.location.name ?? c.location.code) : "—"}
                    </td>
                    <td className="px-2 py-2">
                      <ExpiryPill expiryDate={c.expiryDate} />
                    </td>
                    <td className="px-2 py-2">
                      <StatusPill status={c.status} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <RowAdjust
                          target={{
                            containerId: c.id,
                            code: c.code,
                            substanceName: substance.name,
                            cas: substance.casNumber,
                            unit: c.unit,
                            currentQuantity: c.currentQuantity.toNumber(),
                            packSize: c.initialQuantity.toNumber(),
                            minLevel:
                              substance.minStockLevel !== null && substance.minStockUnit === c.unit
                                ? substance.minStockLevel.toNumber()
                                : null,
                            isControlled: substance.isControlled,
                          }}
                          mode={mode}
                          custodianName={c.custodian?.name ?? null}
                        />
                        {mode === "request-only" && (
                          <RequestTransferButton containerId={c.id} compact />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {substance.containers.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted">
                    No containers on record.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Empty containers stay listed until formally disposed of — an untracked empty bottle is
          still a compliance object.
        </p>
      </section>

      {/* Documents */}
      <section className="mt-4 rounded-lg border border-line bg-card p-4">
        <h2 className="text-sm font-semibold text-teal-deep">Documents</h2>
        {substance.sdsDocuments.length === 0 ? (
          <p className="mt-2 text-sm text-warning">
            No safety data sheet on file — this is a compliance gap.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-3">
            {substance.sdsDocuments.map((d) => (
              <li key={d.id} className="rounded-md border border-line px-3 py-2 text-sm">
                📄 Safety data sheet
                <span className="ml-2 text-xs text-muted">
                  rev {d.revision} · {d.language}
                  {d.status !== "CURRENT" ? ` · ${d.status.toLowerCase()}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Prop({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </>
  );
}
