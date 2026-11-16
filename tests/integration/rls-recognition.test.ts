import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";
const B = "test_user_b";
const G1 = "00000000-0000-4000-8000-0000000000a1"; // catalog game
const G2 = "00000000-0000-4000-8000-0000000000a2"; // catalog game
const G_B = "00000000-0000-4000-8000-0000000000a3"; // B's private custom game
const GTIN = "9783161484100";
const GTIN_2 = "0036000291452";
const H_ONES = "ffffffffffffffff";
const H_3BITS = "fffffffffffffff8"; // 3 bits away from H_ONES
const H_ZERO = "0000000000000000";

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2)`, [A, B]);
  await c.query(
    `insert into public.games (id, name, source, kind) values ($1,'Catán','bgg','base'),($2,'Azul','bgg','base')`,
    [G1, G2],
  );
  await c.query(
    `insert into public.games (id, name, source, kind, owner_id) values ($1,'B secret','manual','base',$2)`,
    [G_B, B],
  );
}

const as =
  (sub: string) =>
  <T>(fn: (c: Client) => Promise<T>, extra?: (c: Client) => Promise<void>) =>
    withRole(
      "authenticated",
      { sub },
      async (c) => {
        await fixtures(c);
        await extra?.(c);
      },
      fn,
    );
const asA = as(A);
const asB = as(B);

const q = async <T extends object>(c: Client, sql: string, p: unknown[] = []) =>
  (await c.query<T>(sql, p)).rows;
const count = async (c: Client, sql: string, p: unknown[] = []) =>
  (await c.query<{ n: number }>(`select count(*)::int n from ${sql}`, p))
    .rows[0].n;

/** Privileged setup: a cover hash written the way the server does it (service_role). */
const coverHash = (game: string, hash: string) => async (c: Client) => {
  await c.query("set local role service_role");
  await c.query("select public.upsert_cover_hash($1,$2)", [game, hash]);
  await c.query("reset role");
};

describe.skipIf(!hasDb)("game_barcodes", () => {
  it("a user stores and reads their own barcode", async () => {
    const rows = await asA(async (c) => {
      await c.query(
        `insert into public.game_barcodes (gtin, game_id) values ($1,$2)`,
        [GTIN, G1],
      );
      return q<{ gtin: string; user_id: string }>(
        c,
        `select gtin, user_id from public.game_barcodes`,
      );
    });
    expect(rows).toEqual([{ gtin: GTIN, user_id: A }]);
  });

  it("another user never sees it and cannot write as someone else", async () => {
    const seen = await asB(
      (c) => count(c, "public.game_barcodes"),
      (c) =>
        c
          .query(
            `insert into public.game_barcodes (user_id, gtin, game_id) values ($1,$2,$3)`,
            [A, GTIN, G1],
          )
          .then(() => undefined),
    );
    expect(seen).toBe(0);
    const code = await asB((c) =>
      pgErrorCode(
        c.query(
          `insert into public.game_barcodes (user_id, gtin, game_id) values ($1,$2,$3)`,
          [A, GTIN_2, G1],
        ),
      ),
    );
    expect(code).toBe("42501");
  });

  it("a game the user cannot see is refused", async () => {
    const code = await asA((c) =>
      pgErrorCode(
        c.query(
          `insert into public.game_barcodes (gtin, game_id) values ($1,$2)`,
          [GTIN, G_B],
        ),
      ),
    );
    expect(code).toBe("42501");
  });

  it("only 13 digits are accepted", async () => {
    for (const bad of ["123456789012", "97831614841ab", "", "97831614841000"]) {
      const code = await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.game_barcodes (gtin, game_id) values ($1,$2)`,
            [bad, G1],
          ),
        ),
      );
      expect(code, bad).toBe("23514");
    }
  });

  it("a barcode maps to one game per user; the mapping can be re-pointed, nothing else", async () => {
    await asA(async (c) => {
      await c.query(
        `insert into public.game_barcodes (gtin, game_id) values ($1,$2)`,
        [GTIN, G1],
      );
      expect(
        await pgErrorCode(
          c.query(
            `insert into public.game_barcodes (gtin, game_id) values ($1,$2)`,
            [GTIN, G2],
          ),
        ),
      ).toBe("23505");
    });
    await asA(async (c) => {
      await c.query(
        `insert into public.game_barcodes (gtin, game_id) values ($1,$2)`,
        [GTIN, G1],
      );
      await c.query(`update public.game_barcodes set game_id = $1`, [G2]);
      expect(
        await count(c, "public.game_barcodes where game_id = $1", [G2]),
      ).toBe(1);
      // Each refusal aborts the transaction: isolate it with a savepoint.
      for (const [sql, param] of [
        ["update public.game_barcodes set gtin = $1", GTIN_2],
        ["update public.game_barcodes set user_id = $1", B],
      ]) {
        await c.query("savepoint refused");
        expect(await pgErrorCode(c.query(sql, [param])), sql).toBe("42501");
        await c.query("rollback to savepoint refused");
      }
    });
  });

  it("is capped at 500 per user, and the cap locks the profile row", async () => {
    const code = await asA(
      (c) =>
        pgErrorCode(
          c.query(
            `insert into public.game_barcodes (gtin, game_id) values ('9999999999999',$1)`,
            [G1],
          ),
        ),
      (c) =>
        c
          .query(
            `insert into public.game_barcodes (user_id, gtin, game_id)
             select $1, lpad(g::text, 13, '0'), $2 from generate_series(1, 500) g`,
            [A, G1],
          )
          .then(() => undefined),
    );
    expect(code).toBe("P0001");
    const def = await asA((c) =>
      q<{ def: string }>(
        c,
        `select pg_get_functiondef(p.oid) def from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'enforce_barcode_cap'`,
      ),
    );
    expect(def[0].def).toContain("for update");
  });

  it("deleting a game or a profile leaves no orphan barcode; anon has no access", async () => {
    const left = await asA(
      async (c) => {
        await c.query("delete from public.games where id = $1", [G1]);
        return count(c, "public.game_barcodes");
      },
      (c) =>
        c
          .query(
            `insert into public.game_barcodes (user_id, gtin, game_id) values ($1,$2,$3)`,
            [A, GTIN, G1],
          )
          .then(() => undefined),
    );
    // A cannot delete a catalog game (RLS), so the row is still there; the cascade is
    // checked below as the privileged role.
    expect(left).toBe(1);
    const cascade = await withRole(
      "authenticated",
      { sub: A },
      async (c) => {
        await fixtures(c);
        await c.query(
          `insert into public.game_barcodes (user_id, gtin, game_id) values ($1,$2,$3)`,
          [A, GTIN, G1],
        );
        await c.query(`delete from public.games where id = $1`, [G1]);
        await c.query(`delete from public.profiles where id = $1`, [A]);
      },
      (c) => count(c, "public.game_barcodes"),
    );
    expect(cascade).toBe(0);
    const anon = await withRole("anon", null, fixtures, (c) =>
      pgErrorCode(c.query(`select * from public.game_barcodes`)),
    );
    expect(anon).toBe("42501");
  });
});

