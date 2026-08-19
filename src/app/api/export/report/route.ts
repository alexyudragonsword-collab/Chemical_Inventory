// Report exports: CSV or XLSX for the four standing reports and the custom
// builder. CSV/XLSX are the contractual formats.

import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import {
  consumptionReport,
  defaultPeriod,
  regulatedReport,
  stockHealthReport,
  wasteReport,
} from "@/server/reports";
import { unitLabel } from "@/server/units";
import { getSessionUser } from "@/server/session";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const sp = request.nextUrl.searchParams;
  const report = sp.get("report") ?? "consumption";
  const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";
  const period = {
    from: sp.get("from") ? new Date(sp.get("from")!) : defaultPeriod().from,
    to: sp.get("to") ? new Date(sp.get("to")! + "T23:59:59") : defaultPeriod().to,
  };
  const lab = sp.get("lab") ?? undefined;

  let header: string[];
  let rows: (string | number)[][];
  let title: string;

  switch (report) {
    case "regulated": {
      title = "Regulated substances movement return";
      header = ["Date", "Substance", "CAS", "Container", "Lab", "Kind", "Before", "After", "Unit", "By", "Witness", "Reason"];
      rows = (await regulatedReport(period)).map((t) => [
        t.createdAt.toISOString(),
        t.container.substance.name,
        t.container.substance.casNumber ?? "",
        t.container.code,
        t.container.lab.code,
        t.kind,
        t.quantityBefore.toNumber(),
        t.quantityAfter.toNumber(),
        unitLabel(t.unit),
        t.auditEvent.actor?.name ?? "system",
        t.auditEvent.witness?.name ?? "",
        t.reason,
      ]);
      break;
    }
    case "waste": {
      title = "Waste & disposal";
      header = ["Date", "Substance", "Container", "Lab", "Disposed quantity", "Unit", "Waste stream", "Reason"];
      rows = (await wasteReport(period)).disposals.map((d) => {
        const payload = d.auditEvent.payload as Record<string, unknown>;
        return [
          d.createdAt.toISOString(),
          d.container.substance.name,
          d.container.code,
          d.container.lab.code,
          d.quantityBefore.toNumber(),
          unitLabel(d.unit),
          typeof payload.wasteStream === "string" ? payload.wasteStream : "",
          d.reason,
        ];
      });
      break;
    }
    case "stock-health": {
      title = "Stock health — write-off risk and dormancy";
      const data = await stockHealthReport();
      header = ["Category", "Container", "Substance", "Lab", "Detail"];
      rows = [
        ...data.writeOffRisk.map((r) => [
          "Write-off risk",
          r.code,
          r.substance,
          r.lab,
          `expires in ${r.daysToExpiry} d with ${r.remainingPct}% remaining`,
        ]),
        ...data.dormant.map((d) => [
          "Dormant",
          d.code,
          d.substance,
          d.lab,
          d.lastMovement ? `last movement ${d.lastMovement.toISOString().slice(0, 10)}` : "no movement recorded",
        ]),
      ];
      break;
    }
    default: {
      title = "Consumption";
      header = ["Substance", "Lab", "Project", "Quantity used", "Unit", "Events"];
      rows = (await consumptionReport(period, lab)).rows.map((r) => [
        r.substance,
        r.lab,
        r.project,
        Math.round(r.used * 1000) / 1000,
        r.unit,
        r.events,
      ]);
    }
  }

  const fileBase = `chemtrack-${report}-${new Date().toISOString().slice(0, 10)}`;

  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(title.slice(0, 31));
    sheet.addRow([title]).font = { bold: true, size: 14 };
    sheet.addRow([`Period ${period.from.toISOString().slice(0, 10)} to ${period.to.toISOString().slice(0, 10)} · generated ${new Date().toISOString()}`]);
    sheet.addRow([]);
    const headerRow = sheet.addRow(header);
    headerRow.font = { bold: true };
    for (const row of rows) sheet.addRow(row);
    sheet.columns.forEach((col) => {
      col.width = Math.max(12, ...sheet.getColumn(col.number!).values.map((v) => String(v ?? "").length + 2).slice(0, 50));
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileBase}.xlsx"`,
      },
    });
  }

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(row.map((v) => csv(String(v))).join(","));
  }
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileBase}.csv"`,
    },
  });
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
