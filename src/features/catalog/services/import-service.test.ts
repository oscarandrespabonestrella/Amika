import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { BggError } from "../sources/bgg/errors";
import type { GameSource } from "../sources/game-source";
import type { ExternalGame, ExternalSearchHit } from "../types";
import type { ImportStore } from "./catalog-store";
import { importExternalGame, searchExternalGames } from "./import-service";
import { isOverLimit, LIMITS } from "./rate-limit";

const GAME: ExternalGame = {
  source: "bgg",
  externalId: "13",
  language: "en",
  kind: "base",
  name: "CATAN",
  originalName: null,
  description: "d",
  yearPublished: 1995,
  minPlayers: 3,
  maxPlayers: 4,
  minPlaytime: 60,
  maxPlaytime: 120,
  minAge: 10,
  coverUrl: "https://example.com/c.jpg",
  terms: [],
  relations: [],
};
const HIT: ExternalSearchHit = {
  source: "bgg",
  externalId: "13",
  name: "CATAN",
  kind: "base",
  yearPublished: 1995,
};

function fakeSource(over: Partial<GameSource> = {}): GameSource & {
  fetchGame: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
} {
  return {
    id: "bgg",
    isConfigured: () => true,
    search: vi.fn(async () => [HIT]),
    fetchGame: vi.fn(async () => GAME),
    ...over,
  } as never;
}

function fakeStore(
  over: Partial<ImportStore> = {},
): ImportStore & Record<keyof ImportStore, ReturnType<typeof vi.fn>> {
  return {
    findGameId: vi.fn(async () => null),
    findGameIds: vi.fn(async () => new Map()),
    getUsage: vi.fn(async () => ({ lastMinute: 0, lastHour: 0 })),
    recordUsage: vi.fn(async () => undefined),
    upsertGame: vi.fn(async () => "game-1"),
    ...over,
  } as never;
}

describe("isOverLimit", () => {
  it("allows usage below both limits", () => {
    expect(
      isOverLimit({
        lastMinute: LIMITS.perMinute - 1,
        lastHour: LIMITS.perHour - 1,
      }),
    ).toBe(false);
  });
  it("blocks at the per-minute limit and at the per-hour limit", () => {
    expect(isOverLimit({ lastMinute: LIMITS.perMinute, lastHour: 0 })).toBe(
      true,
    );
    expect(isOverLimit({ lastMinute: 0, lastHour: LIMITS.perHour })).toBe(true);
  });
});

