// Import pipeline tests against a fixture workbook that reproduces every
// pathological structure of the legacy export: repeated page headers, section
// titles with permit codes, column headers, sub-totals, totals, placeholder
// rows, duplicate Sub IDs across permit sections, every unit spelling, and
// incomplete locations.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  classifyRow,
  parseLegacyWorkbook,
  permitCategoryCode,
  type ParsedSheet,
} from "../scripts/import/parse-xlsx";
import {
  dedupeRows,
  isIncompleteLocation,
  locationKey,
  parseChemicalName,
} from "../scripts/import/normalize";
import { labCodeFromPermit } from "../scripts/import/load";

let dir: string;
let fixturePath: string;
let sheets: ParsedSheet[];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "chemtrack-import-"));
  fixturePath = path.join(dir, "fixture.xlsx");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Lab1");
  const rows: (string | number | null)[][] = [
    ["Page 1"],
    ["Chemical List of Hazardous Substances (CREATE HUJ/BGU R02-08 [Create Lab 1])"],
    ["Sub ID", "Chemical Name", "H.Code", "Qty", "Unit", "Location", "Lot No", "PI", "Reserved", "Type"],
    ["117376 ", "1,2-Dichloroethane [SIGALD/319929] ", "3  ", 1, "L ", "R2-FH02FSC ", "SHBN4729 ", "Pending for Correction ", "CK Teh  ", "S "],
    ["117377", "Acetic Acid, Glacial [Fluorochem/F044721]", "8", 500, "ml", "R2 FH 02 FSC", "20250120", "Cho Nam-Joon", "Li Wei", "S"],
    [null, "Sub-Total:", null, " 501", " L"],
    ["Total : 2", null, "Printed On:8/19/2026"],
    ["Page 2"],
    ["Chemical List of Chemical Weapons Chemical"],
    ["Chemical of this category not found for this lab!"],
    ["Chemical List of SCDF (CREATE HUJ/BGU R02-08 [Create Lab 1])"],
    ["Sub ID", "Chemical Name", "H.Code", "Qty", "Unit", "Location", "Lot No", "PI", "Reserved", "Type"],
    // duplicate of 117376 under a second permit section
    ["117376", "1,2-Dichloroethane [SIGALD/319929]", "3", 1, "LT", "R2-FH02FSC", "SHBN4729", "Pending for Correction", "CK Teh", "S"],
    // ambiguous unit + incomplete location
    ["200001", "Mystery solvent", "3", 2, "m", "E4-", "-", "Pending for Correction", "-", "S"],
    // conflicting duplicate (quantity differs) under same sheet
    ["300001", "Toluene [Merck/108883]", "3", 1, "L", "R2-FSC2", "LOT1", "Cho Nam-Joon", "Deepak", "S"],
    ["300001", "Toluene [Merck/108883]", "3", 2, "L", "R2FSC2", "LOT1", "Cho Nam-Joon", "Deepak", "S"],
    ["Total : 3", null, "Printed On:8/19/2026"],
  ];
  for (const r of rows) ws.addRow(r);
  await wb.xlsx.writeFile(fixturePath);
  sheets = await parseLegacyWorkbook(fixturePath);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("row classification", () => {
  it("classifies every structural row type", () => {
    expect(classifyRow(["Page 1", null])).toBe("PAGE_HEADER");
    expect(classifyRow(["Chemical List of SCDF (X [Y])", null])).toBe("SECTION_TITLE");
    expect(classifyRow(["Sub ID", "Chemical Name"])).toBe("COLUMN_HEADER");
    expect(classifyRow([null, "Sub-Total:"])).toBe("SUB_TOTAL");
    expect(classifyRow(["Total : 17", null])).toBe("TOTAL");
    expect(classifyRow(["Chemical of this category not found for this lab!", null])).toBe("PLACEHOLDER");
    expect(classifyRow(["117376", "Acetone [X/1]"])).toBe("DATA");
    expect(classifyRow([null, null])).toBe("BLANK");
  });

  it("maps section categories to stable codes", () => {
    expect(permitCategoryCode("Hazardous Substances")).toBe("HS");
    expect(permitCategoryCode("Chemical Weapons Chemical")).toBe("CW");
    expect(permitCategoryCode("SCDF")).toBe("SCDF");
    expect(permitCategoryCode("AFI & HC1-HC4.3")).toBe("AFI");
  });
});

