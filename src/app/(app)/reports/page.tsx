// Reports — four standing reports cover the recurring questions; everything
// else is a filtered export with an explicit scope.

import { prisma } from "@/lib/prisma";
import {
  consumptionReport,
  defaultPeriod,
  regulatedReport,
  stockHealthReport,
  wasteReport,
} from "@/server/reports";
import { requireUser } from "@/server/session";
import { unitLabel } from "@/server/units";

export const dynamic = "force-dynamic";

type Search = { from?: string; to?: string; lab?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const params = await searchParams;
  const period = {
    from: params.from ? new Date(params.from) : defaultPeriod().from,
    to: params.to ? new Date(params.to + "T23:59:59") : defaultPeriod().to,
  };

  const [consumption, regulated, waste, health, labs] = await Promise.all([
    consumptionReport(period, params.lab),
    regulatedReport(period),
    wasteReport(period),
    stockHealthReport(),
    prisma.lab.findMany({ select: { code: true }, orderBy: { code: "asc" } }),
  ]);

  const maxMonthly = Math.max(1, ...consumption.monthlySolventLitres.map(([, v]) => v));
  const exportQs = (report: string, format: string) =>
    `/api/export/report?report=${report}&format=${format}&from=${period.from.toISOString().slice(0, 10)}&to=${period.to.toISOString().slice(0, 10)}${params.lab ? `&lab=${params.lab}` : ""}`;

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-teal-deep">Reports</h1>
      <p className="text-sm text-muted">
        Period {period.from.toLocaleDateString("en-GB")} – {period.to.toLocaleDateString("en-GB")}
        {params.lab ? ` · lab ${params.lab}` : " · all labs"}
      </p>

      {/* Scope selector — explicit, never an assumption */}
      <form action="/reports" className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold tracking-wide text-muted uppercase">
          From
          <input type="date" name="from" defaultValue={period.from.toISOString().slice(0, 10)} className="input mt-1 w-36" />
        </label>
        <label className="text-xs font-semibold tracking-wide text-muted uppercase">
          To
          <input type="date" name="to" defaultValue={period.to.toISOString().slice(0, 10)} className="input mt-1 w-36" />
        </label>
        <label className="text-xs font-semibold tracking-wide text-muted uppercase">
          Scope
          <select name="lab" defaultValue={params.lab ?? ""} className="input mt-1 w-36">
            <option value="">All labs</option>
            {labs.map((l) => (
              <option key={l.code} value={l.code}>{l.code}</option>
            ))}
          </select>
        </label>
        <button className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep">
          Apply
        </button>
      </form>

      {/* Four standing reports */}
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ReportCard
          title="Consumption"
          detail={`${consumption.transactionCount} deductions · by chemical, project and lab`}
          csv={exportQs("consumption", "csv")}
          xlsx={exportQs("consumption", "xlsx")}
        />
        <ReportCard
          title="Regulated substances"
          detail={`${regulated.length} movements · controlled/licensed return`}
          csv={exportQs("regulated", "csv")}
          xlsx={exportQs("regulated", "xlsx")}
        />
        <ReportCard
          title="Waste & disposal"
          detail={`${waste.disposals.length} disposals · by stream, for the EHS return`}
          csv={exportQs("waste", "csv")}
          xlsx={exportQs("waste", "xlsx")}
        />
        <ReportCard
          title="Stock health"
          detail={`${health.writeOffRisk.length} write-off risks · ${health.dormant.length} dormant`}
          csv={exportQs("stock-health", "csv")}
          xlsx={exportQs("stock-health", "xlsx")}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Solvent consumption chart */}
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold text-teal-deep">Solvent consumption by month (litres)</h2>
          <div className="mt-3 flex h-36 items-end gap-2">
            {consumption.monthlySolventLitres.length === 0 && (
              <p className="text-sm text-muted">No deductions in this period.</p>
            )}
            {consumption.monthlySolventLitres.map(([month, litres]) => (
              <div key={month} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] text-muted">{litres.toFixed(1)}</span>
                <div className="w-full rounded-t bg-teal/70" style={{ height: `${(litres / maxMonthly) * 100}px` }} />
                <span className="text-[10px] text-muted">{month.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Top consumption rows */}
        <section className="rounded-lg border border-line bg-white">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-teal-deep">
            Top usage — chemical → project
          </h2>
          <table className="w-full text-sm">
            <tbody>
              {consumption.rows.slice(0, 8).map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-4 py-1.5">
                    {r.substance}
                    <span className="ml-1 text-xs text-muted">{r.lab} · {r.project}</span>
                  </td>
                  <td className="px-4 py-1.5 text-right whitespace-nowrap">
                    {Math.round(r.used * 100) / 100} {r.unit}
                  </td>
                </tr>
              ))}
              {consumption.rows.length === 0 && (
                <tr><td className="px-4 py-6 text-center text-muted">No data.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Waste by stream */}
        <section className="rounded-lg border border-line bg-white">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-teal-deep">
            Disposals by waste stream
          </h2>
          <table className="w-full text-sm">
            <tbody>
              {[...waste.byStream.entries()].map(([stream, info]) => (
                <tr key={stream} className="border-b border-line last:border-0">
                  <td className="px-4 py-1.5">
                    {stream}
                    <span className="ml-1 text-xs text-muted">{info.items.join(", ")}</span>
                  </td>
                  <td className="px-4 py-1.5 text-right">{info.count}</td>
                </tr>
              ))}
              {waste.byStream.size === 0 && (
                <tr><td className="px-4 py-6 text-center text-muted">No disposals in this period.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Expiry buckets */}
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold text-teal-deep">Expiry profile — {health.total} active containers</h2>
          <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
            <Bucket label="Expired" value={health.buckets.expired} tone="text-danger" />
            <Bucket label="≤ 30 days" value={health.buckets.days30} tone="text-warning" />
            <Bucket label="≤ 90 days" value={health.buckets.days90} tone="text-warning" />
            <Bucket label="≤ 1 year" value={health.buckets.days365} tone="text-ink" />
            <Bucket label="Later" value={health.buckets.later} tone="text-ok" />
            <Bucket label="No expiry" value={health.buckets.none} tone="text-muted" />
          </dl>
          <p className="mt-3 text-xs text-muted">
            {health.writeOffRisk.length > 0
              ? `${health.writeOffRisk.length} containers expire within 90 days with >50% remaining — flag them "use first" from the alerts screen.`
              : "No significant write-off risk in the next 90 days."}
          </p>
        </section>
      </div>

      <p className="mt-4 text-xs text-muted">
        Scheduled: the regulated-substances return is emailed to EHS on the 1st of each month by the
        worker — nobody needs to produce it by hand.
      </p>
    </div>
  );
}

function ReportCard({ title, detail, csv, xlsx }: { title: string; detail: string; csv: string; xlsx: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-sm font-semibold text-teal-deep">{title}</div>
      <div className="mt-1 text-xs text-muted">{detail}</div>
      <div className="mt-3 flex gap-1.5">
        <a href={csv} className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:bg-paper">CSV</a>
        <a href={xlsx} className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:bg-paper">XLSX</a>
      </div>
    </div>
  );
}

function Bucket({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-xl font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}