describe("importExternalGame", () => {
  it("imports a new game and returns its id", async () => {
    const store = fakeStore();
    const source = fakeSource();
    expect(await importExternalGame(source, "13", "u1", store)).toEqual({
      ok: true,
      gameId: "game-1",
    });
    expect(store.recordUsage).toHaveBeenCalledWith("u1", "bgg", "13");
    expect(store.upsertGame).toHaveBeenCalledWith(GAME);
  });

  it("returns an already imported game without calling the source or using quota", async () => {
    const store = fakeStore({ findGameId: vi.fn(async () => "existing") });
    const source = fakeSource();
    expect(await importExternalGame(source, "13", "u1", store)).toEqual({
      ok: true,
      gameId: "existing",
    });
    expect(source.fetchGame).not.toHaveBeenCalled();
    expect(store.recordUsage).not.toHaveBeenCalled();
    expect(store.getUsage).not.toHaveBeenCalled();
  });

  it("reports 'unavailable' while the token is pending, even for unknown games", async () => {
    const store = fakeStore();
    const source = fakeSource({ isConfigured: () => false });
    expect(await importExternalGame(source, "13", "u1", store)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(store.recordUsage).not.toHaveBeenCalled();
  });

  it("stops at the rate limit before touching the source", async () => {
    const store = fakeStore({
      getUsage: vi.fn(async () => ({
        lastMinute: LIMITS.perMinute,
        lastHour: 0,
      })),
    });
    const source = fakeSource();
    expect(await importExternalGame(source, "13", "u1", store)).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(source.fetchGame).not.toHaveBeenCalled();
    expect(store.recordUsage).not.toHaveBeenCalled();
  });

  it.each([
    [new BggError("not_found"), "not_found"],
    [new BggError("rate_limited"), "rate_limited"],
    [new BggError("unauthorized"), "unavailable"],
    [new BggError("timeout"), "failed"],
    [new BggError("upstream"), "failed"],
    [new BggError("invalid_response"), "failed"],
    [new Error("boom"), "failed"],
  ])("maps %s to %s", async (error, expected) => {
    const source = fakeSource({
      fetchGame: vi.fn(async () => {
        throw error;
      }),
    });
    expect(await importExternalGame(source, "13", "u1", fakeStore())).toEqual({
      ok: false,
      error: expected,
    });
  });

  it("counts the attempt even when the source fails (so failures are rate limited too)", async () => {
    const store = fakeStore();
    const source = fakeSource({
      fetchGame: vi.fn(async () => {
        throw new BggError("upstream");
      }),
    });
    await importExternalGame(source, "13", "u1", store);
    expect(store.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("rejects a payload that fails validation and never writes it", async () => {
    const store = fakeStore();
    const source = fakeSource({
      fetchGame: vi.fn(async () => ({
        ...GAME,
        coverUrl: "javascript:alert(1)",
      })),
    });
    expect(await importExternalGame(source, "13", "u1", store)).toEqual({
      ok: false,
      error: "failed",
    });
    expect(store.upsertGame).not.toHaveBeenCalled();
  });

  it("resolves a concurrent import (unique violation) to the winner's game", async () => {
    const findGameId = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("winner");
    const store = fakeStore({
      findGameId,
      upsertGame: vi.fn(async () => {
        throw Object.assign(new Error("dup"), { code: "23505" });
      }),
    });
    expect(await importExternalGame(fakeSource(), "13", "u1", store)).toEqual({
      ok: true,
      gameId: "winner",
    });
  });

  it("fails cleanly on a database error", async () => {
    const store = fakeStore({
      upsertGame: vi.fn(async () => {
        throw Object.assign(new Error("db"), { code: "XX000" });
      }),
    });
    expect(await importExternalGame(fakeSource(), "13", "u1", store)).toEqual({
      ok: false,
      error: "failed",
    });
  });
});

describe("searchExternalGames", () => {
  it("flags hits that are already in the catalog", async () => {
    const store = fakeStore({
      findGameIds: vi.fn(async () => new Map([["13", "local-1"]])),
    });
    const result = await searchExternalGames(
      fakeSource(),
      "catan",
      "u1",
      store,
    );
    expect(result).toEqual({ ok: true, hits: [{ ...HIT, gameId: "local-1" }] });
  });

  it("returns gameId null for new games", async () => {
    const result = await searchExternalGames(
      fakeSource(),
      "catan",
      "u1",
      fakeStore(),
    );
    expect(result).toEqual({ ok: true, hits: [{ ...HIT, gameId: null }] });
  });

  it("is 'unavailable' without a token and does not log usage", async () => {
    const store = fakeStore();
    const result = await searchExternalGames(
      fakeSource({ isConfigured: () => false }),
      "catan",
      "u1",
      store,
    );
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(store.recordUsage).not.toHaveBeenCalled();
  });

  it("is rate limited per user", async () => {
    const store = fakeStore({
      getUsage: vi.fn(async () => ({
        lastMinute: 0,
        lastHour: LIMITS.perHour,
      })),
    });
    const source = fakeSource();
    expect(await searchExternalGames(source, "catan", "u1", store)).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(source.search).not.toHaveBeenCalled();
  });

  it("maps source failures to error codes", async () => {
    const source = fakeSource({
      search: vi.fn(async () => {
        throw new BggError("timeout");
      }),
    });
    expect(
      await searchExternalGames(source, "catan", "u1", fakeStore()),
    ).toEqual({ ok: false, error: "failed" });
  });

  it("returns an empty list without a catalog lookup when nothing matches", async () => {
    const store = fakeStore();
    const source = fakeSource({ search: vi.fn(async () => []) });
    expect(await searchExternalGames(source, "zzzz", "u1", store)).toEqual({
      ok: true,
      hits: [],
    });
    expect(store.findGameIds).not.toHaveBeenCalled();
  });
});

describe("importExternalGame: no background work", () => {
  it("returns the game and touches only the import store (no cover hashing)", async () => {
    const store = fakeStore();
    const result = await importExternalGame(fakeSource(), "13", "u1", store);
    expect(result).toEqual({ ok: true, gameId: "game-1" });
    expect(Object.keys(store).sort()).toEqual(
      [
        "findGameId",
        "findGameIds",
        "getUsage",
        "recordUsage",
        "upsertGame",
      ].sort(),
    );
  });
});
