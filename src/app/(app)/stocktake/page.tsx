import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";
import { Pill } from "@/components/pills";
import { startStocktakeAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function StocktakeListPage() {
  const user = await requireUser();

  const [sessions, labs] = await Promise.all([
    prisma.stocktakeSession.findMany({
      include: {
        lab: { select: { code: true, name: true } },
        counts: { select: { discrepancy: true, resolution: true } },
      },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
    prisma.lab.findMany({
      where:
        user.role === "ADMIN" || user.role === "EHS_OFFICER"
          ? {}
          : { id: { in: user.memberships.filter((m) => m.isManager).map((m) => m.labId) } },
      orderBy: { code: "asc" },
    }),
  ]);

  const canStart = labs.length > 0 && can(user, "start_stocktake");

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-teal-deep">Stocktake</h1>
          <p className="text-sm text-muted">
            Counting sessions with live discrepancies and blocked sign-off
          </p>
        </div>
        {canStart && (
          <form action={startStocktakeAction} className="flex items-center gap-2">
            <select name="labId" className="input w-52">
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.code} — {lab.name}
                </option>
              ))}
            </select>
            <button className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep">
              Start session
            </button>
          </form>
        )}
      </div>

      <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Session</th>
              <th className="px-2 py-2.5">Lab</th>
              <th className="px-2 py-2.5">Started</th>
              <th className="px-2 py-2.5">Counted</th>
              <th className="px-2 py-2.5">Discrepancies</th>
              <th className="px-2 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const discrepancies = s.counts.filter((c) => c.discrepancy !== "NONE");
              const unresolved = discrepancies.filter((c) => c.resolution === null);
              return (
                <tr key={s.id} className="border-b border-line last:border-0 hover:bg-paper">
                  <td className="px-4 py-2">
                    <Link href={`/stocktake/${s.id}`} className="font-medium text-teal hover:underline">
                      ST-{s.startedAt.toISOString().slice(0, 10)}-{s.id.slice(-4).toUpperCase()}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{s.lab.code}</td>
                  <td className="px-2 py-2 text-xs">{s.startedAt.toLocaleString("en-GB")}</td>
                  <td className="px-2 py-2">{s.counts.length}</td>
                  <td className="px-2 py-2">
                    {discrepancies.length}
                    {unresolved.length > 0 && (
                      <span className="ml-1 text-xs text-warning">({unresolved.length} open)</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <SessionStatus status={s.status} />
                  </td>
                </tr>
              );
            })}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  No stocktake sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SessionStatus({ status }: { status: string }) {
  switch (status) {
    case "OPEN":
      return <Pill tone="info">In progress</Pill>;
    case "AWAITING_SIGNOFF":
      return <Pill tone="warning">Awaiting sign-off</Pill>;
    case "SIGNED_OFF":
      return <Pill tone="ok">Signed off</Pill>;
    default:
      return <Pill tone="neutral">{status}</Pill>;
  }
}
