import "server-only";
import { logger } from "@/lib/logger";
import { BggError } from "../sources/bgg/errors";
import { externalGameSchema } from "../sources/external-game.schema";
import { MAX_BATCH, type GameSource } from "../sources/game-source";
import type { ExternalGame, ExternalSearchHit } from "../types";
import { createSupabaseImportStore, type ImportStore } from "./catalog-store";
import { isOverLimit } from "./rate-limit";

export type ImportError =
  | "unavailable" // source not configured (token pending) or token rejected
  | "rate_limited"
  | "not_found"
  | "failed";

export type ImportResult =
  { ok: true; gameId: string } | { ok: false; error: ImportError };

export type SearchHit = ExternalSearchHit & {
  /** Set when the game is already in our catalog. */
  gameId: string | null;
};

export type ExternalSearchResult =
  { ok: true; hits: SearchHit[] } | { ok: false; error: ImportError };

function toImportError(error: unknown): ImportError {
  if (error instanceof BggError) {
    switch (error.code) {
      case "not_configured":
        return "unavailable";
      case "rate_limited":
        return "rate_limited";
      case "not_found":
        return "not_found";
      case "unauthorized":
        // A rejected token is OUR configuration problem, not the user's.
        logger.error("external source rejected the API token", error);
        return "unavailable";
      default:
        logger.error("external source failed", error, { code: error.code });
        return "failed";
    }
  }
  logger.error("unexpected import failure", error);
  return "failed";
}

const UNIQUE_VIOLATION = "23505";

/** Search the external source (rate limited) and flag hits we already have. */
export async function searchExternalGames(
  source: GameSource,
  query: string,
  userId: string,
  store: ImportStore = createSupabaseImportStore(),
): Promise<ExternalSearchResult> {
  if (!source.isConfigured()) return { ok: false, error: "unavailable" };
  try {
    if (isOverLimit(await store.getUsage(userId))) {
      return { ok: false, error: "rate_limited" };
    }
    await store.recordUsage(userId, `${source.id}:search`, "-");

    const hits = await source.search(query);
    if (hits.length === 0) return { ok: true, hits: [] };

    const known = await store.findGameIds(
      source.id,
      hits.map((h) => h.externalId),
    );
    return {
      ok: true,
      hits: hits.map((h) => ({
        ...h,
        gameId: known.get(h.externalId) ?? null,
      })),
    };
  } catch (error) {
    return { ok: false, error: toImportError(error) };
  }
}

export type BatchImportResult =
  | {
      ok: true;
      /** externalId → catalog game id, for every id that is in the catalog now. */
      games: Map<string, string>;
      /** External ids the source did not return or that failed to import. */
      failed: string[];
    }
  | { ok: false; error: ImportError };

/**
 * Import up to MAX_BATCH games with ONE upstream call and ONE quota use. Games already in
 * the catalog cost nothing. Partial success is normal: see `failed`.
 */
export async function importExternalGames(
  source: GameSource,
  externalIds: string[],
  userId: string,
  store: ImportStore = createSupabaseImportStore(),
): Promise<BatchImportResult> {
  const ids = [...new Set(externalIds)];
  if (ids.length > MAX_BATCH) return { ok: false, error: "failed" };
  try {
    const games = await store.findGameIds(source.id, ids);
    const missing = ids.filter((id) => !games.has(id));
    if (missing.length === 0) return { ok: true, games, failed: [] };

    if (!source.isConfigured()) return { ok: false, error: "unavailable" };
    if (isOverLimit(await store.getUsage(userId))) {
      return { ok: false, error: "rate_limited" };
    }
    await store.recordUsage(
      userId,
      `${source.id}:batch`,
      String(missing.length),
    );

    const failed = new Set(missing);
    for (const raw of await source.fetchGames(missing)) {
      const parsed = externalGameSchema.safeParse(raw);
      if (!parsed.success || !failed.has(parsed.data.externalId)) {
        logger.error("external game failed validation", undefined, {
          source: source.id,
        });
        continue;
      }
      const gameId = await upsertOrFindRaced(source, parsed.data, store);
      games.set(parsed.data.externalId, gameId);
      failed.delete(parsed.data.externalId);
    }
    return { ok: true, games, failed: [...failed] };
  } catch (error) {
    return { ok: false, error: toImportError(error) };
  }
}

async function upsertOrFindRaced(
  source: GameSource,
  game: ExternalGame,
  store: ImportStore,
): Promise<string> {
  try {
    return await store.upsertGame(game);
  } catch (error) {
    // Two users imported the same game at once: the other transaction won.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      const raced = await store.findGameId(source.id, game.externalId);
      if (raced) return raced;
    }
    throw error;
  }
}

/** Import one game into the global catalog (idempotent; atomic in the database). */
export async function importExternalGame(
  source: GameSource,
  externalId: string,
  userId: string,
  store: ImportStore = createSupabaseImportStore(),
): Promise<ImportResult> {
  try {
    // Already imported: no external call and no quota used.
    const existing = await store.findGameId(source.id, externalId);
    if (existing) return { ok: true, gameId: existing };

    if (!source.isConfigured()) return { ok: false, error: "unavailable" };
    if (isOverLimit(await store.getUsage(userId))) {
      return { ok: false, error: "rate_limited" };
    }
    await store.recordUsage(userId, source.id, externalId);

    const parsed = externalGameSchema.safeParse(
      await source.fetchGame(externalId),
    );
    if (!parsed.success) {
      logger.error("external game failed validation", undefined, {
        source: source.id,
      });
      return { ok: false, error: "failed" };
    }

    try {
      const gameId = await store.upsertGame(parsed.data);
      return { ok: true, gameId };
    } catch (error) {
      // Two users imported the same game at once: the other transaction won.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        const raced = await store.findGameId(source.id, externalId);
        if (raced) return { ok: true, gameId: raced };
      }
      throw error;
    }
  } catch (error) {
    return { ok: false, error: toImportError(error) };
  }
}
