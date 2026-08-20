// "Where is this chemical?" — search one substance and see its distribution
// across every lab; the screen that replaces phone calls between labs.

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { isInCustody } from "@/server/authz";
import { requireUser } from "@/server/session";
import { convert, formatQuantity, sameDimension } from "@/server/units";
import { CustodyPill, ExpiryPill, HazardPill, Pill } from "@/components/pills";
import { RequestTransferButton } from "@/components/request-transfer-button";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ substance?: string; q?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  let substance = params.substance
    ? await prisma.substance.findUnique({ where: { id: params.substance }, include: { ghs: true } })
    : null;

  let matches: { id: string; name: string; casNumber: string | null }[] = [];
  if (!substance && params.q) {
    matches = await prisma.substance.findMany({
      where: {
        OR: [
          { name: { contains: params.q, mode: "insensitive" } },
          { casNumber: { contains: params.q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, casNumber: true },
      take: 20,
      orderBy: { name: "asc" },
    });
    if (matches.length === 1) {
      substance = await prisma.substance.findUnique({
        where: { id: matches[0].id },
        include: { ghs: true },
      });
    }
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-teal-deep">Cross-lab availability</h1>
      <p className="text-sm text-muted">
        Inventory · Lookup{substance ? ` · ${substance.name}${substance.casNumber ? ` (CAS ${substance.casNumber})` : ""}` : ""}
      </p>

      <form className="mt-4 flex max-w-md gap-2" action="/availability">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="⌕  Substance name or CAS"
          className="flex-1 rounded-md border border-line bg-card px-3 py-2 text-sm focus:border-teal focus:outline-none"
        />
        <button className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep">
          Search
        </button>
      </form>

      {!substance && matches.length > 1 && (
        <ul className="mt-4 max-w-md divide-y divide-line rounded-lg border border-line bg-card">
          {matches.map((m) => (
            <li key={m.id}>
              <Link href={`/availability?substance=${m.id}`} className="block px-4 py-2 text-sm hover:bg-paper">
                {m.name}
                {m.casNumber && <span className="ml-2 text-xs text-muted">CAS {m.casNumber}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!substance && params.q && matches.length === 0 && (
        <p className="mt-4 text-sm text-muted">No substance matches “{params.q}”.</p>
      )}

      {substance && <Holdings substanceId={substance.id} storageClass={substance.ghs?.storageClass ?? null} isControlled={substance.isControlled} userId={user.id} user={user} />}
    </div>
  );
}

async function Holdings({
  substanceId,
  storageClass,
  isControlled,
  user,
}: {
  substanceId: string;
  storageClass: string | null;
  isControlled: boolean;
  userId: string;
  user: Awaited<ReturnType<typeof requireUser>>;
}) {
  const containers = await prisma.container.findMany({
    where: { substanceId, status: { in: ["ACTIVE", "EMPTY"] } },
    include: {
      lab: { select: { id: true, code: true, name: true } },
      custodian: { select: { id: true, name: true } },
      location: { select: { code: true, name: true } },
    },
    orderBy: [{ lab: { code: "asc" } }, { expiryDate: "asc" }],
  });

  const active = containers.filter((c) => c.status === "ACTIVE");
  // Estate total in a single displayable unit when dimensions agree.
  let total: string | null = null;
  if (active.length > 0) {
    const baseUnit = active[0].unit;
    if (active.every((c) => sameDimension(c.unit, baseUnit))) {
      const sum = active.reduce((acc, c) => acc + convert(c.currentQuantity.toNumber(), c.unit, baseUnit), 0);
      total = formatQuantity(sum, baseUnit);
    }
  }

  const byLab = new Map<string, typeof containers>();
  for (const c of containers) {
    const list = byLab.get(c.lab.id) ?? [];
    list.push(c);
    byLab.set(c.lab.id, list);
  }

  return (
    <div className="mt-5">
      <div className="flex items-center gap-4 rounded-lg border border-line bg-card px-4 py-3">
        <div>
          <div className="text-xs tracking-wide text-muted uppercase">Total across estate</div>
          <div className="text-2xl font-semibold text-ink">
            {total ?? "mixed units"} · {active.length} container{active.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <HazardPill storageClass={storageClass} />
          {isControlled && <Pill tone="restricted">Controlled</Pill>}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {[...byLab.entries()].map(([labId, labContainers]) => {
          const lab = labContainers[0].lab;
          const activeInLab = labContainers.filter((c) => c.status === "ACTIVE");
          const custodians = [...new Set(labContainers.map((c) => c.custodian?.name ?? "Unassigned"))];
          const mine = labContainers.some((c) =>
            isInCustody(user, { id: c.id, labId: c.labId, custodianId: c.custodianId, isControlled }),
          );
          let labTotal: string | null = null;
          if (activeInLab.length > 0) {
            const u = activeInLab[0].unit;
            if (activeInLab.every((c) => sameDimension(c.unit, u))) {
              labTotal = formatQuantity(
                activeInLab.reduce((acc, c) => acc + convert(c.currentQuantity.toNumber(), c.unit, u), 0),
                u,
              );
            }
          }
          return (
            <details key={labId} className="rounded-lg border border-line bg-card" open={mine}>
              <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
                <span className="font-medium">{lab.code}</span>
                <span className="text-xs text-muted">{lab.name}</span>
                {mine && <CustodyPill />}
                <span className="ml-auto text-sm text-muted">
                  {custodians.join(", ")} · {activeInLab.length} cont. · {labTotal ?? "—"}
                </span>
              </summary>
              <div className="border-t border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs tracking-wide text-muted uppercase">
                      <th className="px-4 py-2">Container</th>
                      <th className="px-2 py-2">Grade / lot</th>
                      <th className="px-2 py-2 text-right">Pack</th>
                      <th className="px-2 py-2 text-right">Remaining</th>
                      <th className="px-2 py-2">Expiry</th>
                      <th className="px-2 py-2">Storage</th>
                      <th className="px-4 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {labContainers.map((c) => {
                      const mineRow = isInCustody(user, {
                        id: c.id,
                        labId: c.labId,
                        custodianId: c.custodianId,
                        isControlled,
                      });
                      return (
                        <tr key={c.id} className="border-t border-line">
                          <td className="px-4 py-2 font-medium">{c.code}</td>
                          <td className="px-2 py-2 text-xs">
                            {c.grade ?? "—"}
                            {c.lotNumber ? ` · ${c.lotNumber}` : ""}
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            {formatQuantity(c.initialQuantity.toNumber(), c.unit)}
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap font-medium">
                            {formatQuantity(c.currentQuantity.toNumber(), c.unit)}
                          </td>
                          <td className="px-2 py-2">
                            <ExpiryPill expiryDate={c.expiryDate} />
                          </td>
                          <td className="px-2 py-2 text-xs">
                            {c.location ? (c.location.name ?? c.location.code) : "—"}
                          </td>
                          <td className="px-4 py-2">
                            {mineRow ? (
                              <Link
                                href={`/chemicals/${substanceId}`}
                                className="rounded-md border border-teal/40 px-2 py-0.5 text-xs text-teal hover:bg-teal-soft"
                              >
                                Adjust
                              </Link>
                            ) : c.status === "ACTIVE" ? (
                              <RequestTransferButton containerId={c.id} compact />
                            ) : (
                              <span className="text-xs text-muted">Empty</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="border-t border-line px-4 py-2 text-xs text-muted">
                  Sorted by soonest expiry, so a borrow request consumes stock that would otherwise
                  be written off.
                </p>
              </div>
            </details>
          );
        })}
        {byLab.size === 0 && (
          <p className="rounded-lg border border-line bg-card px-4 py-8 text-center text-sm text-muted">
            No containers of this substance anywhere in the estate.
          </p>
        )}
      </div>
    </div>
  );
}
