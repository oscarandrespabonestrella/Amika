import { describe, expect, it } from "vitest";
import { clamp, randomInt, shuffle, type Rng } from "./random";

const sequence = (values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("randomInt", () => {
  it("maps [0,1) onto [0,max)", () => {
    expect(randomInt(6, () => 0)).toBe(0);
    expect(randomInt(6, () => 0.999999)).toBe(5);
    expect(randomInt(6, () => 0.5)).toBe(3);
  });
});

describe("shuffle", () => {
  it("keeps every item exactly once and does not mutate the input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, sequence([0.9, 0.1, 0.5, 0.3]));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
  it("handles empty and single lists", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(["a"])).toEqual(["a"]);
  });
});

describe("clamp", () => {
  it("limits to the range", () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-5, 1, 3)).toBe(1);
    expect(clamp(2, 1, 3)).toBe(2);
  });
});
