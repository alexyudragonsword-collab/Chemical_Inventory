// Import fixup worklist — every unresolved issue the legacy import could not
// decide on its own: unassigned custodians, incomplete locations, ambiguous
// units, substances without CAS numbers. Each fix is an audited correction.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";
import { Pill } from "@/components/pills";
import {
  assignCustodianAction,
  fixLocationAction,
  fixUnitAction,
  setCasAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function ImportFixupPage() {
  const user = await requireUser();
  if (!can(user, "resolve_import_fixup")) {
    return <p className="text-sm text-muted">You do not have access to the import fixup worklist.</p>;
  }

  const [pendingContainers, pendingSubstances, users, pendingCount, casCount] = await Promise.all([
    prisma.container.findMany({
      where: { pendingCorrection: { not: Prisma.DbNull } },
      include: {
        substance: { select: { name: true } },
        lab: { select: { id: true, code: true, name: true, locations: { select: { id: true, code: true }, orderBy: { code: "asc" } } } },
        custodian: { select: { name: true } },
      },
      orderBy: { code: "asc" },
      take: 100,
    }),
    prisma.substance.findMany({
      where: { needsCasEnrichment: true },
      orderBy: { name: "asc" },
      take: 100,
      select: { id: true, name: true, legacyHazardCode: true, supplierProducts: true },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.container.count({ where: { pendingCorrection: { not: Prisma.DbNull } } }),
    prisma.substance.count({ where: { needsCasEnrichment: true } }),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-teal-deep">Import fixup</h1>
      <p className="text-sm text-muted">
        Admin · {pendingCount} containers pending correction · {casCount} substances without CAS
      </p>

      <section className="mt-5 rounded-lg border border-line bg-card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-teal-deep">
          Containers pending correction {pendingCount > 100 ? `(first 100 of ${pendingCount})` : ""}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-muted uppercase">
                <th className="px-4 py-2">Container</th>
                <th className="px-2 py-2">Chemical</th>
                <th className="px-2 py-2">Lab</th>
                <th className="px-2 py-2">Issues</th>
                <th className="px-4 py-2">Fix</th>
              </tr>
            </thead>
            <tbody>
              {pendingContainers.map((c) => {
                const pending = (c.pendingCorrection ?? {}) as Record<string, string>;
                return (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="px-4 py-2 font-medium whitespace-nowrap">{c.code}</td>
                    <td className="px-2 py-2">{c.substance.name}</td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">{c.lab.code}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col gap-1">
                        {pending.custodian && (
                          <Pill tone="warning">Custodian: {pending.custodian}</Pill>
                        )}
                        {pending.pi && <Pill tone="neutral">PI: {pending.pi}</Pill>}
                        {pending.unit && <Pill tone="danger">Unit: {pending.unit}</Pill>}
                        {pending.rawLocation && (
                          <Pill tone="warning">Location: {pending.rawLocation}</Pill>
                        )}
                        {pending.quantity && <Pill tone="danger">Qty missing</Pill>}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-1.5">
                        {(pending.custodian || pending.pi) && (
                          <form action={assignCustodianAction} className="flex items-center gap-1.5">
                            <input type="hidden" name="containerId" value={c.id} />
                            <select name="userId" className="rounded border border-line px-2 py-1 text-xs" defaultValue="">
                              <option value="">Assign custodian…</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                            <button className="rounded bg-teal px-2 py-1 text-xs font-medium text-white hover:bg-teal-deep">
                              Set
                            </button>
                          </form>
                        )}
                        {pending.rawLocation && c.lab.locations.length > 0 && (
                          <form action={fixLocationAction} className="flex items-center gap-1.5">
                            <input type="hidden" name="containerId" value={c.id} />
                            <select name="locationId" className="rounded border border-line px-2 py-1 text-xs" defaultValue="">
                              <option value="">Assign location…</option>
                              {c.lab.locations.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.code}
                                </option>
                              ))}
                            </select>
                            <button className="rounded bg-teal px-2 py-1 text-xs font-medium text-white hover:bg-teal-deep">
                              Set
                            </button>
                          </form>
                        )}
                        {(pending.unit || pending.quantity) && (
                          <form action={fixUnitAction} className="flex items-center gap-1.5">
                            <input type="hidden" name="containerId" value={c.id} />
                            <input
                              name="quantity"
                              type="number"
                              step="any"
                              min={0}
                              placeholder={c.currentQuantity.toString()}
                              className="w-20 rounded border border-line px-2 py-1 text-xs"
                            />
                            <select name="unit" className="rounded border border-line px-2 py-1 text-xs" defaultValue="">
                              <option value="">Unit…</option>
                              {["mg", "g", "kg", "mL", "L", "unit"].map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                            <button className="rounded bg-teal px-2 py-1 text-xs font-medium text-white hover:bg-teal-deep">
                              Set
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pendingContainers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    Nothing pending — the import is fully reconciled.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-line bg-card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-teal-deep">
          Substances without a CAS number {casCount > 100 ? `(first 100 of ${casCount})` : ""}
        </h2>
        <ul className="divide-y divide-line">
          {pendingSubstances.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 text-sm">
                {s.name}
                <span className="ml-2 text-xs text-muted">
                  {s.supplierProducts.map((p) => `${p.supplier} ${p.catalogNumber}`).join(" · ")}
                  {s.legacyHazardCode ? ` · class ${s.legacyHazardCode}` : ""}
                </span>
              </span>
              <form action={setCasAction} className="flex items-center gap-1.5">
                <input type="hidden" name="substanceId" value={s.id} />
                <input
                  name="cas"
                  placeholder="CAS e.g. 67-64-1"
                  pattern="\d{2,7}-\d{2}-\d"
                  className="w-36 rounded border border-line px-2 py-1 text-xs"
                />
                <button className="rounded bg-teal px-2 py-1 text-xs font-medium text-white hover:bg-teal-deep">
                  Save
                </button>
              </form>
            </li>
          ))}
          {pendingSubstances.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted">All substances have CAS numbers.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
