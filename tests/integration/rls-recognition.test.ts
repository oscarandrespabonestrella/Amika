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

describe.skipIf(!hasDb)("retired image hashes (migration 0017)", () => {
  it("the table and every function of the old picture-hash search are gone", async () => {
    const present = await asA(async (c) => {
      const rows = await q<{ name: string; found: string | null }>(
        c,
        `select n as name, coalesce(to_regclass(n)::text, to_regprocedure(n)::text) as found
           from unnest(array[
             'public.game_image_hashes',
             'public.match_game_images(text,integer,integer)',
             'public.save_photo_hash(uuid,text)',
             'public.upsert_cover_hash(uuid,text)',
             'public.hex_to_hash(text)'
           ]) as n`,
      );
      return rows.filter((r) => r.found !== null).map((r) => r.name);
    });
    expect(present).toEqual([]);
  });

  it("game_barcodes is untouched", async () => {
    const rows = await asA((c) =>
      q<{ n: string | null }>(
        c,
        "select to_regclass('public.game_barcodes')::text as n",
      ),
    );
    expect(rows[0].n).toBe("game_barcodes");
  });
});
