export type Candidate = {
  gameId: string;
  name: string;
  coverUrl: string | null;
  isCustom: boolean;
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlaytime: number | null;
  maxPlaytime: number | null;
  isFavorite: boolean;
  rating: number | null;
  playCount: number;
  lastPlayedOn: string | null;
};

export type Reason =
  | { key: "neverPlayed" }
  | { key: "notPlayedFor"; months: number }
  | { key: "favorite" }
  | { key: "highlyRated" }
  | { key: "fitsPlayers"; players: number };

export type Ranked = Candidate & { score: number; reasons: Reason[] };

const NEVER_PLAYED_SCORE = 3;
const RECENCY_MAX_SCORE = 3;
const RECENCY_SATURATION_DAYS = 180;
const FAVORITE_SCORE = 2;
const RATING_WEIGHT = 0.3;
const RATING_NEUTRAL = 5;
const NOT_PLAYED_FOR_DAYS = 60;
const HIGHLY_RATED_MIN = 8;
const DEFAULT_LIMIT = 5;
const MS_PER_DAY = 86_400_000;

/** Whole days from `from` to `to` (both `YYYY-MM-DD`), computed in UTC. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY,
  );
}

/**
 * Ranks candidates for the night's selector: never-played games first, then the
 * longest unplayed ones, favorites and highly rated games get a boost. Pure: the
 * `players` filter is applied by the SQL, so it only adds a reason here.
 */
export function rankCandidates(
  c: readonly Candidate[],
  opts: { today: string; players?: number; limit?: number },
): Ranked[] {
  const ranked = c.map((candidate): Ranked => {
    const reasons: Reason[] = [];
    let score = 0;
    const { lastPlayedOn } = candidate;
    if (lastPlayedOn === null) {
      score += NEVER_PLAYED_SCORE;
      reasons.push({ key: "neverPlayed" });
    } else {
      const days = Math.max(0, daysBetween(lastPlayedOn, opts.today));
      score +=
        (Math.min(days, RECENCY_SATURATION_DAYS) / RECENCY_SATURATION_DAYS) *
        RECENCY_MAX_SCORE;
      if (days >= NOT_PLAYED_FOR_DAYS) {
        reasons.push({
          key: "notPlayedFor",
          months: Math.floor(days / 30),
        });
      }
    }
    if (candidate.isFavorite) {
      score += FAVORITE_SCORE;
      reasons.push({ key: "favorite" });
    }
    if (candidate.rating !== null) {
      score += (candidate.rating - RATING_NEUTRAL) * RATING_WEIGHT;
      if (candidate.rating >= HIGHLY_RATED_MIN) {
        reasons.push({ key: "highlyRated" });
      }
    }
    if (opts.players !== undefined) {
      reasons.push({ key: "fitsPlayers", players: opts.players });
    }
    return { ...candidate, score, reasons };
  });

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return ranked.slice(0, opts.limit ?? DEFAULT_LIMIT);
}

/**
 * Picks one id at random, weighted by `score / maxScore + votes` (or `1 + votes`
 * when no score is positive). `random` returns a value in [0, 1).
 */
export function spin(
  items: readonly { id: string; score: number; votes: number }[],
  random: () => number,
): string | null {
  if (items.length === 0) return null;
  const maxScore = Math.max(...items.map((i) => i.score));
  const weights = items.map((i) =>
    maxScore > 0 ? Math.max(0, i.score / maxScore) + i.votes : 1 + i.votes,
  );
  const total = weights.reduce((sum, w) => sum + w, 0);
  const target = random() * total;
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (target < cumulative) return items[i].id;
  }
  return items[items.length - 1].id;
}
