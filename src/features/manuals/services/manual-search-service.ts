import type { PdfVerifier } from "../pdf-verifier";
import { buildQueries } from "../query";
import { rankCandidates, type Candidate } from "../rank";
import {
  WebSearchError,
  type WebSearchSource,
} from "../sources/web-search-source";
import type {
  CachedResult,
  GameIdentity,
  ManualResult,
  ManualSearchError,
  ManualSearchOutcome,
} from "../types";
import { normalizeManualUrl } from "../url-safety";

/** What the service needs to know about manuals the game already has. */
export interface KnownManuals {
  knownUrls(gameId: string): Promise<{ added: string[]; proposed: string[] }>;
}

/** The shared, per-game record of a finished search (nothing that depends on the user). */
export type CachedSearch =
  | { outcome: "results"; results: CachedResult[]; createdAt: string }
  | { outcome: "not_found"; createdAt: string };

export interface SearchCache {
  get(gameId: string): Promise<CachedSearch | null>;
  put(gameId: string, entry: CachedSearch): Promise<void>;
}

export type ManualSearchDeps = {
  source: WebSearchSource;
  verifier: PdfVerifier;
  store: KnownManuals;
  /** Shared cache: the same game is searched on the web once per TTL, whoever asks. */
  cache?: SearchCache;
  /**
   * Called ONLY when a live search is about to spend `calls` API calls (never on a cache hit).
   * Return an error to stop it (user limit, monthly cap); otherwise record the usage and return
   * null.
   */
  guard?: (calls: number) => Promise<ManualSearchError | null>;
  /** Signs the download link of a result; null/absent when no secret is configured. */
  signLink?: (link: { url: string; gameId: string }) => string | null;
  /** How many ranked candidates are checked (each costs one request). */
  verifyTop?: number;
  /** How many verified results are returned. */
  maxResults?: number;
  now?: () => number;
  /** How long a search with results stays valid (links die slowly). */
  resultsTtlMs?: number;
  /** How long "nothing found" stays valid (shorter: new manuals appear). */
  notFoundTtlMs?: number;
};

const RESULTS_PER_QUERY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
export const RESULTS_TTL_MS = 14 * DAY_MS;
export const NOT_FOUND_TTL_MS = 3 * DAY_MS;

function toError(error: unknown): ManualSearchError {
  if (error instanceof WebSearchError) {
    if (error.code === "not_configured" || error.code === "unauthorized")
      return "unavailable";
    if (error.code === "rate_limited") return "rate_limited";
  }
  return "failed";
}

/**
 * Finds rulebook PDFs for a game: search the web in es, en, fr and de (and the publisher's own
 * site), keep what is really about THIS game, verify that each link serves a PDF, and say which
 * ones the game already has. A finished search is cached per game, so the paid API is called
 * once per game per TTL. It never downloads or stores a document and never throws.
 */
export function createManualSearchService(deps: ManualSearchDeps) {
  const { source, verifier, store, cache, guard, signLink } = deps;
  const verifyTop = deps.verifyTop ?? 10;
  const maxResults = deps.maxResults ?? 8;
  const now = deps.now ?? Date.now;
  const resultsTtl = deps.resultsTtlMs ?? RESULTS_TTL_MS;
  const notFoundTtl = deps.notFoundTtlMs ?? NOT_FOUND_TTL_MS;

  /** A cache problem is a miss, never an error for the user. */
  async function readCache(gameId: string): Promise<CachedSearch | null> {
    try {
      const hit = await cache?.get(gameId);
      if (!hit) return null;
      const age = now() - new Date(hit.createdAt).getTime();
      const ttl = hit.outcome === "results" ? resultsTtl : notFoundTtl;
      return age >= 0 && age < ttl ? hit : null;
    } catch {
      return null;
    }
  }

  async function writeCache(gameId: string, entry: CachedSearch) {
    try {
      await cache?.put(gameId, entry);
    } catch {
      // the search itself worked; failing to remember it must not fail it
    }
  }

  /** Per-user parts (flags, signed links) are added on every answer, cached or not. */
  async function personalize(
    game: GameIdentity,
    results: CachedResult[],
  ): Promise<ManualResult[]> {
    const known = await store.knownUrls(game.id);
    const added = new Set(known.added.map(normalizeManualUrl));
    const proposed = new Set(known.proposed.map(normalizeManualUrl));
    return results.slice(0, maxResults).map((r) => ({
      ...r,
      alreadyAdded: added.has(r.url),
      alreadyProposed: proposed.has(r.url),
      downloadToken: signLink?.({ url: r.url, gameId: game.id }) ?? null,
    }));
  }

  return {
    isAvailable: () => source.isConfigured(),

    async search(game: GameIdentity): Promise<ManualSearchOutcome> {
      if (!source.isConfigured()) return { ok: false, error: "unavailable" };

      try {
        const cached = await readCache(game.id);
        if (cached)
          return cached.outcome === "not_found"
            ? { ok: false, error: "not_found" }
            : { ok: true, results: await personalize(game, cached.results) };

        const queries = buildQueries(game);
        const blocked = await guard?.(queries.length);
        if (blocked) return { ok: false, error: blocked };

        const settled = await Promise.allSettled(
          queries.map((query) =>
            source.search(query.q, {
              lang: query.lang,
              country: query.country,
              count: RESULTS_PER_QUERY,
            }),
          ),
        );

        const candidates: Candidate[] = [];
        settled.forEach((result, i) => {
          if (result.status === "fulfilled")
            for (const hit of result.value)
              candidates.push({ ...hit, queryLocale: queries[i].locale });
        });

        const rejected = settled.filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (rejected.length === settled.length)
          return { ok: false, error: toError(rejected[0].reason) };

        const ranked = rankCandidates(candidates, game).slice(0, verifyTop);
        if (ranked.length === 0) {
          // the engine found nothing about this game: worth remembering
          await writeCache(game.id, {
            outcome: "not_found",
            createdAt: new Date(now()).toISOString(),
          });
          return { ok: false, error: "not_found" };
        }

        const checks = await Promise.all(
          ranked.map((r) => verifier.verify(r.url)),
        );
        const verified: CachedResult[] = [];
        ranked.forEach((r, i) => {
          const check = checks[i];
          if (!check.ok) return; // dead link, HTML, too big, unsafe: never offered
          verified.push({
            url: r.url,
            title: r.title,
            locale: r.locale,
            publisher: r.publisher,
            sourceHost: r.host,
            isOfficial: r.isOfficial,
            sizeBytes: check.sizeBytes,
          });
        });

        // Candidates existed but none verified: possibly a passing network problem, so it is
        // not cached (the next search tries again).
        if (verified.length === 0) return { ok: false, error: "not_found" };

        await writeCache(game.id, {
          outcome: "results",
          results: verified.slice(0, maxResults),
          createdAt: new Date(now()).toISOString(),
        });
        return { ok: true, results: await personalize(game, verified) };
      } catch {
        return { ok: false, error: "failed" };
      }
    },
  };
}

export type ManualSearchService = ReturnType<typeof createManualSearchService>;
