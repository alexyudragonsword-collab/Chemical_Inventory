// Stage 2 — normalize parsed data rows and Stage 3 — dedupe into container
// candidates. Pure functions; every unresolvable ambiguity is FLAGGED, never
// guessed.

import type { CanonicalUnit } from "@prisma/client";
import { normalizeUnit } from "../../src/server/units";
import type { ParsedRow, ParsedSheet } from "./parse-xlsx";

export type NormalizedRow = {
  sheetName: string;
  rowIndex: number;
  raw: (string | number | null)[];
  subId: string;
  substanceName: string;
  supplier: string | null;
  catalogNumber: string | null;
  hazardCode: string | null;
  quantity: number | null;
  unit: CanonicalUnit | null;
  rawUnit: string | null;
  locationKey: string | null; // canonical grouping key
  rawLocation: string | null;
  lotNumber: string | null;
  pi: string | null; // "Pending for Correction" -> null + flag
  reservedBy: string | null;
  permitCategory: string | null;
  permitCode: string | null;
  labLabel: string | null;
  flags: string[]; // UNIT_AMBIGUOUS, PI_PENDING, LOCATION_INCOMPLETE, NAME_UNPARSED, QTY_MISSING
};

/** "1,2-Dichloroethane [SIGALD/319929]" -> name + supplier + catalog no. */
export function parseChemicalName(full: string): {
  name: string;
  supplier: string | null;
  catalogNumber: string | null;
  parsed: boolean;
} {
  const match = /^(.*?)\s*\[([^/\]]+)\/([^\]]+)\]\s*$/.exec(full.trim());
  if (!match) return { name: full.trim(), supplier: null, catalogNumber: null, parsed: false };
  return {
    name: match[1].trim(),
    supplier: match[2].trim(),
    catalogNumber: match[3].trim(),
    parsed: true,
  };
}

/**
 * Canonical grouping key for the 94 inconsistent location spellings:
 * uppercase, strip everything non-alphanumeric. "R2-FH02FSC", "R2 FH 02 FSC"
 * and "R2--FH06FSC" all collapse onto one key.
 */
export function locationKey(raw: string): string | null {
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return key === "" ? null : key;
}

/** A location whose raw string ends in a separator ("E4-", "R2-") is a stub. */
export function isIncompleteLocation(raw: string): boolean {
  return /[-\s/]$/.test(raw.trim()) || locationKey(raw) === null || raw.trim().length <= 3;
}

const PI_PENDING = /pending\s+for\s+correction/i;

export function normalizeRow(row: ParsedRow): NormalizedRow | null {
  if (row.kind !== "DATA" || !row.data) return null;
  const d = row.data;
  const flags: string[] = [];

  const nameParts = parseChemicalName(d.chemicalName);
  if (!nameParts.parsed) flags.push("NAME_UNPARSED");

  let unit: CanonicalUnit | null = null;
  if (d.unit === null) {
    flags.push("UNIT_AMBIGUOUS");
  } else {
    unit = normalizeUnit(d.unit);
    if (unit === null) flags.push("UNIT_AMBIGUOUS");
  }

  if (d.quantity === null) flags.push("QTY_MISSING");

  let pi: string | null = d.pi;
  if (pi && PI_PENDING.test(pi)) {
    pi = null;
    flags.push("PI_PENDING");
  }

  let locKey: string | null = null;
  if (d.location === null) {
    flags.push("LOCATION_INCOMPLETE");
  } else {
    locKey = locationKey(d.location);
    if (locKey === null || isIncompleteLocation(d.location)) flags.push("LOCATION_INCOMPLETE");
  }

  const reservedBy = d.reservedBy && d.reservedBy !== "-" ? d.reservedBy : null;

  return {
    sheetName: row.sheetName,
    rowIndex: row.rowIndex,
    raw: row.raw,
    subId: d.subId,
    substanceName: nameParts.name,
    supplier: nameParts.supplier,
    catalogNumber: nameParts.catalogNumber,
    hazardCode: d.hazardCode,
    quantity: d.quantity,
    unit,
    rawUnit: d.unit,
    locationKey: locKey,
    rawLocation: d.location,
    lotNumber: d.lotNumber && d.lotNumber !== "-" ? d.lotNumber : null,
    pi,
    reservedBy,
    permitCategory: d.permitCategory,
    permitCode: d.permitCode,
    labLabel: d.labLabel,
    flags,
  };
}

