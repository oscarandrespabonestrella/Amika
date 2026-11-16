import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";
const B = "test_user_b";

const G_GLOBAL = "00000000-0000-4000-8000-000000000001"; // imported from BGG
const G_A = "00000000-0000-4000-8000-0000000000a1"; // A's custom game
const G_B = "00000000-0000-4000-8000-0000000000b1"; // B's custom game
// The dev database also holds real catalog games, so assertions look only at the games
// these fixtures create.
const FIXTURE_GAMES = [G_GLOBAL, G_A, G_B];

async function fixtures(c: Client) {
  await c.query(
    `insert into public.profiles (id, display_name) values ($1,'Alice'),($2,'Bob')`,
    [A, B],
  );
  await c.query(
    `insert into public.games (id, name, source, min_players, max_players, min_playtime, max_playtime, kind)
     values ($1, 'Catán', 'bgg', 3, 4, 60, 120, 'base')`,
    [G_GLOBAL],
  );
  await c.query(
    `insert into public.games (id, name, source, owner_id, min_players, max_players)
     values ($1, 'Alice Secret Game', 'manual', $2, 2, 2),
            ($3, 'Zebra Private Game', 'manual', $4, 1, 5)`,
    [G_A, A, G_B, B],
  );
  await c.query(
    `insert into public.game_translations (game_id, locale, name, description)
     values ($1,'en','Catan','Trade and build.'), ($2,'en','Zebra','Bob only.')`,
    [G_GLOBAL, G_B],
  );
  await c.query(
    `insert into public.game_external_ids (game_id, source, external_id) values ($1,'bgg','9911013')`,
    [G_GLOBAL],
  );
  await c.query(`insert into public.terms (id, type, source, external_id, name)
                 values ('00000000-0000-4000-8000-0000000000c1','category','bgg','9911021','Economic')`);
  await c.query(
    `insert into public.game_terms (game_id, term_id) values ($1,'00000000-0000-4000-8000-0000000000c1')`,
    [G_GLOBAL],
  );
  await c.query(
    `insert into public.catalog_imports (user_id, source, external_id) values ($1,'bgg','9911013')`,
    [A],
  );
}

const asA = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("authenticated", { sub: A }, fixtures, fn);
const asB = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("authenticated", { sub: B }, fixtures, fn);
const asAnon = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("anon", null, fixtures, fn);

const names = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query(sql, params)).rows.map((r) => r.name as string).sort();

describe.skipIf(!hasDb)("RLS: games visibility", () => {
  it("a user sees global games and their own custom games, never another user's", async () => {
    expect(
      await asA((c) =>
        names(c, "select name from public.games where id = any($1)", [
          FIXTURE_GAMES,
        ]),
      ),
    ).toEqual(["Alice Secret Game", "Catán"]);
    expect(
      await asB((c) =>
        names(c, "select name from public.games where id = any($1)", [
          FIXTURE_GAMES,
        ]),
      ),
    ).toEqual(["Catán", "Zebra Private Game"]);
  });

  it("anonymous users see nothing", async () => {
    expect(
      await asAnon((c) => pgErrorCode(c.query("select * from public.games"))),
    ).toBe("42501");
  });

  it("child rows follow the visibility of their game", async () => {
    const a = await asA(async (c) =>
      (
        await c.query(
          "select game_id from public.game_translations where game_id = any($1)",
          [FIXTURE_GAMES],
        )
      ).rows.map((r) => r.game_id),
    );
    expect(a).toEqual([G_GLOBAL]); // not B's custom game translation
    const b = await asB(async (c) =>
      (
        await c.query(
          "select game_id from public.game_translations where game_id = any($1)",
          [FIXTURE_GAMES],
        )
      ).rows
        .map((r) => r.game_id)
        .sort(),
    );
    expect(b).toEqual([G_GLOBAL, G_B].sort());
  });

  it("shared vocabulary and external ids are readable", async () => {
    expect(
      await asA(
        async (c) =>
          (
            await c.query(
              "select name from public.terms where external_id = '9911021'",
            )
          ).rowCount,
      ),
    ).toBe(1);
    expect(
      await asA(
        async (c) =>
          (
            await c.query(
              "select external_id from public.game_external_ids where external_id = '9911013'",
            )
          ).rowCount,
      ),
    ).toBe(1);
  });
});

