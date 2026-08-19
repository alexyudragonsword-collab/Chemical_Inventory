// GHS classification editor — classification is DATA, not a PDF, so it can
// drive labels, storage rules and reporting. EHS Officer / Admin edit;
// everyone else reads.

import Link from "next/link";
import { GhsPictogram } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";
import { Pill } from "@/components/pills";
import { addStatementAction, removeStatementAction, saveClassificationAction } from "./actions";

export const dynamic = "force-dynamic";

const PICTOGRAMS: { code: GhsPictogram; symbol: string; label: string }[] = [
  { code: "GHS02_FLAMMABLE", symbol: "🔥", label: "Flammable" },
  { code: "GHS06_TOXIC", symbol: "☠", label: "Acute toxic" },
  { code: "GHS07_IRRITANT", symbol: "❗", label: "Irritant" },
  { code: "GHS03_OXIDISER", symbol: "⌾", label: "Oxidiser" },
  { code: "GHS08_HEALTH_HAZARD", symbol: "☢", label: "Health hazard" },
  { code: "GHS05_CORROSIVE", symbol: "🜂", label: "Corrosive" },
  { code: "GHS04_GAS", symbol: "⚗", label: "Gas under press." },
  { code: "GHS01_EXPLOSIVE", symbol: "✹", label: "Explosive" },
  { code: "GHS09_ENVIRONMENT", symbol: "🌊", label: "Environmental" },
];

const STORAGE_CLASSES = ["FLAMMABLE", "OXIDISER", "ACID", "BASE", "TOXIC", "WATER_REACTIVE", "GENERAL"];