export type ContainerCandidate = {
  subId: string;
  sheetName: string;
  labLabel: string | null;
  permitCode: string | null;
  substanceName: string;
  supplier: string | null;
  catalogNumber: string | null;
  hazardCode: string | null;
  quantity: number | null;
  unit: CanonicalUnit | null;
  rawUnit: string | null;
  locationKey: string | null;
  rawLocation: string | null;
  lotNumber: string | null;
  pi: string | null;
  reservedBy: string | null;
  permitCategories: Map<string, string | null>; // category code -> permit code
  flags: Set<string>;
  sourceRows: { sheetName: string; rowIndex: number }[];
  /** Populated when duplicate rows disagree on a core field. */
  conflicts: string[];
};

export type DedupeResult = {
  candidates: ContainerCandidate[];
  /** Location dictionary: canonical key -> raw spellings seen (most frequent first). */
  locationDictionary: Map<string, { spellings: Map<string, number>; sheetNames: Set<string> }>;
};

/**
 * The same Sub ID appears once per permit section it is listed under (787
 * rows -> 480 containers in the current export). Merge duplicates, assert the
 * physical fields agree, accumulate the permit-category m2m.
 */
export function dedupeRows(sheets: ParsedSheet[]): DedupeResult {
  const byId = new Map<string, ContainerCandidate>();
  const locationDictionary: DedupeResult["locationDictionary"] = new Map();

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const n = normalizeRow(row);
      if (!n) continue;

      if (n.rawLocation && n.locationKey) {
        let entry = locationDictionary.get(n.locationKey);
        if (!entry) {
          entry = { spellings: new Map(), sheetNames: new Set() };
          locationDictionary.set(n.locationKey, entry);
        }
        entry.spellings.set(n.rawLocation, (entry.spellings.get(n.rawLocation) ?? 0) + 1);
        entry.sheetNames.add(n.sheetName);
      }

      const existing = byId.get(n.subId);
      if (!existing) {
        byId.set(n.subId, {
          subId: n.subId,
          sheetName: n.sheetName,
          labLabel: n.labLabel,
          permitCode: n.permitCode,
          substanceName: n.substanceName,
          supplier: n.supplier,
          catalogNumber: n.catalogNumber,
          hazardCode: n.hazardCode,
          quantity: n.quantity,
          unit: n.unit,
          rawUnit: n.rawUnit,
          locationKey: n.locationKey,
          rawLocation: n.rawLocation,
          lotNumber: n.lotNumber,
          pi: n.pi,
          reservedBy: n.reservedBy,
          permitCategories: new Map(n.permitCategory ? [[n.permitCategory, n.permitCode]] : []),
          flags: new Set(n.flags),
          sourceRows: [{ sheetName: n.sheetName, rowIndex: n.rowIndex }],
          conflicts: [],
        });
        continue;
      }

      // Merge a duplicate listing of the same physical container.
      existing.sourceRows.push({ sheetName: n.sheetName, rowIndex: n.rowIndex });
      if (n.permitCategory) existing.permitCategories.set(n.permitCategory, n.permitCode);
      for (const f of n.flags) existing.flags.add(f);

      if (existing.sheetName !== n.sheetName) existing.conflicts.push("SHEET_MISMATCH");
      if (n.quantity !== null && existing.quantity !== null && n.quantity !== existing.quantity) {
        existing.conflicts.push(`QTY_MISMATCH(${existing.quantity}≠${n.quantity})`);
      }
      if (n.substanceName !== existing.substanceName) {
        existing.conflicts.push("NAME_MISMATCH");
      }
      if (
        n.locationKey !== null &&
        existing.locationKey !== null &&
        n.locationKey !== existing.locationKey
      ) {
        existing.conflicts.push("LOCATION_MISMATCH");
      }
    }
  }

  return { candidates: [...byId.values()], locationDictionary };
}

/** Pick the display spelling for a canonical location key: most frequent raw
 * variant, trimmed. */
export function canonicalSpelling(spellings: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [spelling, count] of spellings) {
    if (count > bestCount) {
      best = spelling;
      bestCount = count;
    }
  }
  return best.trim();
}
