// Canonical units and conversion. Quantities are stored in one of the
// CanonicalUnit values; legacy spellings (L/l/LT, g/G, ml/ML, Kg/kg) are
// normalized on the way in and never stored.

import { CanonicalUnit } from "@prisma/client";

export type UnitDimension = "MASS" | "VOLUME" | "COUNT";

export const UNIT_DIMENSION: Record<CanonicalUnit, UnitDimension> = {
  MG: "MASS",
  G: "MASS",
  KG: "MASS",
  ML: "VOLUME",
  L: "VOLUME",
  UNIT: "COUNT",
};

/** Factor to the dimension's base unit (G for mass, ML for volume). */
const TO_BASE: Record<CanonicalUnit, number> = {
  MG: 0.001,
  G: 1,
  KG: 1000,
  ML: 1,
  L: 1000,
  UNIT: 1,
};

/**
 * Map a raw legacy unit spelling to a canonical unit.
 * Returns null for unknown/ambiguous spellings (e.g. bare "m") — the caller
 * must flag those for human review, never guess.
 */
export function normalizeUnit(raw: string): CanonicalUnit | null {
  const u = raw.trim().toLowerCase();
  switch (u) {
    case "mg":
      return CanonicalUnit.MG;
    case "g":
    case "gm":
    case "gr":
      return CanonicalUnit.G;
    case "kg":
      return CanonicalUnit.KG;
    case "ml":
      return CanonicalUnit.ML;
    case "l":
    case "lt":
    case "ltr":
      return CanonicalUnit.L;
    case "unit":
    case "units":
    case "pc":
    case "pcs":
    case "ea":
      return CanonicalUnit.UNIT;
    default:
      return null;
  }
}

export function sameDimension(a: CanonicalUnit, b: CanonicalUnit): boolean {
  return UNIT_DIMENSION[a] === UNIT_DIMENSION[b];
}

/** Convert between units of the same dimension. Throws on dimension mismatch. */
export function convert(value: number, from: CanonicalUnit, to: CanonicalUnit): number {
  if (!sameDimension(from, to)) {
    throw new Error(`Cannot convert ${from} to ${to}: different dimensions`);
  }
  return (value * TO_BASE[from]) / TO_BASE[to];
}

const UNIT_LABEL: Record<CanonicalUnit, string> = {
  MG: "mg",
  G: "g",
  KG: "kg",
  ML: "mL",
  L: "L",
  UNIT: "unit",
};

export function unitLabel(unit: CanonicalUnit): string {
  return UNIT_LABEL[unit];
}

export function formatQuantity(value: number | string, unit: CanonicalUnit): string {
  const n = typeof value === "string" ? Number(value) : value;
  const rounded = Math.round(n * 1000) / 1000;
  return `${rounded.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${UNIT_LABEL[unit]}`;
}

/** Sensible stepper presets per unit, mirroring the design deck. */
export function presetSteps(unit: CanonicalUnit): number[] {
  switch (UNIT_DIMENSION[unit]) {
    case "VOLUME":
      return unit === CanonicalUnit.L ? [0.1, 0.25, 0.5, 1] : [10, 25, 50, 100, 250];
    case "MASS":
      if (unit === CanonicalUnit.KG) return [0.1, 0.25, 0.5, 1];
      if (unit === CanonicalUnit.MG) return [10, 25, 50, 100];
      return [5, 10, 25, 50, 100];
    case "COUNT":
      return [1, 2, 5, 10];
  }
}
