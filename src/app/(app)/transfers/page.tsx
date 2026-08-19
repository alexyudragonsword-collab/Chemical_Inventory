// Transfer requests — the lightweight approval that replaces phone calls
// between labs. Incoming requests land on the custodian's dashboard.

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/session";
import { formatQuantity } from "@/server/units";
import { Pill } from "@/components/pills";
import { acceptTransferAction, cancelTransferAction, declineTransferAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const user = await requireUser();
  const managedLabIds = user.memberships.filter((m) => m.isManager).map((m) => m.labId);

  const [incoming, outgoing] = await Promise.all([
    prisma.transferRequest.findMany({
      where: {
        status: "PENDING",
        OR: [
          { currentCustodianId: user.id },
          ...(managedLabIds.length ? [{ container: { labId: { in: managedLabIds } } }] : []),
        ],
      },
      include: {
        container: { include: { substance: true, lab: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.transferRequest.findMany({
      where: { requesterId: user.id },
      include: { container: { include: { substance: true, lab: true } } },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  const requesterIds = [...new Set(incoming.map((r) => r.requesterId))];
  const requesters = await prisma.user.findMany({
    where: { id: { in: requesterIds } },
    select: { id: true, name: true },
  });
  const requesterName = new Map(requesters.map((u) => [u.id, u.name]));

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-teal-deep">Transfers</h1>
      <p className="text-sm text-muted">Custody transfer requests, incoming and outgoing</p>

      <section className="mt-5 rounded-lg border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-teal-deep">
          Incoming — awaiting your decision ({incoming.length})
        </h2>
        <ul className="divide-y divide-line">
          {incoming.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {r.container.substance.name}
                  <span className="ml-2 text-xs text-muted">{r.container.code}</span>
                </div>
                <div className="text-xs text-muted">
                  {formatQuantity(r.container.currentQuantity.toNumber(), r.container.unit)} remaining
                  · {r.container.lab.code} · requested by{" "}
                  {requesterName.get(r.requesterId) ?? "unknown"}
                  {r.message ? ` — “${r.message}”` : ""}
                </div>
              </div>
              <form action={acceptTransferAction}>
                <input type="hidden" name="requestId" value={r.id} />
                <button className="rounded-md bg-teal px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-deep">
                  Accept
                </button>
              </form>
              <form action={declineTransferAction}>
                <input type="hidden" name="requestId" value={r.id} />
                <button className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:bg-paper">
                  Decline
                </button>
              </form>
            </li>
          ))}
          {incoming.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted">No incoming requests.</li>
          )}
        </ul>
      </section>

      <section className="mt-5 rounded-lg border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-teal-deep">
          My requests
        </h2>
        <ul className="divide-y divide-line">
          {outgoing.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {r.container.substance.name}
                  <span className="ml-2 text-xs text-muted">{r.container.code} · {r.container.lab.code}</span>
                </div>
                <div className="text-xs text-muted">{r.createdAt.toLocaleDateString("en-GB")}</div>
              </div>
              <StatusBadge status={r.status} />
              {r.status === "PENDING" && (
                <form action={cancelTransferAction}>
                  <input type="hidden" name="requestId" value={r.id} />
                  <button className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:bg-paper">
                    Cancel
                  </button>
                </form>
              )}
            </li>
          ))}
          {outgoing.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted">You have not requested any transfers.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PENDING":
      return <Pill tone="info">Pending</Pill>;
    case "ACCEPTED":
      return <Pill tone="ok">Accepted</Pill>;
    case "DECLINED":
      return <Pill tone="danger">Declined</Pill>;
    case "CANCELLED":
      return <Pill tone="neutral">Cancelled</Pill>;
    default:
      return <Pill tone="neutral">{status}</Pill>;
  }
}
