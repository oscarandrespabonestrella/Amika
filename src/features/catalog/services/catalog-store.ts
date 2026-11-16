import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ExternalGame, ExternalSource } from "../types";
import type { Usage } from "./rate-limit";

/** Data access for importing (privileged: it writes the global catalog). */
export interface ImportStore {
  findGameId(
    source: ExternalSource,
    externalId: string,
  ): Promise<string | null>;
  findGameIds(
    source: ExternalSource,
    externalIds: string[],
  ): Promise<Map<string, string>>;
  getUsage(userId: string): Promise<Usage>;
  recordUsage(
    userId: string,
    source: string,
    externalId: string,
  ): Promise<void>;
  /** Atomic + idempotent. Throws an error with a Postgres `code` on failure. */
  upsertGame(game: ExternalGame): Promise<string>;
  /** Stores the 16-hex-char hash of a game's cover (Phase 7a). */
  saveCoverHash(gameId: string, hash: string): Promise<void>;
}

export function createSupabaseImportStore(): ImportStore {
  const admin = createSupabaseAdminClient();

  const countSince = async (userId: string, ms: number) => {
    const { count, error } = await admin
      .from("catalog_imports")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - ms).toISOString());
    if (error) throw error;
    return count ?? 0;
  };

  return {
    async findGameId(source, externalId) {
      const { data, error } = await admin
        .from("game_external_ids")
        .select("game_id")
        .eq("source", source)
        .eq("external_id", externalId)
        .maybeSingle();
      if (error) throw error;
      return data?.game_id ?? null;
    },

    async findGameIds(source, externalIds) {
      const { data, error } = await admin
        .from("game_external_ids")
        .select("game_id, external_id")
        .eq("source", source)
        .in("external_id", externalIds);
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.external_id, row.game_id]));
    },

    async getUsage(userId) {
      const [lastMinute, lastHour] = await Promise.all([
        countSince(userId, 60_000),
        countSince(userId, 3_600_000),
      ]);
      return { lastMinute, lastHour };
    },

    async recordUsage(userId, source, externalId) {
      const { error } = await admin.from("catalog_imports").insert({
        user_id: userId,
        source,
        external_id: externalId.slice(0, 40),
      });
      if (error) throw error;
    },

    async upsertGame(game) {
      const { data, error } = await admin.rpc("upsert_external_game", {
        p: game,
      });
      if (error) throw error;
      return data;
    },

    async saveCoverHash(gameId, hash) {
      const { error } = await admin.rpc("upsert_cover_hash", {
        p_game_id: gameId,
        p_hash: hash,
      });
      if (error) throw error;
    },
  };
}
