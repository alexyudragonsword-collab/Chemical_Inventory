// Background worker — runs in its own container from the same image as the
// app (`node_modules/.bin/tsx src/worker/index.ts`). Imports the same domain
// functions as the web app; no HTTP hop.

import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { sweepAlerts, sweepQuantityDrift } from "../server/alerts";
import { scanCabinet } from "../server/compatibility";
import { writeAuditEvent } from "../server/audit";
import { sendRegulatedReturnEmail } from "./regulated-return";

const prisma = new PrismaClient();

async function runJob(jobName: string, job: () => Promise<Record<string, unknown>>) {
  const run = await prisma.jobRun.create({ data: { jobName } });
  try {
    const summary = await job();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: true, summary: summary as never },
    });
    console.log(`[worker] ${jobName} ok`, summary);
  } catch (error) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, error: String(error) },
    });
    console.error(`[worker] ${jobName} FAILED`, error);
  }
}

// 02:00 — compatibility re-check: catches cabinets that drifted out of
// compliance because a bottle went back to the wrong place.
cron.schedule("0 2 * * *", () =>
  runJob("compat-recheck", async () => {
    const cabinets = await prisma.storageLocation.findMany({
      where: { parentId: null },
      select: { id: true, code: true, labId: true },
    });
    let conflicted = 0;
    for (const cabinet of cabinets) {
      const scan = await scanCabinet(prisma, cabinet.id);
      if (scan.conflicts.length > 0) conflicted++;
    }
    await prisma.$transaction((tx) =>
      writeAuditEvent(tx, {
        eventType: "system.compat_recheck",
        onBehalfSystem: true,
        entityType: "system",
        entityId: "nightly",
        payload: { cabinets: cabinets.length, conflicted },
      }),
    );
    return { cabinets: cabinets.length, conflicted };
  }),
);

// 02:30 — alert sweep (expiry, low stock, SDS unread, compat conflicts).
cron.schedule("30 2 * * *", () =>
  runJob("alert-sweep", async () => (await sweepAlerts(prisma)) as never),
);

// 03:00 — quantity drift check.
cron.schedule("0 3 * * *", () =>
  runJob("quantity-drift", async () => ({ drifted: await sweepQuantityDrift(prisma) })),
);

// 03:30 on the 1st — regulated-substances return email to EHS.
cron.schedule("30 3 1 * *", () =>
  runJob("regulated-return", () => sendRegulatedReturnEmail(prisma)),
);

// Every 5 minutes — housekeeping: expire stale transfer requests (14 days).
cron.schedule("*/5 * * * *", () =>
  runJob("housekeeping", async () => {
    const cutoff = new Date(Date.now() - 14 * 86_400_000);
    const expired = await prisma.transferRequest.updateMany({
      where: { status: "PENDING", createdAt: { lt: cutoff } },
      data: { status: "EXPIRED", resolvedAt: new Date() },
    });
    return { expiredTransferRequests: expired.count };
  }),
);

console.log("[worker] ChemTrack worker started — schedules armed.");

// Also run an immediate sweep at boot so a fresh deployment has alerts.
runJob("alert-sweep", async () => (await sweepAlerts(prisma)) as never);
