import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  computeEventHash,
  correctionNeedsWitness,
} from "@/server/audit";

describe("canonicalJson", () => {
  it("is key-order independent at every depth", () => {
    const a = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: 2 } };
    const b = { a: { c: 2, d: [1, { y: 2, z: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
  it("preserves array order", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe("computeEventHash", () => {
  const base = {
    prevHash: "chemtrack-genesis-2026",
    seq: 1n,
    eventType: "container.deduct",
    actorId: "u1",
    onBehalfSystem: false,
    entityType: "container",
    entityId: "c1",
    payload: { before: 100, after: 50 },
    witnessId: null,
    createdAtIso: "2026-08-19T09:00:00.000Z",
  };

  it("is deterministic", () => {
    expect(computeEventHash(base)).toBe(computeEventHash({ ...base }));
  });

  it("changes when any hashed field changes", () => {
    const original = computeEventHash(base);
    expect(computeEventHash({ ...base, payload: { before: 100, after: 51 } })).not.toBe(original);
    expect(computeEventHash({ ...base, actorId: "u2" })).not.toBe(original);
    expect(computeEventHash({ ...base, prevHash: "x" })).not.toBe(original);
    expect(computeEventHash({ ...base, seq: 2n })).not.toBe(original);
    expect(computeEventHash({ ...base, createdAtIso: "2026-08-19T09:00:01.000Z" })).not.toBe(original);
  });
});

describe("correctionNeedsWitness — the 20% rule", () => {
  it("small corrections pass without witness", () => {
    expect(correctionNeedsWitness(100, 85)).toBe(false); // 15%
    expect(correctionNeedsWitness(100, 120)).toBe(false); // 20% exactly is the boundary
  });
  it("large corrections need a witness", () => {
    expect(correctionNeedsWitness(100, 79)).toBe(true); // 21%
    expect(correctionNeedsWitness(2500, 1800)).toBe(true); // the deck's hexane example (28%)
  });
  it("from zero: any change needs a witness", () => {
    expect(correctionNeedsWitness(0, 10)).toBe(true);
    expect(correctionNeedsWitness(0, 0)).toBe(false);
  });
});
