// Stage 1 — parse the legacy "Chemical by Permit" export.
//
// The file is a paginated print report, one sheet per lab. Rows are page
// headers, section titles ("Chemical List of <category> (<permit code>
// [Create Lab N])"), column headers, data rows, Sub-Totals, Totals and
// placeholder rows. A state machine carries the current permit section while
// streaming; every physical row is preserved with a classification so the
// loader can store full provenance.

import ExcelJS from "exceljs";

export type RawRowKind =
  | "PAGE_HEADER"
  | "SECTION_TITLE"
  | "COLUMN_HEADER"
  | "SUB_TOTAL"
  | "TOTAL"
  | "PLACEHOLDER"
  | "BLANK"
  | "DATA";

export type ParsedRow = {
  sheetName: string;
  rowIndex: number; // 1-based, as in the sheet
  kind: RawRowKind;
  raw: (string | number | null)[];
  /** DATA rows only: */
  data?: {
    subId: string;
    chemicalName: string;
    hazardCode: string | null;
    quantity: number | null;
    unit: string | null;
    location: string | null;
    lotNumber: string | null;
    pi: string | null;
    reservedBy: string | null;
    type: string | null;
    permitCategory: string | null; // section-derived, e.g. "SCDF"
    permitCode: string | null; // e.g. "CREATE HUJ/BGU R02-08"
    labLabel: string | null; // e.g. "Create Lab 1"
  };
};

export type ParsedSheet = {
  sheetName: string;
  rows: ParsedRow[];
};

const SECTION_RE = /^Chemical List of\s+(.+?)\s*(?:\((.+?)\s*\[(.+?)\]\s*\))?$/;

/** Map a section title's category text to a stable permit category code. */
export function permitCategoryCode(categoryText: string): string {
  const t = categoryText.toLowerCase();
  if (t.includes("hazardous")) return "HS";
  if (t.includes("weapon")) return "CW";
  if (t.includes("scdf")) return "SCDF";
  if (t.includes("afi")) return "AFI";
  return categoryText.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export function cleanCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // exceljs rich text / formula results
    const v = value as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (v.richText) return cleanText(v.richText.map((r) => r.text).join(""));
    if (v.text) return cleanText(v.text);
    if (v.result !== undefined) return cleanCell(v.result);
    return null;
  }
  return cleanText(String(value));
}

function cleanText(s: string): string | null {
  const cleaned = s.replaceAll(" ", " ").trim();
  return cleaned === "" ? null : cleaned;
}

export function classifyRow(cells: (string | number | null)[]): RawRowKind {
  const c0 = cells[0] === null ? "" : String(cells[0]);
  const c1 = cells[1] === null ? "" : String(cells[1]);
  if (cells.every((c) => c === null)) return "BLANK";
  if (/^Page\s+\d+/i.test(c0)) return "PAGE_HEADER";
  if (c0.startsWith("Chemical List of")) return "SECTION_TITLE";
  if (c0 === "Sub ID") return "COLUMN_HEADER";
  if (c1 === "Sub-Total:") return "SUB_TOTAL";
  if (/^Total\s*:/.test(c0)) return "TOTAL";
  if (/not found for this lab/i.test(c0)) return "PLACEHOLDER";
  if (c0 !== "" && c1 !== "") return "DATA";
  return "BLANK";
}

export async function parseLegacyWorkbook(filePath: string): Promise<ParsedSheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets: ParsedSheet[] = [];
  for (const worksheet of workbook.worksheets) {
    const rows: ParsedRow[] = [];
    let section: { category: string; permitCode: string | null; labLabel: string | null } | null =
      null;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = row.values as unknown[]; // 1-based
      const cells: (string | number | null)[] = [];
      for (let i = 1; i <= 12; i++) cells.push(cleanCell(values[i]));

      const kind = classifyRow(cells);
      const parsed: ParsedRow = { sheetName: worksheet.name, rowIndex: rowNumber, kind, raw: cells };

      if (kind === "SECTION_TITLE") {
        const match = SECTION_RE.exec(String(cells[0]));
        if (match) {
          section = {
            category: permitCategoryCode(match[1]),
            permitCode: match[2]?.trim() ?? null,
            labLabel: match[3]?.trim() ?? null,
          };
        }
      }

      if (kind === "DATA") {
        parsed.data = {
          subId: String(cells[0]).trim(),
          chemicalName: String(cells[1] ?? "").trim(),
          hazardCode: cells[2] === null ? null : String(cells[2]).trim(),
          quantity: typeof cells[3] === "number" ? cells[3] : parseNumeric(cells[3]),
          unit: cells[4] === null ? null : String(cells[4]).trim(),
          location: cells[5] === null ? null : String(cells[5]).trim(),
          lotNumber: cells[6] === null ? null : String(cells[6]).trim(),
          pi: cells[7] === null ? null : String(cells[7]).trim(),
          reservedBy: cells[8] === null ? null : String(cells[8]).trim(),
          type: cells[9] === null ? null : String(cells[9]).trim(),
          permitCategory: section?.category ?? null,
          permitCode: section?.permitCode ?? null,
          labLabel: section?.labLabel ?? null,
        };
      }

      rows.push(parsed);
    });

    sheets.push({ sheetName: worksheet.name, rows });
  }
  return sheets;
}

function parseNumeric(value: string | number | null): number | null {
  if (value === null) return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
