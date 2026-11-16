import { describe, expect, it } from "vitest";
import { fitWithin, ImageError } from "./image-prep";

describe("fitWithin", () => {
  it("never enlarges and keeps the aspect ratio", () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(3000, 4000, 1280)).toEqual({ width: 960, height: 1280 });
  });
  it("never returns a zero side", () => {
    expect(fitWithin(10000, 1, 1280)).toEqual({ width: 1280, height: 1 });
  });
});

describe("ImageError", () => {
  it("carries a stable code", () => {
    const e = new ImageError("too_large");
    expect(e.code).toBe("too_large");
    expect(e).toBeInstanceOf(Error);
  });
});
