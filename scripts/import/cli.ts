// Legacy import CLI.
//
//   pnpm import:legacy -- --file legacy.xlsx --dry-run [--report out.csv]
//   pnpm import:legacy -- --file legacy.xlsx            # applies
//   pnpm import:legacy -- --file legacy.xlsx --force    # fill gaps only
//
// The dry run prints (and optionally writes) the report to review with the
// lab managers BEFORE the real import — that review is a milestone gate.

import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { canonicalSpelling } from "./normalize";
import { applyImportPlan, buildImportPlan, labCodeFromPermit } from "./load";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const file = arg("file");
  if (!file) {
    console.error("Usage: pnpm import:legacy -- --file <xlsx> [--dry-run] [--report out.csv] [--force]");
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const plan = await buildImportPlan(file, prisma);

    console.log(`\n=== Import plan for ${plan.fileName} ===`);
    console.log(`file sha256: ${plan.fileHash}`);
    for (const [key, value] of Object.entries(plan.stats)) {
      console.log(`  ${key}: ${value}`);
    }
    console.log("\nData-quality flags (per unique container):");
    for (const [flag, count] of Object.entries(plan.flagCounts)) {
      console.log(`  ${flag}: ${count}`);
    }
    if (plan.errored.length > 0) {
      console.log("\nCONFLICTED containers (excluded from import, need human review):");
      for (const c of plan.errored) {
        console.log(`  Sub ID ${c.subId}: ${c.conflicts.join("; ")}`);
      }
    }
    console.log(`\nPeople without accounts (containers land as pending-correction):`);
    const people = [...plan.unmatchedPeople.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of people.slice(0, 15)) console.log(`  ${name} (${count})`);
    if (people.length > 15) console.log(`  … and ${people.length - 15} more`);

    console.log(`\nLocation dictionary (${plan.dedupe.locationDictionary.size} canonical locations):`);
    let shown = 0;
    for (const [key, entry] of plan.dedupe.locationDictionary) {
      if (entry.spellings.size > 1 && shown < 10) {
        console.log(
          `  ${canonicalSpelling(entry.spellings)}  ←  ${[...entry.spellings.keys()].join(" | ")}  [key ${key}]`,
        );
        shown++;
      }
    }

    const reportPath = arg("report");
    if (reportPath) {
      writeFileSync(reportPath, buildReportCsv(plan));
      console.log(`\nReport written to ${reportPath}`);
    }

    if (has("dry-run")) {
      console.log("\nDry run — nothing was written.");
      return;
    }

    const result = await applyImportPlan(plan, prisma, { force: has("force") });
    console.log(
      `\nImport applied: batch ${result.batchId}, ${result.created} containers created, ` +
        `${result.skippedExisting} already existed.`,
    );
    console.log("Unresolved items are queued in Admin → Import fixup.");
  } finally {
    await prisma.$disconnect();
  }
}

function buildReportCsv(plan: Awaited<ReturnType<typeof buildImportPlan>>): string {
  const lines = [
    "sub_id,sheet,lab_code,substance,supplier,catalog,qty,unit,raw_unit,location,raw_location,lot,custodian,pi,permits,flags,conflicts",
  ];
  for (const c of plan.dedupe.candidates) {
    lines.push(
      [
        c.subId,
        c.sheetName,
        labCodeFromPermit(c.permitCode, c.sheetName),
        q(c.substanceName),
        q(c.supplier ?? ""),
        q(c.catalogNumber ?? ""),
        c.quantity ?? "",
        c.unit ?? "",
        q(c.rawUnit ?? ""),
        q(c.locationKey ?? ""),
        q(c.rawLocation ?? ""),
        q(c.lotNumber ?? ""),
        q(c.reservedBy ?? ""),
        q(c.pi ?? ""),
        q([...c.permitCategories.keys()].join("+")),
        q([...c.flags].join("+")),
        q(c.conflicts.join("+")),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

function q(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
