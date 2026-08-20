// Alerts — a worklist, not a notification feed: everything here can be acted
// on from this screen.

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { custodyWhere } from "@/server/queries";
import { requireUser } from "@/server/session";
import { Pill, type PillTone } from "@/components/pills";
import {
  dismissAlertAction,
  markSdsReadAction,
  markUseFirstAction,
  refreshAlertsAction,
  snoozeAlertAction,
} from "../actions";

export const dynamic = "force-dynamic";

type Search = { filter?: string; scope?: string };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const params = await searchParams;
  const scopeMine = params.scope !== "all";

  const custodyContainerIds = scopeMine
    ? (
        await prisma.container.findMany({ where: custodyWhere(user), select: { id: true } })
      ).map((c) => c.id)
    : null;

  const baseWhere = {
    status: "OPEN" as const,
    ...(custodyContainerIds
      ? {
          OR: [
            { containerId: { in: custodyContainerIds } },
            { containerId: null, labId: { in: user.memberships.map((m) => m.labId) } },
          ],
        }
      : {}),
  };

  const alerts = await prisma.alert.findMany({
    where: {
      ...baseWhere,
      ...(params.filter === "expiry"
        ? { kind: { in: ["EXPIRED", "EXPIRING_SOON"] } }
        : params.filter === "stock"
          ? { kind: "BELOW_MIN" }
          : params.filter === "documents"
            ? { kind: "SDS_UNREAD" }
            : params.filter === "storage"
              ? { kind: { in: ["COMPAT_CONFLICT", "QUANTITY_DRIFT"] } }
              : {}),
    },
    include: {
      container: { select: { id: true, code: true, substanceId: true } },
    },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    take: 200,
  });

  const counts = {
    expired: alerts.filter((a) => a.kind === "EXPIRED").length,
    expiring: alerts.filter((a) => a.kind === "EXPIRING_SOON").length,
    stock: alerts.filter((a) => a.kind === "BELOW_MIN").length,
    docs: alerts.filter((a) => a.kind === "SDS_UNREAD").length,
    storage: alerts.filter((a) => a.kind === "COMPAT_CONFLICT" || a.kind === "QUANTITY_DRIFT").length,
  };

  const thresholds = user.workspaceLabId
    ? await prisma.alertThresholdSetting.findUnique({ where: { labId: user.workspaceLabId } })
    : null;

  const chip = (label: string, filter?: string) => (
    <Link
      href={`/safety/alerts${filter ? `?filter=${filter}` : ""}${params.scope === "all" ? (filter ? "&scope=all" : "?scope=all") : ""}`}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        params.filter === filter || (!params.filter && !filter)
          ? "border-teal bg-teal-soft text-teal-deep"
          : "border-line bg-card text-muted hover:bg-paper"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-teal-deep">Alerts</h1>
          <p className="text-sm text-muted">
            Safety · {scopeMine ? "filtered to my custody" : "whole estate"} · {alerts.length} open
          </p>
        </div>
        <form action={refreshAlertsAction}>
          <button className="rounded-md border border-line bg-card px-3 py-1.5 text-sm text-muted hover:bg-paper">
            Re-run checks now
          </button>
        </form>
      </div>

      {/* Four counts, four causes */}
      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Count label="Expired" value={counts.expired} tone="danger" note="Dispose required" />
        <Count label="Expiring soon" value={counts.expiring} tone="warning" note={`Within ${thresholds?.expiryWarningDays ?? 30} days`} />
        <Count label="Below min level" value={counts.stock} tone="warning" note="Reorder suggested" />
        <Count label="SDS unread" value={counts.docs} tone="info" note="New revision" />
        <Count label="Storage" value={counts.storage} tone="danger" note="Conflicts & drift" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {chip("All")}
        {chip("Expiry", "expiry")}
        {chip("Stock level", "stock")}
        {chip("Documents", "documents")}
        {chip("Storage", "storage")}
        <Link
          href={`/safety/alerts${params.filter ? `?filter=${params.filter}&` : "?"}scope=${scopeMine ? "all" : "mine"}`}
          className="ml-auto text-xs text-teal hover:underline"
        >
          {scopeMine ? "Show whole estate" : "Show my custody only"}
        </Link>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Severity</th>
              <th className="px-2 py-2.5">Issue</th>
              <th className="px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => {
              const detail = alert.detail as Record<string, unknown>;
              return (
                <tr key={alert.id} className="border-b border-line align-middle last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap">{severity(alert.kind)}</td>
                  <td className="px-2 py-2">
                    <AlertText kind={alert.kind} detail={detail} />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ResolvingAction alert={alert} detail={detail} />
                      <form action={snoozeAlertAction}>
                        <input type="hidden" name="alertId" value={alert.id} />
                        <button className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:bg-paper">
                          Snooze 7 d
                        </button>
                      </form>
                      <form action={dismissAlertAction}>
                        <input type="hidden" name="alertId" value={alert.id} />
                        <button className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:bg-paper">
                          Dismiss
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
            {alerts.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-muted">
                  Nothing open. Alerts regenerate nightly at 02:30, or use “Re-run checks now”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Rules: expiry warning at {thresholds?.expiryWarningDays ?? 30} days · low stock at{" "}
        {thresholds?.lowStockPercent ?? 25}% of min level · SDS re-read within{" "}
        {thresholds?.sdsRereadDays ?? 14} days of revision. Lab managers can change these in lab
        settings.
      </p>
    </div>
  );
}

function Count({ label, value, tone, note }: { label: string; value: number; tone: PillTone; note: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <div className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted">{note}</div>
    </div>
  );
}

function severity(kind: string) {
  switch (kind) {
    case "EXPIRED":
      return <Pill tone="danger">Expired</Pill>;
    case "EXPIRING_SOON":
      return <Pill tone="warning">Urgent</Pill>;
    case "BELOW_MIN":
      return <Pill tone="warning">Low stock</Pill>;
    case "SDS_UNREAD":
      return <Pill tone="info">Document</Pill>;
    case "COMPAT_CONFLICT":
      return <Pill tone="danger">Storage</Pill>;
    case "QUANTITY_DRIFT":
      return <Pill tone="danger">Drift</Pill>;
    default:
      return <Pill tone="neutral">{kind}</Pill>;
  }
}

function AlertText({ kind, detail }: { kind: string; detail: Record<string, unknown> }) {
  switch (kind) {
    case "EXPIRED":
      return (
        <span>
          <strong>{String(detail.substance)}</strong> — {String(detail.containerCode)} · expired{" "}
          {String(detail.daysOverdue)} days ago
        </span>
      );
    case "EXPIRING_SOON":
      return (
        <span>
          <strong>{String(detail.substance)}</strong> — {String(detail.containerCode)} · expires in{" "}
          {String(detail.daysToExpiry)} days
        </span>
      );
    case "BELOW_MIN":
      return (
        <span>
          <strong>{String(detail.substance)}</strong> — {String(detail.total)} of{" "}
          {String(detail.min)} {String(detail.unit).toLowerCase()} min level
        </span>
      );
    case "SDS_UNREAD":
      return (
        <span>
          <strong>{String(detail.substance)}</strong> — SDS rev {String(detail.revision)} unread by{" "}
          {String(detail.unreadCount)} of {String(detail.custodianCount)} custodians
        </span>
      );
    case "COMPAT_CONFLICT":
      return (
        <span>
          <strong>{String(detail.cabinet)}</strong> — {String(detail.conflictCount)} conflicting pair
          {Number(detail.conflictCount) === 1 ? "" : "s"} ({String(detail.worst).toLowerCase().replace("_", " ")})
        </span>
      );
    case "QUANTITY_DRIFT":
      return (
        <span>
          <strong>{String(detail.containerCode)}</strong> — cached {String(detail.cached)} ≠ derived{" "}
          {String(detail.derived)}
        </span>
      );
    default:
      return <span>{JSON.stringify(detail)}</span>;
  }
}

function ResolvingAction({
  alert,
  detail,
}: {
  alert: { id: string; kind: string; containerId: string | null; locationId: string | null; substanceId: string | null; container: { code: string; substanceId: string } | null };
  detail: Record<string, unknown>;
}) {
  switch (alert.kind) {
    case "EXPIRED":
      return alert.container ? (
        <Link
          href={`/check-out?code=${alert.container.code}`}
          className="rounded bg-danger px-2 py-0.5 text-xs font-medium text-white hover:opacity-90"
        >
          Dispose
        </Link>
      ) : null;
    case "EXPIRING_SOON":
      return alert.containerId ? (
        <form action={markUseFirstAction}>
          <input type="hidden" name="containerId" value={alert.containerId} />
          <button className="rounded bg-teal px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-deep">
            Use first
          </button>
        </form>
      ) : null;
    case "BELOW_MIN":
      return alert.substanceId ? (
        <Link
          href={`/availability?substance=${alert.substanceId}`}
          className="rounded bg-teal px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-deep"
        >
          Check estate / reorder
        </Link>
      ) : null;
    case "SDS_UNREAD":
      return alert.substanceId ? (
        <Link
          href={`/safety/sds?substance=${alert.substanceId}`}
          className="rounded bg-info px-2 py-0.5 text-xs font-medium text-white hover:opacity-90"
        >
          Read SDS
        </Link>
      ) : null;
    case "COMPAT_CONFLICT":
      return alert.locationId ? (
        <Link
          href={`/safety/matrix?cabinet=${alert.locationId}`}
          className="rounded bg-danger px-2 py-0.5 text-xs font-medium text-white hover:opacity-90"
        >
          Resolve
        </Link>
      ) : null;
    case "QUANTITY_DRIFT":
      return alert.container ? (
        <Link
          href={`/chemicals/${alert.container.substanceId}`}
          className="rounded bg-teal px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-deep"
        >
          Investigate
        </Link>
      ) : null;
    default:
      return null;
  }
}
