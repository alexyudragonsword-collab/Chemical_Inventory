// Audit trail CSV export, including hashes so an external party can
// re-verify the chain independently.

import { prisma } from "@/lib/prisma";
import { can } from "@/server/authz";
import { getSessionUser } from "@/server/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "view_audit")) return new Response("Unauthorized", { status: 401 });

  const events = await prisma.auditEvent.findMany({
    include: { actor: { select: { name: true } }, witness: { select: { name: true } } },
    orderBy: { seq: "asc" },
  });

  const lines = ["seq,timestamp,user,witness,event_type,entity_type,entity_id,payload,prev_hash,hash"];
  for (const e of events) {
    lines.push(
      [
        e.seq.toString(),
        e.createdAt.toISOString(),
        csv(e.onBehalfSystem ? "system" : (e.actor?.name ?? "")),
        csv(e.witness?.name ?? ""),
        e.eventType,
        e.entityType,
        e.entityId,
        csv(JSON.stringify(e.payload)),
        e.prevHash,
        e.hash,
      ].join(","),
    );
  }

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chemtrack-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
