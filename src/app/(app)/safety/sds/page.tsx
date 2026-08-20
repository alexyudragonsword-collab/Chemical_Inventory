// SDS library — coverage is the metric: a chemical without a current SDS is
// a compliance gap, shown as one. Read-by counts, not just presence.

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/session";
import { Pill } from "@/components/pills";
import { markSdsReadAction } from "../actions";
import { uploadSdsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SdsLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ substance?: string; q?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const substances = await prisma.substance.findMany({
    where: params.q
      ? { name: { contains: params.q, mode: "insensitive" } }
      : params.substance
        ? { id: params.substance }
        : {},
    include: {
      sdsDocuments: {
        orderBy: { createdAt: "desc" },
        include: { readReceipts: { select: { userId: true } }, supersedes: { select: { revision: true } } },
      },
      containers: {
        where: { status: "ACTIVE" },
        select: { custodianId: true },
      },
    },
    orderBy: { name: "asc" },
    take: params.substance ? 1 : 100,
  });

  const [total, withCurrent, expired] = await Promise.all([
    prisma.substance.count(),
    prisma.substance.count({ where: { sdsDocuments: { some: { status: "CURRENT" } } } }),
    prisma.substance.count({
      where: {
        sdsDocuments: { some: { status: "EXPIRED" }, none: { status: "CURRENT" } },
      },
    }),
  ]);
  const missing = total - withCurrent - expired;
  const coverage = total ? ((withCurrent / total) * 100).toFixed(1) : "0";
  const allSubstances = await prisma.substance.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-teal-deep">SDS library</h1>
      <p className="text-sm text-muted">
        Safety · Documents · {total} substances · {coverage}% coverage
      </p>

      {/* Coverage stacked bar */}
      <div className="mt-4 rounded-lg border border-line bg-card p-4">
        <div className="flex h-4 overflow-hidden rounded-full">
          <div className="bg-ok" style={{ width: `${(withCurrent / Math.max(1, total)) * 100}%` }} title={`Current: ${withCurrent}`} />
          <div className="bg-warning" style={{ width: `${(expired / Math.max(1, total)) * 100}%` }} title={`Expired: ${expired}`} />
          <div className="bg-danger" style={{ width: `${(missing / Math.max(1, total)) * 100}%` }} title={`Missing: ${missing}`} />
        </div>
        <div className="mt-2 flex gap-4 text-xs text-muted">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-ok" />Current {withCurrent}</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-warning" />Expired {expired}</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-danger" />Missing {missing}</span>
          <span className="ml-auto">target 99%</span>
        </div>
      </div>

      {/* Upload */}
      <details className="mt-4 rounded-lg border border-line bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-teal-deep">
          + Upload SDS
        </summary>
        <form action={uploadSdsAction} className="flex flex-wrap items-end gap-3 border-t border-line p-4">
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            Substance
            <select name="substanceId" required className="input mt-1 w-64">
              <option value="">Choose…</option>
              {allSubstances.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            Revision
            <input name="revision" required placeholder="2026-08" className="input mt-1 w-28" />
          </label>
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            Supplier
            <input name="supplier" placeholder="Sigma-Aldrich" className="input mt-1 w-40" />
          </label>
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            What changed vs previous revision
            <input name="changeSummary" placeholder="H-statements, PPE, disposal" className="input mt-1 w-64" />
          </label>
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            PDF
            <input name="file" type="file" accept="application/pdf" required className="mt-1 block text-sm" />
          </label>
          <button className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep">
            Upload
          </button>
        </form>
      </details>

      <form action="/safety/sds" className="mt-4 max-w-xs">
        <input name="q" defaultValue={params.q ?? ""} placeholder="⌕ Filter by substance" className="input" />
      </form>

      {/* Library table */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Chemical</th>
              <th className="px-2 py-2.5">Supplier</th>
              <th className="px-2 py-2.5">Revision</th>
              <th className="px-2 py-2.5">Status</th>
              <th className="px-2 py-2.5">Read by</th>
              <th className="px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {substances.map((s) => {
              const current = s.sdsDocuments.find((d) => d.status === "CURRENT");
              const latest = current ?? s.sdsDocuments[0] ?? null;
              const custodians = new Set(s.containers.map((c) => c.custodianId).filter(Boolean));
              const readers = latest ? new Set(latest.readReceipts.map((r) => r.userId)) : new Set();
              const iRead = latest ? readers.has(user.id) : false;
              return (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 font-medium">{s.name}</td>
                  <td className="px-2 py-2 text-xs">{latest?.supplier ?? "—"}</td>
                  <td className="px-2 py-2 text-xs">
                    {latest?.revision ?? "—"}
                    {latest?.supersedes && (
                      <span className="ml-1 text-muted" title={latest.changeSummary ?? undefined}>
                        (supersedes {latest.supersedes.revision}
                        {latest.changeSummary ? ` — ${latest.changeSummary}` : ""})
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {!latest ? (
                      <Pill tone="danger">Missing</Pill>
                    ) : latest.status === "CURRENT" ? (
                      custodians.size > 0 && readers.size < custodians.size ? (
                        <Pill tone="info">Unread</Pill>
                      ) : (
                        <Pill tone="ok">Current</Pill>
                      )
                    ) : (
                      <Pill tone="warning">{latest.status.toLowerCase()}</Pill>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {custodians.size > 0 ? `${[...custodians].filter((c) => readers.has(c as string)).length} / ${custodians.size} custodians` : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {latest?.fileKey && (
                        <a
                          href={`/api/sds/${latest.id}`}
                          target="_blank"
                          className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:bg-paper"
                        >
                          Open
                        </a>
                      )}
                      {latest && latest.status === "CURRENT" && !iRead && (
                        <form action={markSdsReadAction}>
                          <input type="hidden" name="sdsDocumentId" value={latest.id} />
                          <button className="rounded bg-info px-2 py-0.5 text-xs font-medium text-white hover:opacity-90">
                            Mark as read
                          </button>
                        </form>
                      )}
                      {latest && iRead && <span className="text-xs text-ok">✓ read</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {substances.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">No substances match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
