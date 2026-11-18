import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";
const B = "test_user_b";
const PL_ANA = "00000000-0000-4000-8000-0000000000d1"; // A's "Ana"
const PL_BO = "00000000-0000-4000-8000-0000000000d2"; // A's "Bo"
const PL_B_ANA = "00000000-0000-4000-8000-0000000000d3"; // B's "Ana"
const G_THU = "00000000-0000-4000-8000-0000000000e1"; // A's "Jueves": Ana + Bo
const G_FAM = "00000000-0000-4000-8000-0000000000e2"; // A's "Familia": Bo
const G_B = "00000000-0000-4000-8000-0000000000e3"; // B's "Jueves"

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2)`, [A, B]);
  await c.query(
    `insert into public.players (id, owner_id, name) values ($1,$4,'Ana'),($2,$4,'Bo'),($3,$5,'Ana')`,
    [PL_ANA, PL_BO, PL_B_ANA, A, B],
  );
  await c.query(
    `insert into public.player_groups (id, owner_id, name) values ($1,$4,'Jueves'),($2,$4,'Familia'),($3,$5,'Jueves')`,
    [G_THU, G_FAM, G_B, A, B],
  );
  await c.query(
    `insert into public.player_group_members (group_id, player_id) values ($1,$3),($1,$4),($2,$4)`,
    [G_THU, G_FAM, PL_ANA, PL_BO],
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
const asAnon = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("anon", null, fixtures, fn);

const ids = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query<{ id: string }>(sql, params)).rows.map((r) => r.id).sort();
const members = async (c: Client, group: string) =>
  ids(
    c,
    `select player_id::text as id from public.player_group_members where group_id = $1`,
    [group],
  );

describe.skipIf(!hasDb)("RLS: player groups", () => {
  it("owner sees only own groups", async () => {
    expect(
      await asA((c) => ids(c, `select id::text from public.player_groups`)),
    ).toEqual([G_THU, G_FAM].sort());
    expect(
      await asB((c) => ids(c, `select id::text from public.player_groups`)),
    ).toEqual([G_B]);
  });

  it("owner sees only the memberships of own groups", async () => {
    expect(await asA((c) => members(c, G_THU))).toEqual([PL_ANA, PL_BO].sort());
    expect(await asB((c) => members(c, G_THU))).toEqual([]);
  });

  it("anon sees nothing", async () => {
    const code = await asAnon((c) =>
      pgErrorCode(c.query(`select id from public.player_groups`)),
    );
    expect(code).toBe("42501");
  });

  it("group name is unique per owner after normalization", async () => {
    const code = await asA((c) =>
      pgErrorCode(
        c.query(`insert into public.player_groups (name) values ('jueves ')`),
      ),
    );
    expect(code).toBe("23505");
  });

  it("another owner can use the same group name", async () => {
    const code = await asB((c) =>
      pgErrorCode(
        c.query(`insert into public.player_groups (name) values ('Familia')`),
      ),
    );
    expect(code).toBeNull();
  });

  it("a member must be a player of the same owner", async () => {
    const code = await asA((c) =>
      pgErrorCode(
        c.query(
          `insert into public.player_group_members (group_id, player_id) values ($1,$2)`,
          [G_FAM, PL_B_ANA],
        ),
      ),
    );
    expect(code).not.toBeNull();
  });

  it("B cannot add members to A's group", async () => {
    const code = await asB((c) =>
      pgErrorCode(
        c.query(
          `insert into public.player_group_members (group_id, player_id) values ($1,$2)`,
          [G_FAM, PL_B_ANA],
        ),
      ),
    );
    expect(code).not.toBeNull();
  });

  it("B cannot rename or delete A's group", async () => {
    await asB(async (c) => {
      const renamed = await c.query(
        `update public.player_groups set name = 'X' where id = $1`,
        [G_THU],
      );
      const deleted = await c.query(
        `delete from public.player_groups where id = $1`,
        [G_THU],
      );
      expect(renamed.rowCount).toBe(0);
      expect(deleted.rowCount).toBe(0);
    });
  });

  it("deleting a player removes only the membership", async () => {
    await asA(async (c) => {
      await c.query(`delete from public.players where id = $1`, [PL_BO]);
      expect(await members(c, G_THU)).toEqual([PL_ANA]);
      expect(await ids(c, `select id::text from public.player_groups`)).toEqual(
        [G_THU, G_FAM].sort(),
      );
    });
  });

  it("deleting a group keeps the players", async () => {
    await asA(async (c) => {
      await c.query(`delete from public.player_groups where id = $1`, [G_THU]);
      expect(await ids(c, `select id::text from public.players`)).toEqual(
        [PL_ANA, PL_BO].sort(),
      );
    });
  });

  it("merge_players moves memberships without duplicating", async () => {
    await asA(async (c) => {
      await c.query(`select public.merge_players($1, $2)`, [PL_ANA, PL_BO]);
      // "Jueves" had both: now only Ana. "Familia" had only Bo: now Ana.
      expect(await members(c, G_THU)).toEqual([PL_ANA]);
      expect(await members(c, G_FAM)).toEqual([PL_ANA]);
    });
  });

  it("a user cannot have more than 50 groups", async () => {
    const code = await asA(
      (c) =>
        pgErrorCode(
          c.query(`insert into public.player_groups (name) values ('Uno más')`),
        ),
      async (c) => {
        await c.query(
          `insert into public.player_groups (owner_id, name)
           select $1, 'Grupo ' || g from generate_series(1, 48) g`,
          [A],
        );
      },
    );
    expect(code).toBe("P0001");
  });
});
