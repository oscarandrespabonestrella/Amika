import { describe, expect, it } from "vitest";
import { checkRange, drawNumbers } from "./hidden-number";

describe("checkRange", () => {
  it("rejects inverted or fractional ranges", () => {
    expect(checkRange(2, 5, 1, false)).toBe("empty");
    expect(checkRange(2, 1.5, 4, false)).toBe("empty");
  });
  it("needs room for unique numbers", () => {
    expect(checkRange(5, 1, 4, true)).toBe("too_small");
    expect(checkRange(4, 1, 4, true)).toBe("ok");
    expect(checkRange(5, 1, 4, false)).toBe("ok");
  });
});

describe("drawNumbers", () => {
  it("draws inside the range", () => {
    for (const n of drawNumbers(50, -3, 3, false)!) {
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
  it("draws all different numbers when unique, even filling the range", () => {
    const small = drawNumbers(6, 1, 6, true)!;
    expect([...small].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    const big = drawNumbers(10, 1, 9999, true)!;
    expect(new Set(big).size).toBe(10);
  });
  it("returns null for an impossible request", () => {
    expect(drawNumbers(3, 1, 2, true)).toBeNull();
  });
});
