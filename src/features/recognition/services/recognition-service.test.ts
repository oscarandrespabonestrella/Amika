import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/features/catalog", () => ({
  getGameSource: vi.fn(),
  searchExternalGames: vi.fn(),
  searchLocalGames: vi.fn(),
}));

import { listCoverGames, MAX_COVER_GAMES } from "./recognition-service";

type Row = {
  id: string;
  name: string;
  cover_url: string | null;
  game_external_ids: { source: string; external_id: string }[];
};

/** A fake PostgREST query: records the ranges asked and answers from `rows`. */
function fakeDb(rows: Row[], failOnPage?: number) {
  const ranges: [number, number][] = [];
  const query = {
    select: vi.fn(() => query),
    not: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async (from: number, to: number) => {
      ranges.push([from, to]);
      if (failOnPage !== undefined && ranges.length === failOnPage)
        return { data: null, error: new Error("boom") };
      return { data: rows.slice(from, to + 1), error: null };
    }),
  };
  return { db: { from: vi.fn(() => query) }, ranges, query };
}

const game = (i: number, bgg: string | null = String(i)): Row => ({
  id: `id-${i}`,
  name: `Game ${i}`,
  cover_url: `https://cf.geekdo-images.com/${i}.jpg`,
  game_external_ids: bgg ? [{ source: "bgg", external_id: bgg }] : [],
});

describe("listCoverGames", () => {
  it("returns the BGG id of imported games and null for custom ones", async () => {
    const { db } = fakeDb([
      game(1),
      game(2, null),
      {
        ...game(3),
        game_external_ids: [{ source: "other", external_id: "77" }],
      },
    ]);
    const out = await listCoverGames(db as never);
    expect(out.complete).toBe(true);
    expect(out.games.map((g) => [g.id, g.bggId])).toEqual([
      ["id-1", "1"],
      ["id-2", null],
      ["id-3", null],
    ]);
  });

  it("pages through the catalog with a stable order and reports it complete", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => game(i + 1));
    const { db, ranges, query } = fakeDb(rows);
    const out = await listCoverGames(db as never);
    expect(out.complete).toBe(true);
    expect(out.games).toHaveLength(1500);
    expect(ranges[0]).toEqual([0, 999]);
    expect(ranges[1]).toEqual([1000, 1999]);
    expect(query.order).toHaveBeenCalledWith("name");
    expect(query.order).toHaveBeenCalledWith("id");
  });

  it("reports an incomplete listing when the catalog is bigger than the cap", async () => {
    const rows = Array.from({ length: MAX_COVER_GAMES + 5 }, (_, i) =>
      game(i + 1),
    );
    const { db } = fakeDb(rows);
    const out = await listCoverGames(db as never);
    expect(out.complete).toBe(false);
    expect(out.games).toHaveLength(MAX_COVER_GAMES);
  });

  it("throws when a page fails, instead of returning a partial list as complete", async () => {
    const { db } = fakeDb(
      Array.from({ length: 1500 }, (_, i) => game(i + 1)),
      2,
    );
    await expect(listCoverGames(db as never)).rejects.toThrow("boom");
  });
});
