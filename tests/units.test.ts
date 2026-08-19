import { describe, expect, it } from "vitest";
import { convert, normalizeUnit, sameDimension } from "@/server/units";
import { CanonicalUnit } from "@prisma/client";

describe("normalizeUnit — every legacy spelling from the export", () => {
  const cases: [string, CanonicalUnit | null][] = [
    ["L", "L"],
    ["l", "L"],
    ["LT", "L"],
    ["ml", "ML"],
    ["ML", "ML"],
    ["g", "G"],
    ["G", "G"],
    ["Kg", "KG"],
    ["kg", "KG"],
    ["mg", "MG"],
    [" L ", "L"], // with the nbsp-derived padding the export carries
    ["m", null], // ambiguous — must be flagged, never guessed
    ["", null],
    ["bottles?", null],
  ];
  for (const [raw, expected] of cases) {
    it(`"${raw}" → ${expected ?? "null (flag for review)"}`, () => {
      expect(normalizeUnit(raw)).toBe(expected);
    });
  }
});

describe("convert", () => {
  it("mass round-trips", () => {
    expect(convert(1.5, "KG", "G")).toBe(1500);
    expect(convert(1500, "G", "KG")).toBe(1.5);
    expect(convert(250, "MG", "G")).toBe(0.25);
  });
  it("volume round-trips", () => {
    expect(convert(2.5, "L", "ML")).toBe(2500);
    expect(convert(500, "ML", "L")).toBe(0.5);
  });
  it("refuses cross-dimension conversion", () => {
    expect(() => convert(1, "L", "G")).toThrow(/different dimensions/);
    expect(sameDimension("L", "ML")).toBe(true);
    expect(sameDimension("L", "KG")).toBe(false);
  });
});
