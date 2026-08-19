// Client-safe unit helpers (no Prisma import — keeps the browser bundle
// clean). Values must stay in sync with the CanonicalUnit enum.

export type UnitCode = "MG" | "G" | "KG" | "ML" | "L" | "UNIT";

export const UNIT_LABELS: Record<UnitCode, string> = {
  MG: "mg",
  G: "g",
  KG: "kg",
  ML: "mL",
  L: "L",
  UNIT: "unit",
};

export function unitLabel(unit: string): string {
  return UNIT_LABELS[unit as UnitCode] ?? unit.toLowerCase();
}

export function presetSteps(unit: string): number[] {
  switch (unit as UnitCode) {
    case "ML":
      return [10, 25, 50, 100, 250];
    case "L":
      return [0.1, 0.25, 0.5, 1];
    case "G":
      return [5, 10, 25, 50, 100];
    case "KG":
      return [0.1, 0.25, 0.5, 1];
    case "MG":
      return [10, 25, 50, 100];
    default:
      return [1, 2, 5, 10];
  }
}

export function formatQty(value: number, unit: string): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${unitLabel(unit)}`;
}
