import { describe, expect, it } from "vitest";
import { dHashFromGray } from "../dhash";
import {
  fitWithin,
  grayFromRgba,
  hashFromRgba,
  ImageError,
} from "./image-prep";

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

describe("grayFromRgba", () => {
  it("uses luminance weights and composites transparency over white", () => {
    const rgba = [
      255,
      0,
      0,
      255, // opaque red
      0,
      0,
      0,
      0, // fully transparent (hidden black): white
      0,
      0,
      0,
      255, // opaque black
    ];
    const gray = grayFromRgba(rgba);
    expect(gray[0]).toBeCloseTo(0.299 * 255, 5);
    expect(gray[1]).toBeCloseTo(255, 5);
    expect(gray[2]).toBeCloseTo(0, 5);
  });
});

describe("hashFromRgba", () => {
  const rgba = (w: number, h: number, f: (x: number, y: number) => number) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        out[i] = out[i + 1] = out[i + 2] = f(x, y);
        out[i + 3] = 255;
      }
    return out;
  };

  it("is a 16-hex hash, stable for the same picture", () => {
    const a = rgba(180, 160, (x, y) => ((x * 7 + y * 13) % 200) + 20);
    expect(hashFromRgba(a, 180, 160)).toMatch(/^[0-9a-f]{16}$/);
    expect(hashFromRgba(a, 180, 160)).toBe(hashFromRgba(a, 180, 160));
  });

  it("depends on the picture, not on its resolution", () => {
    const f = (x: number, w: number) => (x / w < 0.5 ? 200 : 50);
    const small = rgba(90, 80, (x) => f(x, 90));
    const large = rgba(360, 320, (x) => f(x, 360));
    expect(hashFromRgba(small, 90, 80)).toBe(hashFromRgba(large, 360, 320));
    // and it is a real hash, not the flat-image one
    expect(hashFromRgba(small, 90, 80)).not.toBe(
      dHashFromGray(new Array(72).fill(0)),
    );
  });
});

describe("ImageError", () => {
  it("carries a stable code", () => {
    const e = new ImageError("too_large");
    expect(e.code).toBe("too_large");
    expect(e).toBeInstanceOf(Error);
  });
});
