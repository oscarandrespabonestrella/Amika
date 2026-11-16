import "server-only";
import {
  getGameSource,
  searchExternalGames,
  searchLocalGames,
} from "@/features/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapRecognitionError, type RecognitionError } from "../errors";
import type { IdentifyDeps } from "../identify";

/** Everything here runs as the signed-in user: RLS decides what each query can see. */
export function createRecognitionDeps(userId: string): IdentifyDeps {
  const db = createSupabaseServerClient();
  return {
    async findBarcode(gtin) {
      const { data, error } = await db
        .from("game_barcodes")
        .select("game_id, games(name)")
        .eq("gtin", gtin)
        .maybeSingle();
      if (error) throw error;
      if (!data?.games) return null;
      return { gameId: data.game_id, name: data.games.name };
    },

    async searchLocal(line) {
      const hits = await searchLocalGames({ q: line });
      return hits.map((g) => ({ id: g.id, name: g.name }));
    },

    async searchExternal(line) {
      // The BGG search needs at least two characters.
      if (line.trim().length < 2) return { ok: true, hits: [] };
      const result = await searchExternalGames(getGameSource(), line, userId);
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        hits: result.hits.map((h) => ({
          externalId: h.externalId,
          name: h.name,
          gameId: h.gameId,
        })),
      };
    },
  };
}

export type WriteResult = { ok: true } | { ok: false; error: RecognitionError };

/** A known error code becomes a result; anything else is unexpected and rethrown. */
function failed(error: { code?: string }): WriteResult {
  const mapped = mapRecognitionError(error.code);
  if (!mapped) throw error;
  return { ok: false, error: mapped };
}

/**
 * Teaches the app that this barcode is this game (private to the user). Running it
 * again with another game re-points the code.
 */
export async function learnBarcode(
  gtin: string,
  gameId: string,
): Promise<WriteResult> {
  const db = createSupabaseServerClient();
  const inserted = await db
    .from("game_barcodes")
    .insert({ gtin, game_id: gameId });
  if (!inserted.error) return { ok: true };
  if (inserted.error.code !== "23505") return failed(inserted.error);

  // Already known: only the game can change (column grants), so update, never upsert.
  const updated = await db
    .from("game_barcodes")
    .update({ game_id: gameId })
    .eq("gtin", gtin);
  return updated.error ? failed(updated.error) : { ok: true };
}

export type RecognitionGame = { id: string; name: string; coverUrl: string };

/** Catalog games with a cover that the user can see (RLS), for building reference vectors. */
export async function listCoverGames(limit = 300): Promise<RecognitionGame[]> {
  const { data, error } = await createSupabaseServerClient()
    .from("games")
    .select("id, name, cover_url")
    .not("cover_url", "is", null)
    .order("name")
    .limit(limit);
  if (error) throw error;
  return (data ?? []).flatMap((g) =>
    g.cover_url ? [{ id: g.id, name: g.name, coverUrl: g.cover_url }] : [],
  );
}
