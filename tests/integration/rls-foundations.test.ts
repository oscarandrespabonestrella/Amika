import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

// Distinct prefix so fixtures can never collide with real Clerk ids (user_...).
const A = "test_user_a"; // admin
const B = "test_user_b";

async function fixtures(c: Client) {
  await c.query(
    `insert into public.profiles (id, display_name) values ($1, 'Alice'), ($2, 'Bob')`,
    [A, B],
  );
  await c.query(
    `insert into public.user_roles (user_id, role) values ($1, 'admin')`,
    [A],
  );
}

const asA = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("authenticated", { sub: A }, fixtures, fn);
const asB = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("authenticated", { sub: B }, fixtures, fn);
const asAnon = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("anon", null, fixtures, fn);

describe.skipIf(!hasDb)("RLS: profiles", () => {
  it("a user only sees their own profile", async () => {
    const rows = await asA(
      async (c) => (await c.query("select id from public.profiles")).rows,
    );
    expect(rows).toEqual([{ id: A }]);
  });

  it("a user cannot insert a profile for someone else", async () => {
    const code = await asA((c) =>
      pgErrorCode(
        c.query(`insert into public.profiles (id) values ('test_user_x')`),
      ),
    );
    expect(code).toBe("42501");
  });

  it("a user can create their own profile, id defaults to the JWT sub", async () => {
    const id = await withRole(
      "authenticated",
      { sub: "test_user_new" },
      async () => undefined,
      async (c) =>
        (
          await c.query(
            "insert into public.profiles default values returning id",
          )
        ).rows[0].id,
    );
    expect(id).toBe("test_user_new");
  });

  it("a user cannot update someone else's profile", async () => {
    const count = await asA(
      async (c) =>
        (
          await c.query(
            `update public.profiles set display_name = 'hacked' where id = $1`,
            [B],
          )
        ).rowCount,
    );
    expect(count).toBe(0);
  });

  it("a user cannot change their own id to impersonate another", async () => {
    const code = await asA((c) =>
      pgErrorCode(
        c.query(`update public.profiles set id = $2 where id = $1`, [
          A,
          "test_user_z",
        ]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("a user can update their own profile and updated_at advances", async () => {
    // now() is constant inside a transaction, so start from an explicit old timestamp.
    const oldFixtures = async (c: Client) => {
      await c.query(
        `insert into public.profiles (id, display_name, updated_at) values ($1, 'Alice', '2020-01-01')`,
        [A],
      );
    };
    const row = await withRole(
      "authenticated",
      { sub: A },
      oldFixtures,
      async (c) => {
        const before = (
          await c.query(
            `select updated_at from public.profiles where id = $1`,
            [A],
          )
        ).rows[0].updated_at as Date;
        const after = (
          await c.query(
            `update public.profiles set display_name = 'Alice 2', theme = 'dark' where id = $1
           returning display_name, theme, updated_at`,
            [A],
          )
        ).rows[0];
        return { before, after };
      },
    );
    expect(row.after.display_name).toBe("Alice 2");
    expect(row.after.theme).toBe("dark");
    expect(row.after.updated_at.getTime()).toBeGreaterThan(
      row.before.getTime(),
    );
  });

  it("a user cannot delete someone else's profile", async () => {
    const count = await asB(
      async (c) =>
        (await c.query(`delete from public.profiles where id = $1`, [A]))
          .rowCount,
    );
    expect(count).toBe(0);
  });

  it("anonymous users have no access", async () => {
    const code = await asAnon((c) =>
      pgErrorCode(c.query("select * from public.profiles")),
    );
    expect(code).toBe("42501");
  });

  it("rejects invalid theme and locale values", async () => {
    const theme = await asA((c) =>
      pgErrorCode(
        c.query(`update public.profiles set theme = 'neon' where id = $1`, [A]),
      ),
    );
    const locale = await asA((c) =>
      pgErrorCode(
        c.query(`update public.profiles set locale = 'english' where id = $1`, [
          A,
        ]),
      ),
    );
    expect(theme).toBe("23514");
    expect(locale).toBe("23514");
  });
});

describe.skipIf(!hasDb)("RLS: user_roles and is_admin()", () => {
  it("a user sees only their own roles", async () => {
    const a = await asA(
      async (c) =>
        (await c.query("select user_id from public.user_roles")).rows,
    );
    const b = await asB(
      async (c) =>
        (await c.query("select user_id from public.user_roles")).rows,
    );
    expect(a).toEqual([{ user_id: A }]);
    expect(b).toEqual([]);
  });

  it("nobody can grant themselves a role", async () => {
    const code = await asB((c) =>
      pgErrorCode(
        c.query(
          `insert into public.user_roles (user_id, role) values ($1, 'admin')`,
          [B],
        ),
      ),
    );
    expect(code).toBe("42501");
  });

  it("an admin cannot write roles through the API either", async () => {
    const code = await asA((c) =>
      pgErrorCode(
        c.query(`delete from public.user_roles where user_id = $1`, [A]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("is_admin() is true for admins only", async () => {
    const a = await asA(
      async (c) => (await c.query("select public.is_admin() as v")).rows[0].v,
    );
    const b = await asB(
      async (c) => (await c.query("select public.is_admin() as v")).rows[0].v,
    );
    expect(a).toBe(true);
    expect(b).toBe(false);
  });

  it("is_admin() is not callable by anonymous users", async () => {
    const code = await asAnon((c) =>
      pgErrorCode(c.query("select public.is_admin()")),
    );
    expect(code).toBe("42501");
  });
});
