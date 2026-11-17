import { describe, expect, it } from "vitest";
import { normalize } from "../embedding/rank";
import { EMBED_DIM } from "../embedding/thresholds";
import { decodePack, encodePack, PackFormatError } from "./format";

const vec = (axis: number) => {
  const v = new Array(EMBED_DIM).fill(0);
  v[axis] = 1;
  return normalize(v);
};

describe("pack binary format", () => {
  it("round-trips vectors exactly", () => {
    const vecs = [vec(0), vec(7), vec(511)];
    const out = decodePack(encodePack(vecs), 3);
    expect(out).toHaveLength(3);
    out.forEach((v, i) => expect(Array.from(v)).toEqual(Array.from(vecs[i])));
  });

  it("decodes correctly from a Uint8Array view with a non-zero byteOffset", () => {
    const bytes = encodePack([vec(3)]);
    const padded = new Uint8Array(bytes.length + 5);
    padded.set(bytes, 5);
    const out = decodePack(padded.subarray(5), 1);
    expect(out[0][3]).toBeCloseTo(1, 7);
  });

  it("rejects a length that is not count x dim x 4 (truncated or extra bytes)", () => {
    const bytes = encodePack([vec(1), vec(2)]);
    expect(() => decodePack(bytes.subarray(0, bytes.length - 4), 2)).toThrow(
      PackFormatError,
    );
    expect(() => decodePack(bytes, 3)).toThrow(PackFormatError);
    expect(() => decodePack(new Uint8Array(3), 1)).toThrow(PackFormatError);
  });

  it("rejects NaN, Infinity and non-unit vectors", () => {
    const nan = vec(1);
    nan[4] = NaN;
    expect(() => decodePack(encodePack([nan]), 1)).toThrow(PackFormatError);
    const inf = vec(1);
    inf[4] = Infinity;
    expect(() => decodePack(encodePack([inf]), 1)).toThrow(PackFormatError);
    const big = new Float32Array(EMBED_DIM).fill(1);
    expect(() => decodePack(encodePack([big]), 1)).toThrow(PackFormatError);
    expect(() =>
      decodePack(encodePack([new Float32Array(EMBED_DIM)]), 1),
    ).toThrow(PackFormatError);
  });

  it("encodePack refuses a vector of the wrong dimension", () => {
    expect(() => encodePack([new Float32Array(10)])).toThrow(PackFormatError);
  });
});