describe.skipIf(!hasDb)("game_image_hashes and save_photo_hash", () => {
  it("a user saves a photo hash for a visible game; it is theirs alone", async () => {
    const rows = await asA(async (c) => {
      await c.query(`select public.save_photo_hash($1,$2)`, [G1, H_ONES]);
      // saving the same hash twice is a no-op
      await c.query(`select public.save_photo_hash($1,$2)`, [G1, H_ONES]);
      return q<{ source: string; owner_id: string }>(
        c,
        `select source, owner_id from public.game_image_hashes`,
      );
    });
    expect(rows).toEqual([{ source: "user_photo", owner_id: A }]);
    const bSees = await asB(
      (c) => count(c, "public.game_image_hashes"),
      (c) =>
        c
          .query(
            `insert into public.game_image_hashes (game_id, owner_id, source, hash)
                  values ($1,$2,'user_photo',-1)`,
            [G1, A],
          )
          .then(() => undefined),
    );
    expect(bSees).toBe(0);
  });

  it("rejects malformed hashes (22023) and games the user cannot see (P0002)", async () => {
    for (const bad of [
      "zz",
      "FFFFFFFFFFFFFFFF",
      "ffff",
      "",
      "fffffffffffffffff",
    ]) {
      const code = await asA((c) =>
        pgErrorCode(c.query(`select public.save_photo_hash($1,$2)`, [G1, bad])),
      );
      expect(code, bad).toBe("22023");
    }
    const code = await asA((c) =>
      pgErrorCode(
        c.query(`select public.save_photo_hash($1,$2)`, [G_B, H_ONES]),
      ),
    );
    expect(code).toBe("P0002");
  });

  it("is capped at 20 photo hashes per user and game", async () => {
    const code = await asA(
      (c) =>
        pgErrorCode(
          c.query(`select public.save_photo_hash($1,$2)`, [G1, H_ZERO]),
        ),
      (c) =>
        c
          .query(
            `insert into public.game_image_hashes (game_id, owner_id, source, hash)
             select $1, $2, 'user_photo', g from generate_series(1, 20) g`,
            [G1, A],
          )
          .then(() => undefined),
    );
    expect(code).toBe("P0001");
    const other = await asA(
      (c) =>
        pgErrorCode(
          c.query(`select public.save_photo_hash($1,$2)`, [G2, H_ZERO]),
        ),
      (c) =>
        c
          .query(
            `insert into public.game_image_hashes (game_id, owner_id, source, hash)
             select $1, $2, 'user_photo', g from generate_series(1, 20) g`,
            [G1, A],
          )
          .then(() => undefined),
    );
    expect(other).toBeNull(); // another game is unaffected
    const def = await asA((c) =>
      q<{ def: string }>(
        c,
        `select pg_get_functiondef(p.oid) def from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'enforce_image_hash_cap'`,
      ),
    );
    expect(def[0].def).toContain("for update");
  });

  it("cover hashes: written only by the server, readable only for visible games", async () => {
    const seenByA = await asA(
      (c) => count(c, "public.game_image_hashes where source = 'cover'"),
      async (c) => {
        await coverHash(G1, H_ONES)(c);
        await coverHash(G_B, H_ZERO)(c); // B's private game
      },
    );
    expect(seenByA).toBe(1); // G1 only
    const seenByB = await asB(
      (c) => count(c, "public.game_image_hashes where source = 'cover'"),
      async (c) => {
        await coverHash(G1, H_ONES)(c);
        await coverHash(G_B, H_ZERO)(c);
      },
    );
    expect(seenByB).toBe(2); // the catalog game and their own custom game
  });

  it("an authenticated user cannot write cover rows or call upsert_cover_hash", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(`select public.upsert_cover_hash($1,$2)`, [G1, H_ONES]),
        ),
      ),
    ).toBe("42501");
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.game_image_hashes (game_id, source, hash) values ($1,'cover',1)`,
            [G1],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("upsert_cover_hash replaces the previous cover hash of a game", async () => {
    const hashes = await asA(
      (c) =>
        q<{ distance: number }>(
          c,
          `select distance from public.match_game_images($1)`,
          [H_ZERO],
        ),
      async (c) => {
        await coverHash(G1, H_ONES)(c);
        await coverHash(G1, H_ZERO)(c);
      },
    );
    expect(hashes).toEqual([{ distance: 0 }]);
  });
});

describe.skipIf(!hasDb)("match_game_images", () => {
  it("finds an exact match at distance 0 and a near one at its distance", async () => {
    const rows = await asA(
      (c) =>
        q<{ game_id: string; distance: number }>(
          c,
          `select * from public.match_game_images($1)`,
          [H_ONES],
        ),
      async (c) => {
        await coverHash(G1, H_ONES)(c);
        await coverHash(G2, H_3BITS)(c);
      },
    );
    expect(rows).toEqual([
      { game_id: G1, distance: 0 },
      { game_id: G2, distance: 3 },
    ]);
  });

  it("returns nothing beyond the threshold and honors a custom one", async () => {
    const setup = coverHash(G1, H_ZERO);
    const far = await asA(
      (c) => q(c, `select * from public.match_game_images($1)`, [H_ONES]),
      setup,
    );
    expect(far).toEqual([]);
    const loose = await asA(
      (c) => q(c, `select * from public.match_game_images($1, 64)`, [H_ONES]),
      setup,
    );
    expect(loose).toHaveLength(1);
  });

  it("merges cover and own photo into the minimum per game", async () => {
    const rows = await asA(
      (c) =>
        q<{ game_id: string; distance: number }>(
          c,
          `select * from public.match_game_images($1)`,
          [H_ONES],
        ),
      async (c) => {
        await coverHash(G1, H_ZERO)(c); // 64 away: out of range on its own
        await c.query(
          `insert into public.game_image_hashes (game_id, owner_id, source, hash)
           values ($1,$2,'user_photo',-1)`,
          [G1, A],
        );
      },
    );
    expect(rows).toEqual([{ game_id: G1, distance: 0 }]);
  });

  it("never leaks another user's photo hashes", async () => {
    const rows = await asB(
      (c) => q(c, `select * from public.match_game_images($1)`, [H_ONES]),
      (c) =>
        c
          .query(
            `insert into public.game_image_hashes (game_id, owner_id, source, hash)
             values ($1,$2,'user_photo',-1)`,
            [G1, A],
          )
          .then(() => undefined),
    );
    expect(rows).toEqual([]);
  });

  it("rejects malformed input (22023) and clamps limit and distance", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(c.query(`select * from public.match_game_images('zz')`)),
      ),
    ).toBe("22023");
    const many = await asA(
      (c) =>
        q(c, `select * from public.match_game_images($1, 1000, 1000)`, [
          H_ONES,
        ]),
      async (c) => {
        await coverHash(G1, H_ONES)(c);
        await coverHash(G2, H_ZERO)(c);
      },
    );
    expect(many).toHaveLength(2);
    const one = await asA(
      (c) =>
        q(c, `select * from public.match_game_images($1, 64, 0)`, [H_ONES]),
      async (c) => {
        await coverHash(G1, H_ONES)(c);
        await coverHash(G2, H_ZERO)(c);
      },
    );
    expect(one).toHaveLength(1);
  });

  it("anon cannot execute any of the functions", async () => {
    for (const call of [
      `match_game_images('${H_ONES}')`,
      `save_photo_hash('${G1}','${H_ONES}')`,
    ]) {
      const code = await withRole("anon", null, fixtures, (c) =>
        pgErrorCode(c.query(`select * from public.${call}`)),
      );
      expect(code, call).toBe("42501");
    }
  });

  it("deleting a game removes its hashes", async () => {
    const n = await withRole(
      "authenticated",
      { sub: B },
      async (c) => {
        await fixtures(c);
        await coverHash(G_B, H_ONES)(c);
        await c.query(`delete from public.games where id = $1`, [G_B]);
      },
      (c) => count(c, "public.game_image_hashes"),
    );
    expect(n).toBe(0);
  });
});
