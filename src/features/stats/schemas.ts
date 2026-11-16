import { z } from "zod";

/** Postgres `numeric` can arrive as a JSON number or a string: both become a number. */
const numeric = z.union([z.number(), z.string().transform(Number)]);
const int = z.number().int();

export const gameStatRow = z.object({
  player_id: z.uuid(),
  name: z.string(),
  plays: int,
  scored_plays: int,
  wins: int,
  avg_score: numeric.nullable(),
  best_score: int.nullable(),
});

export const gameSummaryRow = z.object({
  plays: int,
  avg_duration_minutes: numeric.nullable(),
  first_played_on: z.string().nullable(),
  last_played_on: z.string().nullable(),
});

export const seriesRow = z.object({
  play_id: z.uuid(),
  seq: int,
  played_on: z.string(),
  player_id: z.uuid(),
  name: z.string(),
  total: int,
});

export const overviewRow = z.object({
  me_player_id: z.uuid().nullable(),
  plays: int,
  scored_plays: int,
  wins: int,
  games_played: int,
});

export const topGameRow = z.object({
  game_id: z.uuid(),
  name: z.string(),
  plays: int,
  wins: int,
});

export const rivalRow = z.object({
  player_id: z.uuid(),
  name: z.string(),
  plays_together: int,
  my_wins: int,
  their_wins: int,
  ties: int,
});
