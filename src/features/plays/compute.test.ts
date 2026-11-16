import { describe, expect, it } from "vitest";
import { SEVEN_WONDERS } from "@/features/scoring/engine/fixtures";
import { computePlay, rankTotals } from "./compute";

const FULL_ENTRY = {
  military: 6,
  coins: 10,
  wonders: 10,
  civilian: 12,
  commerce: 4,
  guilds: 6,
  science: { tablets: 3, compass: 2, gears: 1 },
};

describe("rankTotals", () => {
  it("uses competition ranking: [10,8,10,5] → 1,3,1,4 with the two tens winning", () => {
    expect(rankTotals([10, 8, 10, 5])).toEqual([
      { rank: 1, isWinner: true },
      { rank: 3, isWinner: false },
      { rank: 1, isWinner: true },
      { rank: 4, isWinner: false },
    ]);
  });

  it("leaves null totals unranked, and nobody wins when all are null", () => {
    expect(rankTotals([null, null])).toEqual([
      { rank: null, isWinner: false },
      { rank: null, isWinner: false },
    ]);
  });

  it("[0,0] → both rank 1 and winners", () => {
    expect(rankTotals([0, 0])).toEqual([
      { rank: 1, isWinner: true },
      { rank: 1, isWinner: true },
    ]);
  });

  it("[5,null] → the scored player wins, the other is unranked", () => {
    expect(rankTotals([5, null])).toEqual([
      { rank: 1, isWinner: true },
      { rank: null, isWinner: false },
    ]);
  });

  it("handles negative totals: [-3,-5] → 1,2", () => {
    expect(rankTotals([-3, -5]).map((r) => r.rank)).toEqual([1, 2]);
  });

  it("handles empty and single-player input", () => {
    expect(rankTotals([])).toEqual([]);
    expect(rankTotals([7])).toEqual([{ rank: 1, isWinner: true }]);
  });
});

describe("computePlay with a sheet", () => {
  it("7 Wonders: the full entry totals 62, {military: 3} totals 3, the first wins", () => {
    const result = computePlay(SEVEN_WONDERS, [
      { name: "A", values: FULL_ENTRY },
      { name: "B", values: { military: 3 } },
    ]);
    expect(result.ok).toBe(true);
    expect(
      result.participants.map((p) => [p.total, p.rank, p.isWinner]),
    ).toEqual([
      [62, 1, true],
      [3, 2, false],
    ]);
  });

  it("a participant without values has total null and is not ranked", () => {
    const result = computePlay(SEVEN_WONDERS, [
      { name: "A", values: { military: 5 } },
      { name: "B" },
      { name: "C", values: { military: undefined } },
    ]);
    expect(result.participants.map((p) => [p.total, p.rank])).toEqual([
      [5, 1],
      [null, null],
      [null, null],
    ]);
  });

  it("nobody has values → nobody wins", () => {
    const result = computePlay(SEVEN_WONDERS, [
      { name: "A" },
      { name: "B", values: {} },
    ]);
    expect(result.ok).toBe(true);
    expect(result.participants.some((p) => p.isWinner)).toBe(false);
  });

  it("drops values for keys that are not on the sheet (nothing extra is stored)", () => {
    const result = computePlay(SEVEN_WONDERS, [
      { name: "A", values: { military: 5, ghost: 99, __proto__: 1 } as never },
    ]);
    expect(result.participants[0].scores).toEqual({ military: 5 });
    expect(result.participants[0].total).toBe(5);
  });

  it("a bad value is a field error and the total stays a finite integer", () => {
    const result = computePlay(SEVEN_WONDERS, [
      { name: "A", values: { military: 1.5, wonders: 4 } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.participants[0].errors).toEqual({ military: "invalid" });
    expect(Number.isSafeInteger(result.participants[0].total)).toBe(true);
    expect(result.participants[0].total).toBe(4);
  });

  it("an invalid definition (a cycle) yields invalidDefinition", () => {
    const cyclic = {
      schemaVersion: 1,
      categories: [
        { key: "a", label: "a", type: "number" },
        { key: "x", label: "x", type: "derived", op: "sum", refs: ["a", "y"] },
        { key: "y", label: "y", type: "derived", op: "sum", refs: ["x", "a"] },
      ],
    };
    expect(computePlay(cyclic, [{ name: "A", values: { a: 1 } }])).toEqual({
      ok: false,
      participants: [],
      invalidDefinition: true,
    });
  });

  it("seat equals the index", () => {
    const result = computePlay(SEVEN_WONDERS, [
      { name: "A" },
      { name: "B" },
      { name: "C" },
    ]);
    expect(result.participants.map((p) => p.seat)).toEqual([0, 1, 2]);
  });
});

describe("computePlay with manual totals (no sheet)", () => {
  it("[12, 12, none] → both rank 1 and win, the third is unranked", () => {
    const result = computePlay(null, [
      { name: "A", manualTotal: 12 },
      { name: "B", manualTotal: 12 },
      { name: "C" },
    ]);
    expect(result.ok).toBe(true);
    expect(
      result.participants.map((p) => [p.total, p.rank, p.isWinner]),
    ).toEqual([
      [12, 1, true],
      [12, 1, true],
      [null, null, false],
    ]);
  });

  it("a fractional or out-of-range manual total is an error under 'manual'", () => {
    const fractional = computePlay(null, [{ name: "A", manualTotal: 1.5 }]);
    expect(fractional.ok).toBe(false);
    expect(fractional.participants[0].errors).toEqual({ manual: "invalid" });
    expect(fractional.participants[0].total).toBeNull();

    const huge = computePlay(null, [{ name: "A", manualTotal: 2_000_000 }]);
    expect(huge.participants[0].errors).toEqual({ manual: "outOfRange" });
  });

  it("ignores values when there is no sheet", () => {
    const result = computePlay(null, [
      { name: "A", values: { military: 5 }, manualTotal: 3 },
    ]);
    expect(result.participants[0]).toMatchObject({ total: 3, scores: {} });
  });
});
