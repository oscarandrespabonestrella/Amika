import { describe, expect, it } from "vitest";
import {
  HASH_HEIGHT,
  HASH_WIDTH,
  dHashFromGray,
  hamming,
  isHash,
} from "./dhash";

const SIZE = HASH_WIDTH * HASH_HEIGHT;
const gray = (f: (x: number, y: number) => number) =>
  Array.from({ length: SIZE }, (_, i) =>
    f(i % HASH_WIDTH, Math.floor(i / HASH_WIDTH)),
  );

describe("dHashFromGray", () => {
  it("is 16 lowercase hex characters", () => {
    expect(dHashFromGray(gray((x, y) => x * 7 + y * 3))).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });

  it("a constant image has no brighter-than-neighbour pixel", () => {
    expect(dHashFromGray(gray(() => 120))).toBe("0000000000000000");
  });

  it("a strictly decreasing row pattern sets every bit", () => {
    expect(dHashFromGray(gray((x) => 255 - x * 10))).toBe("ffffffffffffffff");
  });

  it("is invariant to brightness shifts and contrast scaling", () => {
    const base = gray((x, y) => (x * 13 + y * 29) % 97);
    const shifted = base.map((v) => v + 40);
    const scaled = base.map((v) => v * 2);
    expect(dHashFromGray(shifted)).toBe(dHashFromGray(base));
    expect(dHashFromGray(scaled)).toBe(dHashFromGray(base));
  });

  it("rejects an input of the wrong size", () => {
    expect(() => dHashFromGray([1, 2, 3])).toThrow();
  });
});

describe("hamming and isHash", () => {
  it("counts differing bits", () => {
    expect(hamming("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hamming("00000000000000f0", "0000000000000000")).toBe(4);
    expect(hamming("abcdef0123456789", "abcdef0123456789")).toBe(0);
  });

  it("throws on malformed hex", () => {
    expect(() => hamming("zz", "0000000000000000")).toThrow();
    expect(() => hamming("0000000000000000", "ABCDEF0123456789")).toThrow();
  });

  it("isHash accepts only 16 lowercase hex characters", () => {
    expect(isHash("0123456789abcdef")).toBe(true);
    expect(isHash("0123456789ABCDEF")).toBe(false);
    expect(isHash("0123")).toBe(false);
    expect(isHash("")).toBe(false);
  });
});
