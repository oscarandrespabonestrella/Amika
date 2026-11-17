// Pure: no React, no browser APIs. Vectors are L2-normalized, so cosine similarity is a
// plain dot product.
import { EMBED_DIM } from "./thresholds";

export type Vec = Float32Array;

/** A stored vector of a game: its catalog cover, a frame the user confirmed, or a pack entry. */
export type Reference = {
  gameId: string;
  vec: Vec;
  kind: "cover" | "learned" | "pack";
};

export type Ranked = {
  gameId: string;
  score: number;
  kind: Reference["kind"];
};

/** A unit-length Float32Array copy. Throws on a wrong length, NaN/Infinity or all zeros. */
export function normalize(v: ArrayLike<number>): Vec {
  if (v.length !== EMBED_DIM)
    throw new Error(`expected ${EMBED_DIM} numbers, got ${v.length}`);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) throw new Error("non-finite value");
    sum += v[i] * v[i];
  }
  if (sum === 0) throw new Error("zero vector");
  const norm = Math.sqrt(sum);
  const out = new Float32Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) out[i] = v[i] / norm;
  return out;
}

export function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * One row per game with the best similarity among its references (a learned frame can
 * beat the cover), best first; ties go to the lower game id so the order is stable.
 */
export function rankByCosine(query: Vec, refs: Reference[]): Ranked[] {
  const best = new Map<string, Ranked>();
  for (const ref of refs) {
    const score = cosine(query, ref.vec);
    const current = best.get(ref.gameId);
    if (!current || score > current.score)
      best.set(ref.gameId, { gameId: ref.gameId, score, kind: ref.kind });
  }
  return [...best.values()].sort(
    (a, b) => b.score - a.score || a.gameId.localeCompare(b.gameId),
  );
}