export default async function ClassificationPage({
  searchParams,
}: {
  searchParams: Promise<{ substance?: string; q?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const editable = can(user, "edit_ghs");

  const substance = params.substance
    ? await prisma.substance.findUnique({
        where: { id: params.substance },
        include: {
          ghs: {
            include: {
              hStatements: { include: { statement: true }, orderBy: { hCode: "asc" } },
              pStatements: { include: { statement: true }, orderBy: { pCode: "asc" } },
            },
          },
        },
      })
    : null;

  const list = await prisma.substance.findMany({
    where: params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" } },
            { casNumber: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {},
    include: { ghs: { select: { pictograms: true, storageClass: true } } },
    orderBy: [{ ghs: { storageClass: { sort: "asc", nulls: "first" } } }, { name: "asc" }],
    take: 30,
  });

  const [hRef, pRef] = substance
    ? await Promise.all([
        prisma.hStatement.findMany({ orderBy: { code: "asc" } }),
        prisma.pStatement.findMany({ orderBy: { code: "asc" } }),
      ])
    : [[], []];

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-teal-deep">GHS classification</h1>
      <p className="text-sm text-muted">
        Safety · Classification{substance ? ` · ${substance.name}` : ""} ·{" "}
        {editable ? "editable (EHS)" : "read-only"}
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* Substance list */}
        <div>
          <form action="/safety/classification" className="flex gap-1">
            <input name="q" defaultValue={params.q ?? ""} placeholder="⌕ Name or CAS" className="input" />
          </form>
          <ul className="mt-2 max-h-[32rem] divide-y divide-line overflow-y-auto rounded-lg border border-line bg-white">
            {list.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/safety/classification?substance=${s.id}${params.q ? `&q=${params.q}` : ""}`}
                  className={`block px-3 py-2 text-sm hover:bg-paper ${substance?.id === s.id ? "bg-teal-soft" : ""}`}
                >
                  <span className="block truncate">{s.name}</span>
                  <span className="text-xs text-muted">
                    {s.casNumber ?? "no CAS"} · {s.ghs?.storageClass ?? "unclassified"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Editor */}
        {substance ? (
          <div>
            <form action={saveClassificationAction} className="rounded-lg border border-line bg-white p-4">
              <input type="hidden" name="substanceId" value={substance.id} />
              <h2 className="text-sm font-semibold text-teal-deep">
                Pictograms — {editable ? "tap to toggle" : "read-only"}
              </h2>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
                {PICTOGRAMS.map((p) => {
                  const active = substance.ghs?.pictograms.includes(p.code) ?? false;
                  return (
                    <label
                      key={p.code}
                      className={`flex cursor-pointer flex-col items-center rounded-md border p-2 text-center ${
                        active ? "border-danger/40 bg-danger-soft" : "border-line bg-paper opacity-60"
                      } ${editable ? "" : "pointer-events-none"}`}
                    >
                      <input
                        type="checkbox"
                        name="pictograms"
                        value={p.code}
                        defaultChecked={active}
                        disabled={!editable}
                        className="sr-only"
                      />
                      <span className="text-xl">{p.symbol}</span>
                      <span className="mt-0.5 text-[10px] leading-tight text-muted">{p.label}</span>
                    </label>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap gap-4">
                <label className="text-xs font-semibold tracking-wide text-muted uppercase">
                  Signal word
                  <select
                    name="signalWord"
                    defaultValue={substance.ghs?.signalWord ?? "NONE"}
                    disabled={!editable}
                    className="input mt-1 w-36"
                  >
                    <option value="DANGER">DANGER</option>
                    <option value="WARNING">WARNING</option>
                    <option value="NONE">None</option>
                  </select>
                </label>
                <label className="text-xs font-semibold tracking-wide text-muted uppercase">
                  Storage class (drives the segregation matrix)
                  <select
                    name="storageClass"
                    defaultValue={substance.ghs?.storageClass ?? ""}
                    disabled={!editable}
                    className="input mt-1 w-44"
                  >
                    <option value="">Unclassified</option>
                    {STORAGE_CLASSES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                {editable && (
                  <button className="mt-4 h-9 self-start rounded-md bg-teal px-4 text-sm font-semibold text-white hover:bg-teal-deep">
                    Save classification
                  </button>
                )}
              </div>
            </form>

            {/* Statements */}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {(
                [
                  ["H", "Hazard statements", substance.ghs?.hStatements ?? [], hRef],
                  ["P", "Precautionary statements", substance.ghs?.pStatements ?? [], pRef],
                ] as const
              ).map(([kind, title, statements, ref]) => (
                <section key={kind} className="rounded-lg border border-line bg-white">
                  <h3 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-teal-deep">
                    {title}
                  </h3>
                  <ul className="divide-y divide-line">
                    {statements.map((s) => {
                      const code = "hCode" in s ? s.hCode : s.pCode;
                      return (
                        <li key={code} className="flex items-start gap-2 px-4 py-2 text-sm">
                          <span className="min-w-0 flex-1">
                            <strong>{code}</strong> {s.statement.text}
                            <span className="ml-2">
                              <Pill tone={s.source === "LOCAL_EHS_RULE" ? "info" : s.source === "AUTO_DERIVED" ? "neutral" : "ok"}>
                                {s.source === "SUPPLIER_SDS" ? "Supplier SDS" : s.source === "AUTO_DERIVED" ? "Auto-derived" : "Local EHS rule"}
                              </Pill>
                            </span>
                          </span>
                          {editable && (
                            <form action={removeStatementAction}>
                              <input type="hidden" name="substanceId" value={substance.id} />
                              <input type="hidden" name="kind" value={kind} />
                              <input type="hidden" name="code" value={code} />
                              <button className="text-xs text-muted hover:text-danger" title="Remove">
                                ✕
                              </button>
                            </form>
                          )}
                        </li>
                      );
                    })}
                    {statements.length === 0 && (
                      <li className="px-4 py-4 text-center text-xs text-muted">None recorded.</li>
                    )}
                  </ul>
                  {editable && (
                    <form action={addStatementAction} className="flex gap-1.5 border-t border-line p-3">
                      <input type="hidden" name="substanceId" value={substance.id} />
                      <input type="hidden" name="kind" value={kind} />
                      <select name="code" className="input flex-1" defaultValue="">
                        <option value="">Add {kind}-statement…</option>
                        {ref.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.code} — {r.text.slice(0, 60)}
                          </option>
                        ))}
                      </select>
                      <select name="source" className="input w-36" defaultValue="SUPPLIER_SDS">
                        <option value="SUPPLIER_SDS">Supplier SDS</option>
                        <option value="AUTO_DERIVED">Auto-derived</option>
                        <option value="LOCAL_EHS_RULE">Local EHS rule</option>
                      </select>
                      <button className="rounded-md bg-teal px-3 text-sm font-semibold text-white hover:bg-teal-deep">
                        +
                      </button>
                    </form>
                  )}
                </section>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-line bg-white px-4 py-16 text-center text-sm text-muted">
            Pick a substance to view or edit its classification. Unclassified substances sort first.
          </p>
        )}
      </div>
    </div>
  );
}
