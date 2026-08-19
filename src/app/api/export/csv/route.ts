// Streamed CSV export of the inventory list, honouring the same filters as
// the on-screen table.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildInventoryWhere } from "@/server/queries";
import { getSessionUser } from "@/server/session";
import { unitLabel } from "@/server/units";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const sp = request.nextUrl.searchParams;
  const where = buildInventoryWhere(user, {
    q: sp.get("q") ?? undefined,
    scope: sp.get("scope") ?? undefined,
    hazard: sp.get("hazard") ?? undefined,
    status: sp.get("status") ?? undefined,
    lab: sp.get("lab") ?? undefined,
  });

  const containers = await prisma.container.findMany({
    where,
    include: {
      substance: { include: { ghs: { select: { storageClass: true } } } },
      lab: { select: { code: true } },
      location: { select: { code: true } },
      custodian: { select: { name: true } },
    },
    orderBy: [{ lab: { code: "asc" } }, { code: "asc" }],
  });

  const header = [
    "Container",
    "Chemical",
    "CAS",
    "Storage class",
    "Lab",
    "Location",
    "Custodian",
    "Pack size",
    "Remaining",
    "Unit",
    "Lot",
    "Expiry",
    "Status",
    "Controlled",
  ];
  const lines = [header.join(",")];
  for (const c of containers) {
    lines.push(
      [
        c.code,
        csv(c.substance.name),
        c.substance.casNumber ?? "",
        c.substance.ghs?.storageClass ?? "",
        c.lab.code,
        c.location?.code ?? "",
        csv(c.custodian?.name ?? ""),
        c.initialQuantity.toString(),
        c.currentQuantity.toString(),
        unitLabel(c.unit),
        csv(c.lotNumber ?? ""),
        c.expiryDate ? c.expiryDate.toISOString().slice(0, 10) : "",
        c.status,
        c.substance.isControlled ? "yes" : "no",
      ].join(","),
    );
  }

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chemtrack-inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
