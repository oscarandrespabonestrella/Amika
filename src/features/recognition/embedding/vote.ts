// Pure. Smooths the per-frame ranking so a single lucky or blurry frame never decides:
// a candidate is "locked" only when it keeps winning over the last frames AND leads the
// runner-up by a clear margin.
import type { Ranked } from "./rank";
import {
  LOCK_MIN_MARGIN,
  LOCK_MIN_SIMILARITY,
  VOTE_MIN,
  VOTE_WINDOW,
} from "./thresholds";

export type Lock = {
  gameId: string;
  /** Mean similarity of the frames that voted for it. */
  similarity: number;
  /** Mean lead over the runner-up of those frames (1 when there was no runner-up). */
  margin: number;
  votes: number;
};

type Vote = { gameId: string; similarity: number; margin: number } | null;

export function createVoter(
  opts: {
    window?: number;
    minVotes?: number;
    minSimilarity?: number;
    minMargin?: number;
  } = {},
) {
  const window = opts.window ?? VOTE_WINDOW;
  const minVotes = opts.minVotes ?? VOTE_MIN;
  const minSimilarity = opts.minSimilarity ?? LOCK_MIN_SIMILARITY;
  const minMargin = opts.minMargin ?? LOCK_MIN_MARGIN;
  let history: Vote[] = [];

  return {
    push(ranked: Ranked[]): Lock | null {
      const top = ranked[0];
      history.push(
        top && top.score >= minSimilarity
          ? {
              gameId: top.gameId,
              similarity: top.score,
              margin: ranked[1] ? top.score - ranked[1].score : 1,
            }
          : null,
      );
      if (history.length > window) history = history.slice(-window);

      const tally = new Map<string, Exclude<Vote, null>[]>();
      for (const v of history)
        if (v) tally.set(v.gameId, [...(tally.get(v.gameId) ?? []), v]);

      const most = Math.max(0, ...[...tally.values()].map((v) => v.length));
      if (most < minVotes) return null;
      const leaders = [...tally.entries()].filter(([, v]) => v.length === most);
      if (leaders.length !== 1) return null; // an exact tie decides nothing

      const [gameId, votes] = leaders[0];
      const mean = (pick: (v: (typeof votes)[number]) => number) =>
        votes.reduce((s, v) => s + pick(v), 0) / votes.length;
      const margin = mean((v) => v.margin);
      if (margin < minMargin) return null;
      return {
        gameId,
        similarity: mean((v) => v.similarity),
        margin,
        votes: votes.length,
      };
    },
    reset() {
      history = [];
    },
  };
}
