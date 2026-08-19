// Monthly regulated-substances return, e-mailed to EHS. Scheduling beats
// remembering: the report is a schedule, not a task (deck, reports note 3).

import nodemailer from "nodemailer";
import type { PrismaClient } from "@prisma/client";
import { unitLabel } from "../server/units";

export async function buildRegulatedReturnCsv(prisma: PrismaClient): Promise<string> {
  const since = new Date();
  since.setMonth(since.getMonth() - 1);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const transactions = await prisma.inventoryTransaction.findMany({
    where: {
      createdAt: { gte: since },
      container: { substance: { isControlled: true } },
    },
    include: {
      container: {
        include: {
          substance: { select: { name: true, casNumber: true } },
          lab: { select: { code: true } },
        },
      },
      auditEvent: { include: { actor: { select: { name: true } }, witness: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  const lines = ["date,substance,cas,container,lab,kind,before,after,unit,by,witness,reason"];
  for (const t of transactions) {
    lines.push(
      [
        t.createdAt.toISOString(),
        csv(t.container.substance.name),
        t.container.substance.casNumber ?? "",
        t.container.code,
        t.container.lab.code,
        t.kind,
        t.quantityBefore.toString(),
        t.quantityAfter.toString(),
        unitLabel(t.unit),
        csv(t.auditEvent.actor?.name ?? "system"),
        csv(t.auditEvent.witness?.name ?? ""),
        csv(t.reason),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export async function sendRegulatedReturnEmail(
  prisma: PrismaClient,
): Promise<Record<string, unknown>> {
  const csvBody = await buildRegulatedReturnCsv(prisma);
  const recipients = (process.env.EHS_REPORT_RECIPIENTS ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const host = process.env.SMTP_HOST;

  if (!host || recipients.length === 0) {
    return { skipped: true, reason: "SMTP_HOST or EHS_REPORT_RECIPIENTS not configured", rows: csvBody.split("\r\n").length - 2 };
  }

  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 25),
    secure: false,
  });
  const month = new Date().toISOString().slice(0, 7);
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "chemtrack@lab.internal",
    to: recipients,
    subject: `ChemTrack regulated-substances return — ${month}`,
    text: "Attached: movement return for controlled/licensed substances over the last month.",
    attachments: [{ filename: `regulated-return-${month}.csv`, content: csvBody }],
  });
  return { sent: true, recipients: recipients.length };
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
