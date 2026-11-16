import { describe, expect, it } from "vitest";
import { EMBED_DIM } from "./thresholds";
import { cosine, normalize, rankByCosine, type Reference } from "./rank";

/** A unit vector with a single 1 at `axis` (axes are orthogonal). */
const axis = (i: number) => {
  const v = new Array(EMBED_DIM).fill(0);
  v[i] = 1;
  return normalize(v);
};

describe("normalize", () => {
  it("returns a unit-length Float32Array", () => {
    const v = normalize(Array.from({ length: EMBED_DIM }, (_, i) => i + 1));
    expect(v).toBeInstanceOf(Float32Array);
    expect(Math.hypot(...v)).toBeCloseTo(1, 5);
  });

  it("rejects the zero vector and a wrong length", () => {
    expect(() => normalize(new Array(EMBED_DIM).fill(0))).toThrow();
    expect(() => normalize([1, 2, 3])).toThrow();
    expect(() => normalize([])).toThrow();
  });

  it("rejects non-finite values", () => {
    const v = new Array(EMBED_DIM).fill(1);
    v[3] = Number.NaN;
    expect(() => normalize(v)).toThrow();
  });
});

describe("cosine", () => {
  it("is 1 with itself and 0 for orthogonal vectors", () => {
    expect(cosine(axis(0), axis(0))).toBeCloseTo(1, 6);
    expect(cosine(axis(0), axis(1))).toBeCloseTo(0, 6);
  });
});

describe("rankByCosine", () => {
  const ref = (
    gameId: string,
    vec: Float32Array,
    kind: Reference["kind"] = "cover",
  ): Reference => ({ gameId, vec, kind });

  it("is empty without references", () => {
    expect(rankByCosine(axis(0), [])).toEqual([]);
  });

  it("gives one row per game, the best of its references, best first", () => {
    const mixed = normalize(
      Array.from({ length: EMBED_DIM }, (_, i) => (i < 2 ? 1 : 0)),
    );
    const rows = rankByCosine(axis(0), [
      ref("a", axis(1)), // cover: orthogonal
      ref("a", axis(0), "learned"), // a learned frame beats the cover
      ref("b", mixed),
      ref("c", axis(2)),
    ]);
    expect(rows.map((r) => r.gameId)).toEqual(["a", "b", "c"]);
    expect(rows[0]).toMatchObject({ gameId: "a", kind: "learned" });
    expect(rows[0].score).toBeCloseTo(1, 6);
    expect(rows[1].score).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("breaks ties by game id, deterministically", () => {
    const rows = rankByCosine(axis(0), [
      ref("b", axis(1)),
      ref("a", axis(2)),
      ref("c", axis(3)),
    ]);
    expect(rows.map((r) => r.gameId)).toEqual(["a", "b", "c"]);
  });
});
