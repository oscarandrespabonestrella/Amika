import { describe, expect, it, vi } from "vitest";
import type { PdfVerifier } from "../pdf-verifier";
import {
  WebSearchError,
  type WebSearchSource,
} from "../sources/web-search-source";
import type { GameIdentity, WebResult } from "../types";
import {
  createManualSearchService,
  type CachedSearch,
} from "./manual-search-service";

const game: GameIdentity = {
  id: "game-1",
  name: "Catan",
  altNames: [],
  year: 1995,
  publishers: ["Devir"],
  relatedNames: [],
  isExpansion: false,
};

const hit = (url: string, title = "Catan reglamento"): WebResult => ({
  url,
  title,
  description: "",
  language: null,
});

const source = (search: WebSearchSource["search"]): WebSearchSource => ({
  id: "fake",
  isConfigured: () => true,
  search,
});

const okVerifier: PdfVerifier = {
  verify: async (url) => ({ ok: true, finalUrl: url, sizeBytes: 1234 }),
};
const noKnown = { knownUrls: async () => ({ added: [], proposed: [] }) };

const T0 = Date.parse("2026-11-18T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function memoryCache(initial?: CachedSearch) {
  let entry = initial ?? null;
  return {
    get: vi.fn(async () => entry),
    put: vi.fn(async (_id: string, e: CachedSearch) => {
      entry = e;
    }),
    peek: () => entry,
  };
}

const liveSource = () =>
  vi.fn(async () => [hit("https://a.example/catan-reglamento.pdf")]);

describe("ManualSearchService: shared cache and quota guard", () => {
  it("a miss searches once and stores results without per-user data; a repeat costs nothing", async () => {
    const cache = memoryCache();
    const search = liveSource();
    const guard = vi.fn(async () => null);
    const service = createManualSearchService({
      source: source(search),
      verifier: okVerifier,
      store: noKnown,
      cache,
      guard,
      signLink: () => "tok",
      now: () => T0,
    });

    expect((await service.search(game)).ok).toBe(true);
    expect(search).toHaveBeenCalledTimes(5);
    expect(guard).toHaveBeenCalledWith(5);

    const stored = cache.peek();
    expect(stored?.outcome).toBe("results");
    const row = (stored as Extract<CachedSearch, { outcome: "results" }>)
      .results[0];
    expect(row).not.toHaveProperty("downloadToken");
    expect(row).not.toHaveProperty("alreadyAdded");

    search.mockClear();
    guard.mockClear();
    expect((await service.search(game)).ok).toBe(true);
    expect(search).not.toHaveBeenCalled(); // no API call
    expect(guard).not.toHaveBeenCalled(); // and nobody's quota is used
  });

  it("a cache hit is still personalized: flags and a fresh signed link per asker", async () => {
    const cache = memoryCache({
      outcome: "results",
      createdAt: new Date(T0).toISOString(),
      results: [
        {
          url: "https://a.example/catan-reglamento.pdf",
          title: "Catan reglamento",
          locale: "es",
          publisher: null,
          sourceHost: "a.example",
          isOfficial: false,
          sizeBytes: 10,
        },
      ],
    });
    const search = vi.fn(async () => []);
    const service = createManualSearchService({
      source: source(search),
      verifier: okVerifier,
      store: {
        knownUrls: async () => ({
          added: ["https://a.example/catan-reglamento.pdf"],
          proposed: [],
        }),
      },
      cache,
      signLink: ({ url }) => `tok:${url}`,
      now: () => T0 + DAY,
    });
    const out = await service.search(game);
    if (!out.ok) throw new Error("expected ok");
    expect(out.results[0]).toMatchObject({
      alreadyAdded: true,
      downloadToken: "tok:https://a.example/catan-reglamento.pdf",
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("results last 14 days, a 'nothing found' only 3", async () => {
    const results: CachedSearch = {
      outcome: "results",
      createdAt: new Date(T0).toISOString(),
      results: [],
    };
    const notFound: CachedSearch = {
      outcome: "not_found",
      createdAt: new Date(T0).toISOString(),
    };
    const searchedAgain = async (entry: CachedSearch, daysLater: number) => {
      const search = liveSource();
      await createManualSearchService({
        source: source(search),
        verifier: okVerifier,
        store: noKnown,
        cache: memoryCache(entry),
        now: () => T0 + daysLater * DAY,
      }).search(game);
      return search.mock.calls.length > 0;
    };
    expect(await searchedAgain(results, 13)).toBe(false);
    expect(await searchedAgain(results, 15)).toBe(true);
    expect(await searchedAgain(notFound, 2)).toBe(false);
    expect(await searchedAgain(notFound, 4)).toBe(true);
  });

  it("remembers 'nothing found' when the engine had nothing about the game", async () => {
    const cache = memoryCache();
    const service = createManualSearchService({
      source: source(async () => [
        hit("https://a.example/azul.pdf", "Azul reglamento"),
      ]),
      verifier: okVerifier,
      store: noKnown,
      cache,
      now: () => T0,
    });
    expect(await service.search(game)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(cache.peek()?.outcome).toBe("not_found");
  });

  it("does not cache failures, nor a search whose links all failed verification", async () => {
    const failing = memoryCache();
    await createManualSearchService({
      source: source(async () => {
        throw new WebSearchError("upstream");
      }),
      verifier: okVerifier,
      store: noKnown,
      cache: failing,
    }).search(game);
    expect(failing.put).not.toHaveBeenCalled();

    const deadLinks = memoryCache();
    await createManualSearchService({
      source: source(liveSource()),
      verifier: { verify: async () => ({ ok: false, reason: "timeout" }) },
      store: noKnown,
      cache: deadLinks,
    }).search(game);
    expect(deadLinks.put).not.toHaveBeenCalled();
  });

  it("the guard can stop a live search before any API call is made", async () => {
    const search = liveSource();
    const cache = memoryCache();
    for (const error of ["rate_limited", "quota_exhausted"] as const) {
      const out = await createManualSearchService({
        source: source(search),
        verifier: okVerifier,
        store: noKnown,
        cache,
        guard: async () => error,
      }).search(game);
      expect(out).toEqual({ ok: false, error });
    }
    expect(search).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("a broken cache never breaks the search", async () => {
    const cache = {
      get: async (): Promise<CachedSearch | null> => {
        throw new Error("db down");
      },
      put: async (): Promise<void> => {
        throw new Error("db down");
      },
    };
    const out = await createManualSearchService({
      source: source(liveSource()),
      verifier: okVerifier,
      store: noKnown,
      cache,
    }).search(game);
    expect(out.ok).toBe(true);
  });
});
