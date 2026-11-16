// Pure: safe for the browser and the server. No React, no Supabase.

export type PlayerStat = {
  playerId: string;
  name: string;
  plays: number;
  scoredPlays: number;
  wins: number;
  avgScore: number | null;
  bestScore: number | null;
};

export type SeriesPoint = {
  playId: string;
  /** 1..N over the (latest) matches of the game, chronological. */
  seq: number;
  playedOn: string;
  playerId: string;
  name: string;
  total: number;
};

export type SeriesRow = {
  seq: number;
  playedOn: string;
  [playerId: string]: number | string | null;
};

/** Wins over matches where the player had a recorded score; null when there are none. */
export function winRate(wins: number, scoredPlays: number): number | null {
  return scoredPlays > 0 ? wins / scoredPlays : null;
}

/**
 * The players a chart draws as separate series: the `max` most frequent ones (ties by
 * name, then id, so the choice is stable). The rest only appear in the table: a sixth
 * categorical color is never invented.
 */
export function topSeriesPlayers(players: PlayerStat[], max = 5): string[] {
  return [...players]
    .sort(
      (a, b) =>
        b.plays - a.plays ||
        a.name.localeCompare(b.name) ||
        a.playerId.localeCompare(b.playerId),
    )
    .slice(0, max)
    .map((p) => p.playerId);
}

/**
 * One row per match number (kept even when none of the listed players scored in it, so
 * the axis has no hole), with `null` where a listed player has no score: lines then show
 * a gap, never a fake zero.
 */
export function pivotSeries(
  points: SeriesPoint[],
  playerIds: string[],
): SeriesRow[] {
  const rows = new Map<number, SeriesRow>();
  for (const p of points) {
    let row = rows.get(p.seq);
    if (!row) {
      row = { seq: p.seq, playedOn: p.playedOn };
      for (const id of playerIds) row[id] = null;
      rows.set(p.seq, row);
    }
    if (playerIds.includes(p.playerId)) row[p.playerId] = p.total;
  }
  return [...rows.values()].sort((a, b) => a.seq - b.seq);
}
