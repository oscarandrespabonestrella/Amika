import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ScoreValue } from "@/features/scoring/engine/evaluate";
import {
  categoryAverages,
  type BreakdownPlay,
  type CategoryBreakdown,
} from "../category-breakdown";
import type { PlayerStat, SeriesPoint } from "../format";
import {
  gameStatRow,
  gameSummaryRow,
  overviewRow,
  rivalRow,
  seriesRow,
  topGameRow,
} from "../schemas";

export type GameSummary = {
  plays: number;
  avgDurationMinutes: number | null;
  firstPlayedOn: string | null;
  lastPlayedOn: string | null;
};

export type GameStats = {
  summary: GameSummary;
  players: PlayerStat[];
  series: SeriesPoint[];
};

export type MyOverview = {
  mePlayerId: string | null;
  plays: number;
  scoredPlays: number;
  wins: number;
  gamesPlayed: number;
};

export type TopGame = {
  gameId: string;
  name: string;
  plays: number;
  wins: number;
};

export type Rival = {
  playerId: string;
  name: string;
  playsTogether: number;
  myWins: number;
  theirWins: number;
  ties: number;
};

export type MyStats = {
  overview: MyOverview;
  topGames: TopGame[];
  rivals: Rival[];
};

const EMPTY_SUMMARY: GameSummary = {
  plays: 0,
  avgDurationMinutes: null,
  firstPlayedOn: null,
  lastPlayedOn: null,
};

/** Numbers for one game, from the viewer's own matches only (RLS). Bad id: empty. */
export async function getGameStats(gameId: string): Promise<GameStats> {
  if (!z.uuid().safeParse(gameId).success)
    return { summary: EMPTY_SUMMARY, players: [], series: [] };

  const db = createSupabaseServerClient();
  const [stats, summary, series] = await Promise.all([
    db.rpc("game_stats", { p_game_id: gameId }),
    db.rpc("game_summary", { p_game_id: gameId }),
    db.rpc("game_score_series", { p_game_id: gameId }),
  ]);
  if (stats.error) throw stats.error;
  if (summary.error) throw summary.error;
  if (series.error) throw series.error;

  const s = gameSummaryRow.parse(
    summary.data?.[0] ?? {
      plays: 0,
      avg_duration_minutes: null,
      first_played_on: null,
      last_played_on: null,
    },
  );
  return {
    summary: {
      plays: s.plays,
      avgDurationMinutes: s.avg_duration_minutes,
      firstPlayedOn: s.first_played_on,
      lastPlayedOn: s.last_played_on,
    },
    players: z
      .array(gameStatRow)
      .parse(stats.data ?? [])
      .map((r) => ({
        playerId: r.player_id,
        name: r.name,
        plays: r.plays,
        scoredPlays: r.scored_plays,
        wins: r.wins,
        avgScore: r.avg_score,
        bestScore: r.best_score,
      })),
    series: z
      .array(seriesRow)
      .parse(series.data ?? [])
      .map((r) => ({
        playId: r.play_id,
        seq: r.seq,
        playedOn: r.played_on,
        playerId: r.player_id,
        name: r.name,
        total: r.total,
      })),
  };
}

/** The viewer's record as their "me" player, most-played games and head-to-head. */
export async function getMyStats(): Promise<MyStats> {
  const db = createSupabaseServerClient();
  const [overview, top, rivals] = await Promise.all([
    db.rpc("my_overview"),
    db.rpc("my_top_games"),
    db.rpc("head_to_head"),
  ]);
  if (overview.error) throw overview.error;
  if (top.error) throw top.error;
  if (rivals.error) throw rivals.error;

  const o = overviewRow.parse(
    overview.data?.[0] ?? {
      me_player_id: null,
      plays: 0,
      scored_plays: 0,
      wins: 0,
      games_played: 0,
    },
  );
  return {
    overview: {
      mePlayerId: o.me_player_id,
      plays: o.plays,
      scoredPlays: o.scored_plays,
      wins: o.wins,
      gamesPlayed: o.games_played,
    },
    topGames: z
      .array(topGameRow)
      .parse(top.data ?? [])
      .map((r) => ({
        gameId: r.game_id,
        name: r.name,
        plays: r.plays,
        wins: r.wins,
      })),
    rivals: z
      .array(rivalRow)
      .parse(rivals.data ?? [])
      .map((r) => ({
        playerId: r.player_id,
        name: r.name,
        playsTogether: r.plays_together,
        myWins: r.my_wins,
        theirWins: r.their_wins,
        ties: r.ties,
      })),
  };
}

const CATEGORY_MATCH_LIMIT = 200;

export type GameCategoryStats = CategoryBreakdown & {
  sheetTitle: string;
  version: number;
};

/**
 * Average points per category for the matches of a game that used a score sheet (the
 * latest 200). Null when none did, or when the stored definition is invalid.
 */
export async function getGameCategoryStats(
  gameId: string,
): Promise<GameCategoryStats | null> {
  if (!z.uuid().safeParse(gameId).success) return null;
  const { data, error } = await createSupabaseServerClient()
    .from("plays")
    .select(
      "played_on, scoring_version_id, scoring_sheet_versions(version, definition, scoring_sheets(title)), play_participants(player_id, total_score, players(name), play_scores(category_key, value))",
    )
    .eq("game_id", gameId)
    .not("scoring_version_id", "is", null)
    .order("played_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(CATEGORY_MATCH_LIMIT);
  if (error) throw error;

  const versions = new Map<string, { title: string; version: number }>();
  const plays: BreakdownPlay[] = (data ?? []).flatMap((row) => {
    const version = row.scoring_sheet_versions;
    if (!row.scoring_version_id || !version) return [];
    versions.set(row.scoring_version_id, {
      title: version.scoring_sheets?.title ?? "",
      version: version.version,
    });
    return [
      {
        versionId: row.scoring_version_id,
        playedOn: row.played_on,
        definition: version.definition,
        participants: row.play_participants.map((p) => ({
          playerId: p.player_id,
          name: p.players?.name ?? "",
          total: p.total_score,
          values: Object.fromEntries(
            p.play_scores.map((s) => [s.category_key, s.value as ScoreValue]),
          ),
        })),
      },
    ];
  });

  const result = categoryAverages(plays);
  if (!result) return null;
  const meta = versions.get(result.versionId);
  return {
    ...result,
    sheetTitle: meta?.title ?? "",
    version: meta?.version ?? 0,
  };
}
