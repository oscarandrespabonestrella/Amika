// Pure. Geometric verification settles what the picture model leaves ambiguous: when CLIP
// cannot tell two covers apart (a tiny lead), ORB inliers often can (hundreds for the box
// that is really there, a handful for the others).
import { ORB_HIGH_INLIERS } from "./thresholds";

/** A leader must have at least this many times the evidence of the runner-up. */
const LEAD_RATIO = 2;

/**
 * The candidate whose ORB evidence is strong (>= ORB_HIGH_INLIERS) AND clearly ahead of the
 * rest (at least twice the runner-up). Null when nothing is verified or two candidates are
 * comparably strong: we never choose between look-alikes by a coin flip.
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
