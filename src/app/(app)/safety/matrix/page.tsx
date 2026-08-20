// Storage compatibility per cabinet: segregation matrix, contents, conflicts
// and a concrete suggested resolution — every warning proposes a fix.

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { checkPlacement, scanCabinet, verdictFor, loadRuleMap } from "@/server/compatibility";
import { requireUser } from "@/server/session";
import { formatQuantity } from "@/server/units";
import { Pill } from "@/components/pills";
import { moveContainerAction } from "../actions";

export const dynamic = "force-dynamic";

const CLASSES = ["FLAMMABLE", "OXIDISER", "ACID", "BASE", "TOXIC", "WATER_REACTIVE"];
const CLASS_SHORT: Record<string, string> = {
  FLAMMABLE: "Flam.",
  OXIDISER: "Oxid.",
  ACID: "Acid",
  BASE: "Base",
  TOXIC: "Toxic",
  WATER_REACTIVE: "Water-r.",
};

export default async function MatrixPage({
  searchParams,
}: {
  searchParams: Promise<{ cabinet?: string }>;
}) {
  await requireUser();
  const params = await searchParams;

  const cabinets = await prisma.storageLocation.findMany({
    where: { parentId: null },
    include: { lab: { select: { code: true } } },
    orderBy: [{ lab: { code: "asc" } }, { code: "asc" }],
  });
  const selected = cabinets.find((c) => c.id === params.cabinet) ?? cabinets[0];
  const rules = await loadRuleMap(prisma);

  const scan = selected ? await scanCabinet(prisma, selected.id) : null;

  // Contents grouped by substance.
  const contents = selected
    ? await prisma.container.findMany({
        where: {
          locationId: {
            in: (
              await prisma.storageLocation.findMany({
                where: { OR: [{ id: selected.id }, { parentId: selected.id }] },
                select: { id: true },
              })
            ).map((l) => l.id),
          },
          status: { in: ["ACTIVE", "EMPTY"] },
        },
        include: {
          substance: { include: { ghs: { select: { storageClass: true } } } },
          location: { select: { code: true } },
        },
        orderBy: { code: "asc" },
      })
    : [];

  // Which storage classes are in conflict, and which class is the minority?
  const conflictClasses = new Set<string>();
  for (const c of scan?.conflicts ?? []) {
    conflictClasses.add(c.classA);
    conflictClasses.add(c.classB);
  }
  const classCounts = new Map<string, number>();
  for (const c of contents) {
    const sc = c.substance.ghs?.storageClass;
    if (sc) classCounts.set(sc, (classCounts.get(sc) ?? 0) + 1);
  }
  const minorityClass = [...conflictClasses].sort(
    (a, b) => (classCounts.get(a) ?? 0) - (classCounts.get(b) ?? 0),
  )[0];
  const movers = contents.filter((c) => c.substance.ghs?.storageClass === minorityClass);

  // Suggested destination: another cabinet in the same lab that is compatible.
  let suggestion: { container: (typeof movers)[number]; destination: { id: string; code: string; name: string | null } } | null = null;
  if (selected && movers.length > 0 && minorityClass) {
    for (const candidate of cabinets.filter((c) => c.labId === selected.labId && c.id !== selected.id)) {
      const placement = await checkPlacement(prisma, candidate.id, minorityClass);
      if (placement.verdict === "COMPATIBLE") {
        suggestion = { container: movers[0], destination: { id: candidate.id, code: candidate.code, name: candidate.name } };
        break;
      }
    }
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-teal-deep">Compatibility check</h1>
      <p className="text-sm text-muted">
        Safety · Compatibility {selected ? `· ${selected.name ?? selected.code}, ${selected.lab.code}` : ""}
      </p>

      {/* Cabinet picker */}
      <div className="mt-4 flex flex-wrap gap-2">
        {cabinets.map((c) => (
          <Link
            key={c.id}
            href={`/safety/matrix?cabinet=${c.id}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              selected?.id === c.id
                ? "border-teal bg-teal-soft text-teal-deep"
                : "border-line bg-card text-muted hover:bg-paper"
            }`}
          >
            {c.lab.code} · {c.code}
          </Link>
        ))}
      </div>

      {/* Conflict banner + suggested fix */}
      {scan && scan.conflicts.length > 0 && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger-soft p-4">
          <div className="text-sm font-semibold text-danger">
            ⚠ {scan.conflicts.length} conflict{scan.conflicts.length === 1 ? "" : "s"} in{" "}
            {selected!.code}
          </div>
          <ul className="mt-1 text-sm">
            {scan.conflicts.slice(0, 5).map((c, i) => (
              <li key={i}>
                {c.substanceA} ({CLASS_SHORT[c.classA] ?? c.classA}) ×{" "}
                {c.substanceB} ({CLASS_SHORT[c.classB] ?? c.classB}) —{" "}
                {c.verdict === "NEVER_TOGETHER" ? "never together" : "segregate"}
              </li>
            ))}
            {scan.conflicts.length > 5 && <li>… and {scan.conflicts.length - 5} more pairs</li>}
          </ul>
          {suggestion && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-line bg-card px-3 py-2">
              <span className="text-sm">
                Suggested: move <strong>{suggestion.container.code}</strong> (
                {suggestion.container.substance.name}) to{" "}
                <strong>{suggestion.destination.name ?? suggestion.destination.code}</strong> — no
                conflict there.
              </span>
              <form action={moveContainerAction}>
                <input type="hidden" name="containerId" value={suggestion.container.id} />
                <input type="hidden" name="toLocationId" value={suggestion.destination.id} />
                <button className="rounded-md bg-teal px-3 py-1 text-xs font-semibold text-white hover:bg-teal-deep">
                  Move now
                </button>
              </form>
            </div>
          )}
        </div>
      )}
      {scan && scan.conflicts.length === 0 && (
        <div className="mt-4 rounded-lg border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
          ✓ No conflicts in this cabinet. The nightly re-check keeps it that way.
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Segregation matrix */}
        <section className="rounded-lg border border-line bg-card p-4">
          <h2 className="text-sm font-semibold text-teal-deep">Segregation matrix</h2>
          <table className="mt-2 text-center text-sm">
            <thead>
              <tr>
                <th />
                {CLASSES.map((c) => (
                  <th key={c} className="px-2 py-1 text-xs font-medium text-muted">
                    {CLASS_SHORT[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CLASSES.map((row) => (
                <tr key={row}>
                  <th className="px-2 py-1 text-left text-xs font-medium text-muted">{CLASS_SHORT[row]}</th>
                  {CLASSES.map((col) => {
                    const v = verdictFor(rules, row, col);
                    return (
                      <td key={col} className="px-2 py-1">
                        {v === "COMPATIBLE" ? (
                          <span className="text-ok">✓</span>
                        ) : v === "SEGREGATE" ? (
                          <span className="font-bold text-warning">!</span>
                        ) : (
                          <span className="font-bold text-danger">✕</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            <span className="text-ok">✓ Compatible</span> ·{" "}
            <span className="text-warning">! Segregate (separate shelf or tray)</span> ·{" "}
            <span className="text-danger">✕ Never together</span> — derived from GHS storage
            classes; no separately maintained rule table.
          </p>
        </section>

        {/* Cabinet contents */}
        <section className="rounded-lg border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-teal-deep">
              Contents — {scan?.containerCount ?? 0} containers
            </h2>
            {selected?.maxVolumeL && (
              <span className="text-xs text-muted">
                {scan?.totalVolumeL.toFixed(1)} L of {selected.maxVolumeL.toString()} L limit
              </span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-muted uppercase">
                <th className="px-4 py-2">Chemical</th>
                <th className="px-2 py-2">Class</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2">Shelf</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {contents.map((c) => {
                const sc = c.substance.ghs?.storageClass;
                const inConflict = sc ? conflictClasses.has(sc) && sc === minorityClass : false;
                return (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-4 py-1.5">
                      {c.substance.name}
                      <span className="ml-1 text-xs text-muted">{c.code}</span>
                    </td>
                    <td className="px-2 py-1.5 text-xs">{sc ? (CLASS_SHORT[sc] ?? sc) : "—"}</td>
                    <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap">
                      {formatQuantity(c.currentQuantity.toNumber(), c.unit)}
                    </td>
                    <td className="px-2 py-1.5 text-xs">{c.location?.code ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      {inConflict ? <Pill tone="danger">Conflict</Pill> : <Pill tone="ok">OK</Pill>}
                    </td>
                  </tr>
                );
              })}
              {contents.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    Cabinet is empty.
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