describe("parsing the fixture", () => {
  it("strips nbsp padding and keeps data rows only where they belong", () => {
    const data = sheets[0].rows.filter((r) => r.kind === "DATA");
    expect(data).toHaveLength(6);
    expect(data[0].data?.subId).toBe("117376");
    expect(data[0].data?.unit).toBe("L");
    expect(data[0].data?.reservedBy).toBe("CK Teh");
  });

  it("carries the permit section as state across pages", () => {
    const data = sheets[0].rows.filter((r) => r.kind === "DATA");
    expect(data[0].data?.permitCategory).toBe("HS");
    expect(data[0].data?.permitCode).toBe("CREATE HUJ/BGU R02-08");
    expect(data[2].data?.permitCategory).toBe("SCDF");
    expect(data[2].data?.labLabel).toBe("Create Lab 1");
  });

  it("classifies placeholders and totals, not as data", () => {
    const kinds = sheets[0].rows.map((r) => r.kind);
    expect(kinds).toContain("PLACEHOLDER");
    expect(kinds).toContain("SUB_TOTAL");
    expect(kinds.filter((k) => k === "TOTAL")).toHaveLength(2);
  });
});

describe("name parsing", () => {
  it("splits name / supplier / catalog", () => {
    expect(parseChemicalName("Nitrobenzene - ACS reagent, >=99.0% [Sigma-Aldrich/252379]")).toEqual({
      name: "Nitrobenzene - ACS reagent, >=99.0%",
      supplier: "Sigma-Aldrich",
      catalogNumber: "252379",
      parsed: true,
    });
  });
  it("flags unparseable names without losing them", () => {
    const result = parseChemicalName("Custom ligand L-44");
    expect(result.parsed).toBe(false);
    expect(result.name).toBe("Custom ligand L-44");
  });
});

describe("location canonicalization", () => {
  it("collapses inconsistent spellings onto one key", () => {
    expect(locationKey("R2-FH02FSC")).toBe("R2FH02FSC");
    expect(locationKey("R2 FH 02 FSC")).toBe("R2FH02FSC");
    expect(locationKey("R2--FH06FSC")).toBe(locationKey("R2-FH06FSC"));
    expect(locationKey("i2FSC2")).toBe("I2FSC2");
  });
  it("marks stub locations incomplete", () => {
    expect(isIncompleteLocation("E4-")).toBe(true);
    expect(isIncompleteLocation("R2-FH02FSC")).toBe(false);
  });
});

describe("dedupe", () => {
  it("merges duplicate Sub IDs across permit sections into one candidate", () => {
    const { candidates } = dedupeRows(sheets);
    const dup = candidates.find((c) => c.subId === "117376")!;
    expect(dup.sourceRows).toHaveLength(2);
    expect([...dup.permitCategories.keys()].sort()).toEqual(["HS", "SCDF"]);
    expect(dup.conflicts).toHaveLength(0); // L and LT normalize to the same unit
  });

  it("flags quantity conflicts between duplicates for human review", () => {
    const { candidates } = dedupeRows(sheets);
    const conflicted = candidates.find((c) => c.subId === "300001")!;
    expect(conflicted.conflicts.some((c) => c.startsWith("QTY_MISMATCH"))).toBe(true);
  });

  it("flags ambiguous units and incomplete locations instead of guessing", () => {
    const { candidates } = dedupeRows(sheets);
    const mystery = candidates.find((c) => c.subId === "200001")!;
    expect(mystery.unit).toBeNull();
    expect(mystery.flags.has("UNIT_AMBIGUOUS")).toBe(true);
    expect(mystery.flags.has("LOCATION_INCOMPLETE")).toBe(true);
    expect(mystery.flags.has("NAME_UNPARSED")).toBe(true);
  });

  it("builds the location dictionary with all raw spellings", () => {
    const { locationDictionary } = dedupeRows(sheets);
    const entry = locationDictionary.get("R2FH02FSC")!;
    expect([...entry.spellings.keys()].sort()).toEqual(["R2 FH 02 FSC", "R2-FH02FSC"]);
  });
});

describe("lab identity", () => {
  it("derives the lab code from the permit's room code", () => {
    expect(labCodeFromPermit("CREATE HUJ/BGU R02-08", "Lab1")).toBe("R02-08");
    expect(labCodeFromPermit("CREATE HUJ-NTU-NUS I03-09", "Lab5")).toBe("I03-09");
    expect(labCodeFromPermit(null, "Lab3")).toBe("LEGACY-LAB3");
  });
});
