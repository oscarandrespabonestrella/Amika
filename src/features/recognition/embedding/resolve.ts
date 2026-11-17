// Pure. The decision of the live recognition: what to tell the user about one frame (or a
// stable run of frames), combining the picture model, geometric verification and a learned
// barcode. Shared by the app, the single-photo path and the evaluation harness, so they
// cannot disagree.
import { levelFor, type Level } from "./confidence";
import type { Ranked } from "./rank";
import {
  LOCK_MIN_MARGIN,
  LOCK_MIN_SIMILARITY,
  ORB_HIGH_INLIERS,
} from "./thresholds";
import type { Lock } from "./vote";

/** A leader must have at least this many times the evidence of the runner-up. */
const LEAD_RATIO = 2;

/**
 * Geometric verification settles what the picture model leaves ambiguous: when CLIP cannot
 * tell two covers apart (a tiny lead), ORB inliers often can (hundreds for the box that is
 * really there, a handful for the others). The candidate must reach ORB_HIGH_INLIERS AND
 * have at least twice the runner-up's evidence: we never choose between look-alikes by a
 * coin flip.
 */
export function pickVerified(
  inliersByGame: ReadonlyMap<string, number>,
): { gameId: string; inliers: number } | null {
  const sorted = [...inliersByGame.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const best = sorted[0];
  if (!best || best[1] < ORB_HIGH_INLIERS) return null;
  const second = sorted[1]?.[1] ?? 0;
  if (best[1] < LEAD_RATIO * second || best[1] === second) return null;
  return { gameId: best[0], inliers: best[1] };
}

/** A lock from ONE frame (the single-photo path): similar enough and clearly ahead. */
export function singleFrameLock(ranked: Ranked[]): Lock | null {
  const top = ranked[0];
  if (!top || top.score < LOCK_MIN_SIMILARITY) return null;
  const margin = ranked[1] ? top.score - ranked[1].score : 1;
  if (margin < LOCK_MIN_MARGIN) return null;
  return { gameId: top.gameId, similarity: top.score, margin, votes: 1 };
}

export type Decision = {
  gameId: string;
  level: Level;
  similarity: number;
  margin: number;
  /** ORB inliers of the chosen game, when it was verified. */
  orbInliers: number;
  /** What decided it. */
  via: "barcode" | "orb" | "clip";
};

/**
 * Priority: a learned barcode > strong ORB verification > a stable CLIP lock. Null when
 * none applies: then the honest answer is "not sure".
 */
export function decide(input: {
  ranked: Ranked[];
  /** ORB inliers per candidate game that was verified this time. */
  orb: ReadonlyMap<string, number>;
  /** The voter's lock (or `singleFrameLock` for one photo). */
  lock: Lock | null;
  /** The game of a barcode the user taught the app, if one was read. */
  barcodeGameId?: string | null;
}): Decision | null {
  const { ranked, orb, lock, barcodeGameId } = input;
  const scoreOf = (gameId: string) =>
    ranked.find((r) => r.gameId === gameId)?.score ?? 0;
  const marginOf = (gameId: string) => {
    const i = ranked.findIndex((r) => r.gameId === gameId);
    if (i !== 0) return 0;
    return ranked[1] ? ranked[0].score - ranked[1].score : 1;
  };

  if (barcodeGameId)
    return {
      gameId: barcodeGameId,
      level: levelFor({
        similarity: scoreOf(barcodeGameId),
        margin: marginOf(barcodeGameId),
        learnedBarcode: true,
      }),
      similarity: scoreOf(barcodeGameId),
      margin: marginOf(barcodeGameId),
      orbInliers: orb.get(barcodeGameId) ?? 0,
      via: "barcode",
    };

  const verified = pickVerified(orb);
  if (verified)
    return {
      gameId: verified.gameId,
      level: levelFor({
        similarity: scoreOf(verified.gameId),
        margin: marginOf(verified.gameId),
        orbInliers: verified.inliers,
      }),
      similarity: scoreOf(verified.gameId),
      margin: marginOf(verified.gameId),
      orbInliers: verified.inliers,
      via: "orb",
    };

  if (lock) {
    const inliers = orb.get(lock.gameId) ?? 0;
    // Same rule as pickVerified: ORB evidence only counts toward "high" when it is clearly
    // ahead of every other verified candidate (two editions or reprints look alike).
    const outshone = [...orb.entries()].some(
      ([id, n]) => id !== lock.gameId && LEAD_RATIO * n > inliers,
    );
    return {
      gameId: lock.gameId,
      level: levelFor({
        similarity: lock.similarity,
        margin: lock.margin,
        orbInliers: outshone ? 0 : inliers,
      }),
      similarity: lock.similarity,
      margin: lock.margin,
      orbInliers: inliers,
      via: "clip",
    };
  }
  return null;
}
