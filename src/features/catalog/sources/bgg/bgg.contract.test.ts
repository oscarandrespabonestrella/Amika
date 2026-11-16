import { describe, expect, it } from "vitest";
import { createBggSource } from "./client";

/**
 * Contract test against the REAL BoardGameGeek API.
 * Skipped unless BGG_API_TOKEN is set. VERIFIED against the live API on 2026-11-16:
 * the Bearer header, the search and thing endpoints and our parsers all work. BGG's
 * search is slow (about 5 s), hence the generous timeouts.
 * Run with: node --env-file=.env.local node_modules/vitest/vitest.mjs run src/features/catalog/sources/bgg/bgg.contract.test.ts
 *
 * When it first runs, check: the Authorization header format, that `search`
 * returns hits, that `thing` has the fields parse.ts expects, and the 202/429
 * behaviour. Then replace the samples in fixtures.ts with recorded responses.
 */
const token = process.env.BGG_API_TOKEN;

describe.skipIf(!token)("BGG live API", () => {
  const bgg = createBggSource({ token });

  it("finds Catan by name", { timeout: 40_000 }, async () => {
    const hits = await bgg.search("catan");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.externalId === "13")).toBe(true);
  });

  it(
    "fetches Catan (id 13) with the fields we rely on",
    { timeout: 40_000 },
    async () => {
      const game = await bgg.fetchGame("13");
      expect(game.name.toLowerCase()).toContain("catan");
      expect(game.minPlayers).toBeGreaterThan(0);
      expect(game.terms.length).toBeGreaterThan(0);
      expect(game.coverUrl).toMatch(/^https:\/\//);
    },
  );
});
