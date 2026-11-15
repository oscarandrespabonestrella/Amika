import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";
const B = "test_user_b";
const G1 = "00000000-0000-4000-8000-0000000000e1"; // global
const G2 = "00000000-0000-4000-8000-0000000000e2"; // global
const G_B = "00000000-0000-4000-8000-0000000000e3"; // B's custom game

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2)`, [A, B]);
  await c.query(
    `insert into public.games (id, name, source, min_players, max_players) values
       ($1,'Catán','bgg',3,4), ($2,'Zombicide','bgg',1,6)`,
    [G1, G2],
  );
  await c.query(
    `insert into public.games (id, name, source, owner_id) values ($1,'Bob Secret','manual',$2)`,
    [G_B, B],
  );
  await c.query(
    `insert into public.library_items (user_id, game_id, status, is_favorite, rating) values
       ($1,$3,'owned',true,9), ($1,$4,'previously_owned',false,null), ($2,$3,'owned',false,5)`,
    [A, B, G1, G2],
  );
}

const asA = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("authenticated", { sub: A }, fixtures, fn);
const asB = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("authenticated", { sub: B }, fixtures, fn);
const asAnon = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("anon", null, fixtures, fn);

const names = async (c: Client, args: unknown[]) =>
  (
    await c.query("select name from public.search_library($1,$2,$3)", args)
  ).rows.map((r) => r.name as string);

describe.skipIf(!hasDb)("RLS: library_items", () => {
  it("a user only sees their own library", async () => {
    const a = await asA(async (c) =>
      (await c.query("select game_id from public.library_items")).rows
        .map((r) => r.game_id)
        .sort(),
    );
    expect(a).toEqual([G1, G2].sort());
    const b = await asB(
      async (c) =>
        (await c.query("select user_id from public.library_items")).rows,
    );
    expect(b).toEqual([{ user_id: B }]);
  });

  it("anonymous users have no access", async () => {
    expect(
      await asAnon((c) =>
        pgErrorCode(c.query("select * from public.library_items")),
      ),
    ).toBe("42501");
  });

  it("user_id defaults to the signed-in user and cannot be spoofed", async () => {
    const owner = await withRole(
      "authenticated",
      { sub: A },
      async (c) => {
        await c.query(`insert into public.profiles (id) values ($1)`, [A]);
        await c.query(
          `insert into public.games (id, name, source) values ($1,'X','bgg')`,
          [G1],
        );
      },
      async (c) =>
        (
          await c.query(
            `insert into public.library_items (game_id, status) values ($1,'owned') returning user_id`,
            [G1],
          )
        ).rows[0].user_id,
    );
    expect(owner).toBe(A);

    const spoof = await asA((c) =>
      pgErrorCode(
        c.query(
          `insert into public.library_items (user_id, game_id, status) values ($1,$2,'owned')`,
          [B, G_B],
        ),
      ),
    );
    expect(spoof).toBe("42501");
  });

  it("cannot add a game the user cannot see (another user's custom game)", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.library_items (game_id, status) values ($1,'owned')`,
            [G_B],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("a game can be added once per user", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.library_items (game_id, status) values ($1,'owned')`,
            [G1],
          ),
        ),
      ),
    ).toBe("23505");
  });

  it("rejects the wishlist status (not offered yet)", async () => {
    const code = await asB((c) =>
      pgErrorCode(
        c.query(
          `insert into public.library_items (game_id, status) values ($1,'wishlist')`,
          [G2],
        ),
      ),
    );
    expect(code).toBe("23514");
  });

  it("validates rating (1-10) and notes length", async () => {
    const rating = (value: number) =>
      asA((c) =>
        pgErrorCode(
          c.query(
            `update public.library_items set rating = $1 where game_id = $2`,
            [value, G1],
          ),
        ),
      );
    expect(await rating(0)).toBe("23514");
    expect(await rating(11)).toBe("23514");
    expect(await rating(10)).toBeNull();
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `update public.library_items set notes = $1 where game_id = $2`,
            ["x".repeat(2001), G1],
          ),
        ),
      ),
    ).toBe("23514");
  });

  it("a user can update and delete only their own items", async () => {
    const result = await asA(async (c) => ({
      own: (
        await c.query(
          `update public.library_items set is_favorite = false where game_id = $1`,
          [G1],
        )
      ).rowCount,
      deleted: (
        await c.query(`delete from public.library_items where game_id = $1`, [
          G2,
        ])
      ).rowCount,
    }));
    expect(result).toEqual({ own: 1, deleted: 1 });

    // B's row for G1 is not reachable by A (RLS filters it out): rowCount counts only A's own.
    const bStill = await withRole(
      "authenticated",
      { sub: A },
      fixtures,
      async (c) => {
        await c.query(
          `update public.library_items set status = 'previously_owned' where game_id = $1`,
          [G1],
        );
        await c.query("reset role");
        return (
          await c.query(
            `select status from public.library_items where user_id = $1 and game_id = $2`,
            [B, G1],
          )
        ).rows[0].status;
      },
    );
    expect(bStill).toBe("owned");
  });

  it("cannot move an item to another user", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `update public.library_items set user_id = $1 where game_id = $2`,
            [B, G1],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("deleting a game removes it from every library (cascade)", async () => {
    const left = await withRole(
      "authenticated",
      { sub: A },
      fixtures,
      async (c) => {
        await c.query("reset role");
        await c.query(`delete from public.games where id = $1`, [G1]);
        return (
          await c.query(
            `select count(*)::int as n from public.library_items where game_id = $1`,
            [G1],
          )
        ).rows[0].n;
      },
    );
    expect(left).toBe(0);
  });

  it("deleting a profile removes their library", async () => {
    const left = await withRole(
      "authenticated",
      { sub: A },
      fixtures,
      async (c) => {
        await c.query("reset role");
        await c.query(`delete from public.profiles where id = $1`, [A]);
        return (
          await c.query(
            `select count(*)::int as n from public.library_items where user_id = $1`,
            [A],
          )
        ).rows[0].n;
      },
    );
    expect(left).toBe(0);
  });
});

describe.skipIf(!hasDb)("search_library()", () => {
  it("lists only the caller's library, ordered by name", async () => {
    expect(await asA((c) => names(c, [null, null, null]))).toEqual([
      "Catán",
      "Zombicide",
    ]);
    expect(await asB((c) => names(c, [null, null, null]))).toEqual(["Catán"]);
  });

  it("filters by status and favorites", async () => {
    expect(await asA((c) => names(c, [null, "owned", null]))).toEqual([
      "Catán",
    ]);
    expect(
      await asA((c) => names(c, [null, "previously_owned", null])),
    ).toEqual(["Zombicide"]);
    expect(await asA((c) => names(c, [null, null, true]))).toEqual(["Catán"]);
    expect(await asA((c) => names(c, [null, null, false]))).toEqual([
      "Catán",
      "Zombicide",
    ]); // false = no filter
  });

  it("matches names ignoring accents and case, and treats wildcards literally", async () => {
    expect(await asA((c) => names(c, ["CATAN", null, null]))).toEqual([
      "Catán",
    ]);
    expect(await asA((c) => names(c, ["zomb", null, null]))).toEqual([
      "Zombicide",
    ]);
    expect(await asA((c) => names(c, ["%", null, null]))).toEqual([]);
  });

  it("is not callable anonymously", async () => {
    expect(
      await asAnon((c) =>
        pgErrorCode(c.query("select * from public.search_library()")),
      ),
    ).toBe("42501");
  });
});
