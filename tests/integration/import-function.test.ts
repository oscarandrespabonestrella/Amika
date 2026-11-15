import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";

const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    source: "bgg",
    externalId: "424242",
    language: "en",
    kind: "base",
    name: "Test Import Game",
    description: "A game used by the integration tests.",
    yearPublished: 2001,
    minPlayers: 2,
    maxPlayers: 4,
    minPlaytime: 30,
    maxPlaytime: 60,
    minAge: 8,
    coverUrl: "https://example.com/cover.jpg",
    terms: [
      { type: "category", externalId: "1", name: "Economic" },
      { type: "mechanic", externalId: "2", name: "Dice Rolling" },
      { type: "designer", externalId: "3", name: "Someone" },
    ],
    relations: [
      { type: "has_expansion", externalId: "777", name: "Test Expansion" },
    ],
    ...over,
  });

/** Runs as the privileged role (like service_role: bypasses RLS) inside a rolled-back transaction. */
const asServer = <T>(fn: (c: Client) => Promise<T>) =>
  withRole(
    "authenticated",
    { sub: A },
    async () => undefined,
    async (c) => {
      await c.query("reset role");
      return fn(c);
    },
  );

const upsert = async (c: Client, json: string) =>
  (await c.query("select public.upsert_external_game($1::jsonb) as id", [json]))
    .rows[0].id as string;

describe.skipIf(!hasDb)("upsert_external_game()", () => {
  it("creates the game with translation, terms, relations and external id", async () => {
    const result = await asServer(async (c) => {
      const id = await upsert(c, payload());
      const game = (
        await c.query(
          "select name, source, owner_id, year_published, cover_url from public.games where id = $1",
          [id],
        )
      ).rows[0];
      const tr = (
        await c.query(
          "select locale, description from public.game_translations where game_id = $1",
          [id],
        )
      ).rows;
      const terms = (
        await c.query(
          "select t.type, t.name from public.game_terms gt join public.terms t on t.id = gt.term_id where gt.game_id = $1 order by t.type",
          [id],
        )
      ).rows;
      const rel = (
        await c.query(
          "select type, related_name, related_external_id from public.game_relations where game_id = $1",
          [id],
        )
      ).rows;
      const ext = (
        await c.query(
          "select source, external_id from public.game_external_ids where game_id = $1",
          [id],
        )
      ).rows;
      return { game, tr, terms, rel, ext };
    });
    expect(result.game).toMatchObject({
      name: "Test Import Game",
      source: "bgg",
      owner_id: null,
      year_published: 2001,
    });
    expect(result.tr).toEqual([
      { locale: "en", description: "A game used by the integration tests." },
    ]);
    expect(result.terms.map((t) => t.type)).toEqual([
      "category",
      "designer",
      "mechanic",
    ]);
    expect(result.rel).toEqual([
      {
        type: "has_expansion",
        related_name: "Test Expansion",
        related_external_id: "777",
      },
    ]);
    expect(result.ext).toEqual([{ source: "bgg", external_id: "424242" }]);
  });

  it("is idempotent: importing twice updates instead of duplicating", async () => {
    const result = await asServer(async (c) => {
      const first = await upsert(c, payload());
      const second = await upsert(
        c,
        payload({
          name: "Renamed",
          description: "Updated",
          terms: [{ type: "category", externalId: "1", name: "Economic" }],
        }),
      );
      const games = (
        await c.query(
          "select count(*)::int as n from public.games where id = $1",
          [first],
        )
      ).rows[0].n;
      const row = (
        await c.query("select name from public.games where id = $1", [first])
      ).rows[0];
      const termCount = (
        await c.query(
          "select count(*)::int as n from public.game_terms where game_id = $1",
          [first],
        )
      ).rows[0].n;
      const ext = (
        await c.query(
          "select count(*)::int as n from public.game_external_ids where source='bgg' and external_id='424242'",
        )
      ).rows[0].n;
      return { same: first === second, games, name: row.name, termCount, ext };
    });
    expect(result).toEqual({
      same: true,
      games: 1,
      name: "Renamed",
      termCount: 1,
      ext: 1,
    });
  });

  it("links a relation to the related game when it is already imported", async () => {
    const linked = await asServer(async (c) => {
      const expansion = await upsert(
        c,
        payload({
          externalId: "777",
          name: "Test Expansion",
          kind: "expansion",
          terms: [],
          relations: [],
        }),
      );
      const base = await upsert(c, payload());
      const rel = (
        await c.query(
          "select related_game_id from public.game_relations where game_id = $1",
          [base],
        )
      ).rows[0];
      return rel.related_game_id === expansion;
    });
    expect(linked).toBe(true);
  });

  it("rejects an invalid payload and leaves nothing behind", async () => {
    const outcome = await asServer(async (c) => {
      const code = await pgErrorCode(
        c.query("select public.upsert_external_game($1::jsonb)", [
          payload({ name: "" }),
        ]),
      );
      return code;
    });
    expect(outcome).toBe("22023");
  });

  it("a database constraint rejects out-of-range data (nothing half-written)", async () => {
    const result = await asServer(async (c) => {
      await c.query("savepoint s");
      const code = await pgErrorCode(
        c.query("select public.upsert_external_game($1::jsonb)", [
          payload({ externalId: "55", minPlayers: 9, maxPlayers: 2 }),
        ]),
      );
      await c.query("rollback to savepoint s");
      const left = (
        await c.query(
          "select count(*)::int as n from public.game_external_ids where external_id = '55'",
        )
      ).rows[0].n;
      return { code, left };
    });
    expect(result).toEqual({ code: "23514", left: 0 });
  });

  it("is not executable by signed-in users or anonymous visitors", async () => {
    const asUser = await withRole(
      "authenticated",
      { sub: A },
      async () => undefined,
      (c) =>
        pgErrorCode(
          c.query("select public.upsert_external_game($1::jsonb)", [payload()]),
        ),
    );
    const asAnon = await withRole(
      "anon",
      null,
      async () => undefined,
      (c) =>
        pgErrorCode(
          c.query("select public.upsert_external_game($1::jsonb)", [payload()]),
        ),
    );
    expect(asUser).toBe("42501");
    expect(asAnon).toBe("42501");
  });
});

describe.skipIf(!hasDb)("photo cap", () => {
  it("allows 10 photos per game and rejects the 11th", async () => {
    const GAME = "00000000-0000-4000-8000-0000000000a1";
    const result = await withRole(
      "authenticated",
      { sub: A },
      async (c) => {
        await c.query(`insert into public.profiles (id) values ($1)`, [A]);
        await c.query(
          `insert into public.games (id, name, source, owner_id) values ($1,'Cap Game','manual',$2)`,
          [GAME, A],
        );
      },
      async (c) => {
        for (let i = 1; i <= 10; i++) {
          await c.query(
            `insert into public.game_photos (game_id, storage_path) values ($1,$2)`,
            [GAME, `${A}/${i}.jpg`],
          );
        }
        return pgErrorCode(
          c.query(
            `insert into public.game_photos (game_id, storage_path) values ($1,$2)`,
            [GAME, `${A}/11.jpg`],
          ),
        );
      },
    );
    expect(result).toBe("P0001");
  });
});
