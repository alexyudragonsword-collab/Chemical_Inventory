// One stocktake session: progress by location, live scan feed, discrepancy
// resolution, and sign-off blocked until every discrepancy is handled.

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";
import { formatQuantity } from "@/server/units";
import { Pill } from "@/components/pills";
import { SessionControls, ScanForm, ResolveControls } from "./session-ui";

export const dynamic = "force-dynamic";

export default async function StocktakeSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireUser();
  const { sessionId } = await params;
  const { filter } = await searchParams;

  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    include: {
      lab: { select: { id: true, code: true, name: true } },
      counts: {
        include: {
          container: {
            include: {
              substance: { select: { name: true } },
              location: { select: { code: true } },
            },
          },
        },
        orderBy: { countedAt: "desc" },
      },
    },
  });
  if (!session) notFound();

  const startedBy = await prisma.user.findUnique({
    where: { id: session.startedById },
    select: { name: true },
  });

  const expected = await prisma.container.count({
    where: { labId: session.lab.id, status: "ACTIVE" },
  });
  const matched = session.counts.filter((c) => c.discrepancy === "NONE").length;
  const discrepancies = session.counts.filter((c) => c.discrepancy !== "NONE");
  const unresolved = discrepancies.filter((c) => c.resolution === null);
  const remaining = Math.max(0, expected - session.counts.filter((c) => c.discrepancy !== "UNEXPECTED").length);
  const pct = expected > 0 ? Math.round(((expected - remaining) / expected) * 100) : 0;

  // Per-location progress.
  const locations = await prisma.storageLocation.findMany({
    where: { labId: session.lab.id, parentId: null },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  const containersByCabinet = await prisma.container.findMany({
    where: { labId: session.lab.id, status: "ACTIVE" },
    select: { code: true, location: { select: { id: true, parentId: true } } },
  });
  const scannedCodes = new Set(session.counts.map((c) => c.scannedCode));

  const rows = filter
    ? session.counts.filter((c) =>
        filter === "mismatch"
          ? c.discrepancy === "MISMATCH"
          : filter === "missing"
            ? c.discrepancy === "MISSING"
            : filter === "unexpected"
              ? c.discrepancy === "UNEXPECTED"
              : filter === "expired"
                ? c.discrepancy === "EXPIRED"
                : c.discrepancy !== "NONE",
      )
    : session.counts;

  const active = session.status === "OPEN" || session.status === "PAUSED";
  const canSignOff = can(user, "sign_off_stocktake", session.lab.id);

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-teal-deep">
        Session ST-{session.startedAt.toISOString().slice(0, 10)}-{session.id.slice(-4).toUpperCase()}
      </h1>
      <p className="text-sm text-muted">
        Stocktake · {session.lab.code} — {session.lab.name} ·{" "}
        {session.status === "OPEN" ? "In progress" : session.status.replace("_", " ").toLowerCase()} ·
        started {session.startedAt.toLocaleString("en-GB")} by {startedBy?.name ?? "?"}
      </p>

      {/* Progress */}
      <div className="mt-4 rounded-lg border border-line bg-card p-4">
        <div className="flex items-center justify-between text-sm">
          <span>
            <strong>{matched}</strong> matched · <strong className="text-warning">{discrepancies.length}</strong>{" "}
            discrepancies · <strong>{remaining}</strong> remaining
          </span>
          <span className="text-muted">
            {expected} expected · {pct}% complete
          </span>
        </div>
        {/* Two-colour progress bar: matched teal, discrepancies amber, uncounted grey */}
        <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-line">
          <div className="bg-teal" style={{ width: `${(matched / Math.max(1, expected)) * 100}%` }} />
          <div className="bg-warning" style={{ width: `${(discrepancies.length / Math.max(1, expected)) * 100}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {locations.map((loc) => {
            const inCabinet = containersByCabinet.filter(
              (c) => c.location && (c.location.id === loc.id || c.location.parentId === loc.id),
            );
            const counted = inCabinet.filter((c) => scannedCodes.has(c.code)).length;
            const done = inCabinet.length > 0 && counted === inCabinet.length;
            return (
              <span
                key={loc.id}
                className={`rounded-full border px-2.5 py-1 ${
                  done ? "border-ok/40 bg-ok-soft text-ok" : "border-line bg-paper text-muted"
                }`}
              >
                {loc.name ?? loc.code} {counted} / {inCabinet.length}
              </span>
            );
          })}
        </div>
      </div>

      {active && <ScanForm sessionId={session.id} />}

      {/* Feed */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <FilterChip href={`/stocktake/${session.id}`} label={`All ${session.counts.length}`} active={!filter} />
        <FilterChip href={`/stocktake/${session.id}?filter=mismatch`} label={`Mismatch ${session.counts.filter((c) => c.discrepancy === "MISMATCH").length}`} active={filter === "mismatch"} />
        <FilterChip href={`/stocktake/${session.id}?filter=missing`} label={`Missing ${session.counts.filter((c) => c.discrepancy === "MISSING").length}`} active={filter === "missing"} />
        <FilterChip href={`/stocktake/${session.id}?filter=unexpected`} label={`Unexpected ${session.counts.filter((c) => c.discrepancy === "UNEXPECTED").length}`} active={filter === "unexpected"} />
        <FilterChip href={`/stocktake/${session.id}?filter=expired`} label={`Expired ${session.counts.filter((c) => c.discrepancy === "EXPIRED").length}`} active={filter === "expired"} />
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Time</th>
              <th className="px-2 py-2.5">Container</th>
              <th className="px-2 py-2.5">Chemical</th>
              <th className="px-2 py-2.5 text-right">System</th>
              <th className="px-2 py-2.5 text-right">Counted</th>
              <th className="px-2 py-2.5">Result</th>
              <th className="px-4 py-2.5">Resolution</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2 text-xs whitespace-nowrap text-muted">
                  {c.countedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="px-2 py-2 font-mono text-xs">{c.scannedCode}</td>
                <td className="px-2 py-2">
                  {c.container?.substance.name ?? <span className="text-muted">unknown code</span>}
                  {c.discrepancy === "UNEXPECTED" && c.container && (
                    <span className="ml-1 text-xs text-muted">(foreign)</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right text-xs whitespace-nowrap">
                  {c.container ? formatQuantity(c.container.currentQuantity.toNumber(), c.container.unit) : "—"}
                </td>
                <td className="px-2 py-2 text-right text-xs whitespace-nowrap">
                  {c.countedQuantity !== null && c.container
                    ? formatQuantity(c.countedQuantity.toNumber(), c.container.unit)
                    : c.discrepancy === "MISSING"
                      ? "not found"
                      : "—"}
                </td>
                <td className="px-2 py-2">
                  <DiscrepancyPill kind={c.discrepancy} />
                </td>
                <td className="px-4 py-2">
                  {c.resolution ? (
                    <span className="text-xs text-ok">
                      ✓ {c.resolution.toLowerCase()}
                      {c.note ? ` — ${c.note}` : ""}
                    </span>
                  ) : c.discrepancy !== "NONE" && active !== false ? (
                    <ResolveControls
                      countId={c.id}
                      sessionId={session.id}
                      discrepancy={c.discrepancy}
                      hasContainer={Boolean(c.containerId)}
                    />
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  Nothing here yet — scan containers above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {session.status !== "SIGNED_OFF" && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-card px-4 py-3">
          <span className="text-sm text-muted">
            {unresolved.length > 0
              ? `${unresolved.length} discrepanc${unresolved.length === 1 ? "y" : "ies"} must be resolved or annotated before sign-off.`
              : "All discrepancies handled."}
          </span>
          <SessionControls
            sessionId={session.id}
            status={session.status}
            canSignOff={canSignOff}
            unresolvedCount={unresolved.length}
          />
        </div>
      )}
      {session.status === "SIGNED_OFF" && (
        <p className="mt-4 rounded-lg border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
          Signed off {session.signedOffAt?.toLocaleString("en-GB")}.
        </p>
      )}
    </div>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <a
      href={href}
      className={`rounded-full border px-3 py-1 font-medium ${
        active ? "border-teal bg-teal-soft text-teal-deep" : "border-line bg-card text-muted hover:bg-paper"
      }`}
    >
      {label}
    </a>
  );
}

function DiscrepancyPill({ kind }: { kind: string }) {
  switch (kind) {
    case "NONE":
      return <Pill tone="ok">Match</Pill>;
    case "MISMATCH":
      return <Pill tone="warning">Mismatch</Pill>;
    case "MISSING":
      return <Pill tone="danger">Missing</Pill>;
    case "UNEXPECTED":
      return <Pill tone="info">Unexpected</Pill>;
    case "EXPIRED":
      return <Pill tone="danger">Expired</Pill>;
    default:
      return <Pill tone="neutral">{kind}</Pill>;
  }
}
