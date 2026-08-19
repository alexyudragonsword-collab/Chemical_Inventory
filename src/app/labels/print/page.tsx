// Printable QR labels, 2-up per row. The label is the record: container ID,
// QR, hazard pictograms and expiry printed at receipt; everything downstream
// starts by scanning it. Browser print CSS only — no printer integration.

import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { PrintButton } from "./print-button";
import { requireUser } from "@/server/session";
import { formatQuantity } from "@/server/units";

export const dynamic = "force-dynamic";

const PICTOGRAM_SYMBOL: Record<string, string> = {
  GHS01_EXPLOSIVE: "✹",
  GHS02_FLAMMABLE: "🔥",
  GHS03_OXIDISER: "⌾",
  GHS04_GAS: "⚗",
  GHS05_CORROSIVE: "🜂",
  GHS06_TOXIC: "☠",
  GHS07_IRRITANT: "❗",
  GHS08_HEALTH_HAZARD: "☢",
  GHS09_ENVIRONMENT: "🌊",
};

export default async function PrintLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ codes?: string }>;
}) {
  await requireUser();
  const { codes } = await searchParams;
  const codeList = (codes ?? "").split(",").map((c) => c.trim()).filter(Boolean).slice(0, 60);

  const containers = await prisma.container.findMany({
    where: { code: { in: codeList } },
    include: {
      substance: { include: { ghs: { select: { pictograms: true } } } },
      lab: { select: { code: true } },
      location: { select: { code: true } },
    },
    orderBy: { code: "asc" },
  });

  const labels = await Promise.all(
    containers.map(async (c) => ({
      container: c,
      qrSvg: await QRCode.toString(c.code, { type: "svg", margin: 0, width: 96 }),
    })),
  );

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">
          {labels.length} label{labels.length === 1 ? "" : "s"} — use your browser&apos;s print
          dialog (Ctrl/Cmd+P).
        </p>
        <PrintButton />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {labels.map(({ container: c, qrSvg }) => (
          <div key={c.id} className="break-inside-avoid rounded border-2 border-black p-3">
            <div className="text-sm leading-tight font-bold uppercase">{c.substance.name}</div>
            <div className="text-xs">
              {c.substance.casNumber ? `CAS ${c.substance.casNumber}` : ""}
              {c.grade ? ` · ${c.grade}` : ""}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div
                className="h-24 w-24 shrink-0 [&_svg]:h-full [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <div className="min-w-0">
                <div className="font-mono text-lg font-bold">{c.code}</div>
                <div className="text-xs">
                  {formatQuantity(c.initialQuantity.toNumber(), c.unit)}
                  {c.lotNumber ? ` · Lot ${c.lotNumber}` : ""}
                </div>
                <div className="text-xs">
                  {c.receivedAt ? `Recv ${c.receivedAt.toISOString().slice(0, 10)}` : ""}
                  {c.expiryDate ? ` · Exp ${c.expiryDate.toISOString().slice(0, 10)}` : ""}
                </div>
                <div className="text-xs font-medium">
                  {c.lab.code}
                  {c.location ? ` / ${c.location.code}` : ""}
                </div>
                <div className="mt-0.5 text-lg leading-none">
                  {(c.substance.ghs?.pictograms ?? []).map((p) => (
                    <span key={p} className="mr-1">
                      {PICTOGRAM_SYMBOL[p]}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {labels.length === 0 && (
        <p className="text-center text-sm text-muted">No containers found for these codes.</p>
      )}
    </div>
  );
}
