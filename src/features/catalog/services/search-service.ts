import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SearchParams } from "../schemas";
import type { GameKind, GameSummary } from "../types";

const LIMIT = 30;

/** Accent-insensitive search over what the user can see (RLS applies). */
export async function searchLocalGames(
  params: SearchParams,
): Promise<GameSummary[]> {
  const { data, error } = await createSupabaseServerClient().rpc(
    "search_games",
    {
      q: params.q || undefined,
      p_kind: params.kind,
      p_players: params.players,
      p_max_minutes: params.time,
      p_limit: LIMIT,
    },
  );
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as GameKind,
    yearPublished: row.year_published,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    minPlaytime: row.min_playtime,
    maxPlaytime: row.max_playtime,
    coverUrl: row.cover_url,
    isCustom: row.source === "manual",
  }));
}
