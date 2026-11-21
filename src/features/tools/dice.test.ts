import { describe, expect, it } from "vitest";
import { formatFormula, MAX_DICE, rollDice } from "./dice";

describe("rollDice", () => {
  it("rolls each die between 1 and the sides and adds the modifier", () => {
    const low = rollDice(3, 6, 2, () => 0);
    expect(low.values).toEqual([1, 1, 1]);
    expect(low.total).toBe(5);
    const high = rollDice(2, 20, -3, () => 0.999999);
    expect(high.values).toEqual([20, 20]);
    expect(high.total).toBe(37);
  });
  it("clamps count, sides and modifier", () => {
    const r = rollDice(99, 1000, 500, () => 0);
    expect(r.values).toHaveLength(MAX_DICE);
    expect(r.sides).toBe(100);
    expect(r.modifier).toBe(20);
    expect(rollDice(0, 1, 0, () => 0).values).toEqual([1]);
    expect(rollDice(Number.NaN, Number.NaN, Number.NaN, () => 0).sides).toBe(2);
  });
});

describe("formatFormula", () => {
  it("shows the modifier only when it is not zero", () => {
    expect(formatFormula(2, 6, 3)).toBe("2d6+3");
    expect(formatFormula(1, 20, 0)).toBe("1d20");
    expect(formatFormula(3, 8, -1)).toBe("3d8-1");
  });
});
