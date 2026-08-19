// Labs & locations: sites → labs → cabinets → shelves, plus per-lab alert
// thresholds.

import { prisma } from "@/lib/prisma";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";
import {
  createLabAction,
  createLocationAction,
  createSiteAction,
  saveThresholdsAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function LabsAdminPage() {
  const user = await requireUser();
  if (!can(user, "manage_labs")) return <p className="text-sm text-muted">Admin only.</p>;

  const sites = await prisma.site.findMany({
    include: {
      labs: {
        include: {
          locations: { orderBy: { code: "asc" } },
          alertThresholds: true,
          _count: { select: { containers: { where: { status: { notIn: ["DISPOSED"] } } } } },
        },
        orderBy: { code: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-teal-deep">Labs &amp; locations</h1>

      <div className="mt-4 flex flex-wrap gap-3">
        <form action={createSiteAction} className="flex items-end gap-2 rounded-lg border border-line bg-white p-3">
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            New site
            <input name="name" placeholder="Site name" className="input mt-1 w-40" />
          </label>
          <button className="rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white hover:bg-teal-deep">Add</button>
        </form>
        <form action={createLabAction} className="flex items-end gap-2 rounded-lg border border-line bg-white p-3">
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            New lab
            <select name="siteId" className="input mt-1 w-36">
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <input name="code" placeholder="Code (B2-14)" className="input w-28" />
          <input name="name" placeholder="Name" className="input w-40" />
          <button className="rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white hover:bg-teal-deep">Add</button>
        </form>
      </div>

      <div className="mt-5 space-y-4">
        {sites.map((site) => (
          <section key={site.id}>
            <h2 className="text-sm font-semibold text-muted">{site.name}</h2>
            <div className="mt-2 space-y-3">
              {site.labs.map((lab) => (
                <details key={lab.id} className="rounded-lg border border-line bg-white">
                  <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
                    <span className="font-medium">{lab.code}</span>
                    <span className="text-sm text-muted">{lab.name}</span>
                    <span className="ml-auto text-xs text-muted">
                      {lab.locations.length} locations · {lab._count.containers} containers
                    </span>
                  </summary>
                  <div className="border-t border-line p-4">
                    <ul className="space-y-0.5 text-sm">
                      {lab.locations
                        .filter((l) => !l.parentId)
                        .map((cabinet) => (
                          <li key={cabinet.id}>
                            <span className="font-medium">{cabinet.code}</span>
                            <span className="ml-2 text-xs text-muted">
                              {cabinet.name ?? ""} · {cabinet.kind.toLowerCase()}
                              {cabinet.maxVolumeL ? ` · limit ${cabinet.maxVolumeL} L` : ""}
                              {cabinet.incomplete ? " · ⚠ incomplete (legacy)" : ""}
                              {cabinet.rawAliases.length > 1
                                ? ` · aliases: ${cabinet.rawAliases.join(", ")}`
                                : ""}
                            </span>
                            {lab.locations.filter((l) => l.parentId === cabinet.id).length > 0 && (
                              <ul className="ml-5 text-xs text-muted">
                                {lab.locations
                                  .filter((l) => l.parentId === cabinet.id)
                                  .map((shelf) => (
                                    <li key={shelf.id}>
                                      {shelf.code} {shelf.name ? `— ${shelf.name}` : ""}
                                      {shelf.capacity ? ` (cap. ${shelf.capacity})` : ""}
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      {lab.locations.length === 0 && (
                        <li className="text-xs text-muted">No storage locations defined.</li>
                      )}
                    </ul>

                    <form action={createLocationAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                      <input type="hidden" name="labId" value={lab.id} />
                      <label className="text-[10px] font-semibold tracking-wide text-muted uppercase">
                        Code
                        <input name="code" placeholder="FC-1 or FC-1/S1" className="input mt-0.5 w-28" />
                      </label>
                      <label className="text-[10px] font-semibold tracking-wide text-muted uppercase">
                        Name
                        <input name="name" placeholder="Flammables cabinet" className="input mt-0.5 w-40" />
                      </label>
                      <label className="text-[10px] font-semibold tracking-wide text-muted uppercase">
                        Kind
                        <select name="kind" className="input mt-0.5 w-28" defaultValue="CABINET">
                          {["CABINET", "SHELF", "FRIDGE", "ROOM", "OTHER"].map((k) => (
                            <option key={k}>{k}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[10px] font-semibold tracking-wide text-muted uppercase">
                        Parent
                        <select name="parentId" className="input mt-0.5 w-28" defaultValue="">
                          <option value="">top level</option>
                          {lab.locations.filter((l) => !l.parentId).map((l) => (
                            <option key={l.id} value={l.id}>{l.code}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[10px] font-semibold tracking-wide text-muted uppercase">
                        Capacity
                        <input name="capacity" type="number" min={1} className="input mt-0.5 w-20" />
                      </label>
                      <label className="text-[10px] font-semibold tracking-wide text-muted uppercase">
                        Vol. limit (L)
                        <input name="maxVolumeL" type="number" min={1} step="any" className="input mt-0.5 w-24" />
                      </label>
                      <button className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-deep">
                        Save location
                      </button>
                    </form>

                    <form action={saveThresholdsAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                      <input type="hidden" name="labId" value={lab.id} />
                      <span className="text-xs font-semibold text-teal-deep">Alert thresholds:</span>
                      <label className="text-[10px] font-semibold tracking-wide text-muted uppercase">
                        Expiry warning (days)
                        <input name="expiryWarningDays" type="number" min={1} defaultValue={lab.alertThresholds?.expiryWarningDays ?? 30} className="input mt-0.5 w-20" />
                      </label>
                      <label className="text-[10px] font-semibold tracking-wide text-muted uppercase">
                        Low stock (% of min)
                        <input name="lowStockPercent" type="number" min={1} defaultValue={lab.alertThresholds?.lowStockPercent ?? 25} className="input mt-0.5 w-20" />
                      </label>
                      <label className="text-[10px] font-semibold tracking-wide text-muted uppercase">
                        SDS re-read (days)
                        <input name="sdsRereadDays" type="number" min={1} defaultValue={lab.alertThresholds?.sdsRereadDays ?? 14} className="input mt-0.5 w-20" />
                      </label>
                      <button className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:bg-paper">
                        Save thresholds
                      </button>
                    </form>
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
