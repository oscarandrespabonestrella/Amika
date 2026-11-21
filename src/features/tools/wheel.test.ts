import { describe, expect, it } from "vitest";
import { sliceAtPointer, slicePath, targetRotation } from "./wheel";

describe("targetRotation", () => {
  it("stops the chosen slice under the pointer, from any starting angle", () => {
    for (const count of [2, 3, 5, 8, 24]) {
      for (const start of [0, 37.5, 359, 1234.5]) {
        for (let index = 0; index < count; index++) {
          for (const offset of [0, 0.5, 1]) {
            const end = targetRotation(start, index, count, 5, offset);
            expect(sliceAtPointer(end, count)).toBe(index);
          }
        }
      }
    }
  });
  it("always turns forward by at least the extra turns", () => {
    expect(targetRotation(100, 0, 4, 5, 0.5)).toBeGreaterThanOrEqual(
      100 + 1800,
    );
  });
});

describe("slicePath", () => {
  it("draws a closed pie slice, or a full circle for one option", () => {
    expect(slicePath(0, 4, 100)).toMatch(
      /^M 100 100 L .* A 100 100 0 0 1 .* Z$/,
    );
    expect(slicePath(0, 1, 100)).toContain("A 100 100 0 1 1");
  });
});