describe.skipIf(!hasDb)("RLS: games writes", () => {
  const insertGame = (source: string, owner: string | null) => (c: Client) =>
    pgErrorCode(
      c.query(
        `insert into public.games (name, source, owner_id) values ('X', $1, $2)`,
        [source, owner],
      ),
    );

  it("a user can create their own custom game", async () => {
    expect(await asA(insertGame("manual", A))).toBeNull();
  });

  it("a user cannot create a game for someone else", async () => {
    expect(await asA(insertGame("manual", B))).toBe("42501");
  });

  it("a user cannot write into the global catalog", async () => {
    expect(await asA(insertGame("bgg", null))).toBe("42501");
  });

  it("the database rejects a manual game without owner and a global game with one", async () => {
    const bad = (source: string, owner: string | null) =>
      withRole("authenticated", { sub: A }, fixtures, async (c) => {
        await c.query("reset role"); // privileged: only the CHECK constraint is under test
        return pgErrorCode(
          c.query(
            `insert into public.games (name, source, owner_id) values ('X',$1,$2)`,
            [source, owner],
          ),
        );
      });
    expect(await bad("manual", null)).toBe("23514");
    expect(await bad("bgg", A)).toBe("23514");
  });

  it("a user can update and delete only their own custom games", async () => {
    const rows = await asA(async (c) => ({
      own: (
        await c.query(
          `update public.games set name = 'Renamed' where id = $1`,
          [G_A],
        )
      ).rowCount,
      global: (
        await c.query(`update public.games set name = 'hack' where id = $1`, [
          G_GLOBAL,
        ])
      ).rowCount,
      other: (
        await c.query(`update public.games set name = 'hack' where id = $1`, [
          G_B,
        ])
      ).rowCount,
      delGlobal: (
        await c.query(`delete from public.games where id = $1`, [G_GLOBAL])
      ).rowCount,
      delOther: (await c.query(`delete from public.games where id = $1`, [G_B]))
        .rowCount,
      delOwn: (await c.query(`delete from public.games where id = $1`, [G_A]))
        .rowCount,
    }));
    expect(rows).toEqual({
      own: 1,
      global: 0,
      other: 0,
      delGlobal: 0,
      delOther: 0,
      delOwn: 1,
    });
  });

  it("a user cannot hand their custom game to someone else", async () => {
    const code = await asA((c) =>
      pgErrorCode(
        c.query(`update public.games set owner_id = $2 where id = $1`, [
          G_A,
          B,
        ]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("a user cannot promote their custom game to the global catalog", async () => {
    const code = await asA((c) =>
      pgErrorCode(
        c.query(
          `update public.games set source = 'bgg', owner_id = null where id = $1`,
          [G_A],
        ),
      ),
    );
    expect(code).toBe("42501");
  });

  it("owners can write translations of their custom games only", async () => {
    const ins = (game: string) => (c: Client) =>
      pgErrorCode(
        c.query(
          `insert into public.game_translations (game_id, locale, description) values ($1,'es','hola')`,
          [game],
        ),
      );
    expect(await asA(ins(G_A))).toBeNull();
    expect(await asA(ins(G_GLOBAL))).toBe("42501");
    expect(await asA(ins(G_B))).toBe("42501");
  });

  it("global-only tables cannot be written by users", async () => {
    // One transaction per attempt: after an error Postgres aborts the transaction.
    const attempt = (sql: string, params: unknown[] = []) =>
      asA((c) => pgErrorCode(c.query(sql, params)));
    const attempts = [
      await attempt(
        `insert into public.terms (type, source, external_id, name) values ('category','bgg','9911009','x')`,
      ),
      await attempt(
        `insert into public.game_terms (game_id, term_id) values ($1,'00000000-0000-4000-8000-0000000000c1')`,
        [G_A],
      ),
      await attempt(
        `insert into public.game_external_ids (game_id, source, external_id) values ($1,'bgg','99')`,
        [G_A],
      ),
      await attempt(`delete from public.terms`),
    ];
    expect(attempts).toEqual(["42501", "42501", "42501", "42501"]);
  });

  it("the import log is invisible to users", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(c.query("select * from public.catalog_imports")),
      ),
    ).toBe("42501");
  });
});

describe.skipIf(!hasDb)("search_games()", () => {
  const search = (c: Client, ...args: unknown[]) =>
    names(
      c,
      "select name from public.search_games($1, $2, $3, $4) where id = any($5)",
      [
        args[0],
        args[1] ?? null,
        args[2] ?? null,
        args[3] ?? null,
        FIXTURE_GAMES,
      ],
    );

  it("ignores accents and case", async () => {
    expect(await asA((c) => search(c, "catan"))).toEqual(["Catán"]);
    expect(await asA((c) => search(c, "CATÁN"))).toEqual(["Catán"]);
  });

  it("never returns another user's custom games", async () => {
    expect(await asA((c) => search(c, "zebra"))).toEqual([]);
    expect(await asB((c) => search(c, "zebra"))).toEqual([
      "Zebra Private Game",
    ]);
  });

  it("treats LIKE wildcards literally", async () => {
    expect(await asA((c) => search(c, "%"))).toEqual([]);
    expect(await asA((c) => search(c, "_"))).toEqual([]);
  });

  it("filters by player count, duration and kind", async () => {
    expect(await asA((c) => search(c, null, null, 4))).toEqual(["Catán"]);
    expect(await asA((c) => search(c, null, null, 6))).toEqual([]);
    expect(await asA((c) => search(c, null, null, null, 30))).toEqual([]); // Catán starts at 60 min
    expect(await asA((c) => search(c, null, "expansion"))).toEqual([]);
  });

  it("an empty query lists what the user can see", async () => {
    expect(await asA((c) => search(c, ""))).toEqual([
      "Alice Secret Game",
      "Catán",
    ]);
  });
});

describe.skipIf(!hasDb)("RLS: game photos", () => {
  const photo = (game: string, path: string) => (c: Client) =>
    pgErrorCode(
      c.query(
        `insert into public.game_photos (game_id, storage_path) values ($1,$2)`,
        [game, path],
      ),
    );

  it("a user can add a photo to a game they can see, inside their own folder", async () => {
    expect(await asA(photo(G_GLOBAL, `${A}/1.jpg`))).toBeNull();
    expect(await asA(photo(G_A, `${A}/2.jpg`))).toBeNull();
  });

  it("rejects a path outside the user's folder", async () => {
    expect(await asA(photo(G_GLOBAL, `${B}/1.jpg`))).toBe("23514");
  });

  it("rejects a photo on a game the user cannot see", async () => {
    expect(await asA(photo(G_B, `${A}/3.jpg`))).toBe("42501");
  });

  it("photos are private to their owner", async () => {
    const seen = await withRole(
      "authenticated",
      { sub: B },
      async (c) => {
        await fixtures(c);
        await c.query(
          `insert into public.game_photos (user_id, game_id, storage_path) values ($1,$2,$3)`,
          [A, G_GLOBAL, `${A}/9.jpg`],
        );
      },
      async (c) => (await c.query("select 1 from public.game_photos")).rowCount,
    );
    expect(seen).toBe(0);
  });

  it("a user can delete their own photo row, never someone else's", async () => {
    const result = await withRole(
      "authenticated",
      { sub: A },
      async (c) => {
        await fixtures(c);
        await c.query(
          `insert into public.game_photos (id, user_id, game_id, storage_path) values
             ('00000000-0000-4000-8000-0000000000f1', $1, $3, $4),
             ('00000000-0000-4000-8000-0000000000f2', $2, $3, $5)`,
          [A, B, G_GLOBAL, `${A}/mine.jpg`, `${B}/theirs.jpg`],
        );
      },
      async (c) => ({
        own: (
          await c.query(
            `delete from public.game_photos where id = '00000000-0000-4000-8000-0000000000f1'`,
          )
        ).rowCount,
        other: (
          await c.query(
            `delete from public.game_photos where id = '00000000-0000-4000-8000-0000000000f2'`,
          )
        ).rowCount,
      }),
    );
    expect(result).toEqual({ own: 1, other: 0 });
  });

  // Direct DELETE on storage.objects is blocked by Supabase (use the Storage API), so file
  // deletion is verified end to end in tests/e2e/app-games.spec.ts instead.

  it("storage: users can only write and read inside their own folder", async () => {
    const put = (name: string) => (c: Client) =>
      pgErrorCode(
        c.query(
          `insert into storage.objects (bucket_id, name) values ('game-photos', $1)`,
          [name],
        ),
      );
    expect(await asA(put(`${A}/ok.jpg`))).toBeNull();
    expect(await asA(put(`${B}/nope.jpg`))).toBe("42501");

    const seenByB = await withRole(
      "authenticated",
      { sub: B },
      async (c) => {
        await fixtures(c);
        await c.query(
          `insert into storage.objects (bucket_id, name) values ('game-photos', $1)`,
          [`${A}/secret.jpg`],
        );
      },
      async (c) =>
        (
          await c.query(
            `select name from storage.objects where bucket_id = 'game-photos'`,
          )
        ).rowCount,
    );
    expect(seenByB).toBe(0);
  });

  it("the bucket is private and restricted to small images", async () => {
    const row = await withRole(
      "authenticated",
      { sub: A },
      fixtures,
      async (c) => {
        await c.query("reset role");
        return (
          await c.query(
            `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'game-photos'`,
          )
        ).rows[0];
      },
    );
    expect(row.public).toBe(false);
    expect(Number(row.file_size_limit)).toBe(5242880); // bigint arrives as text
    expect(row.allowed_mime_types).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
});
