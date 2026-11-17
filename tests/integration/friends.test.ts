import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";
const B = "test_user_b";
const C = "test_user_c";

async function fixtures(c: Client) {
  await c.query(
    `insert into public.profiles (id, display_name) values ($1,'Ana'),($2,'Bo'),($3,'Cy')`,
    [A, B, C],
  );
}

/** One transaction, several users: switch the JWT subject between statements. */
const run = <T>(
  fn: (c: Client, as: (sub: string) => Promise<void>) => Promise<T>,
) =>
  withRole("authenticated", { sub: A }, fixtures, (c) =>
    fn(c, async (sub) => {
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub, role: "authenticated" }),
      ]);
    }),
  );

const create = async (c: Client) =>
  (await c.query<{ code: string }>("select public.create_friend_invite() code"))
    .rows[0].code;
const redeem = (c: Client, code: string) =>
  c.query<{ id: string }>("select public.redeem_friend_invite($1) id", [code]);
/** The error code of a call that may fail, without aborting the surrounding transaction. */
const attempt = async (c: Client, sql: string, params: unknown[] = []) => {
  await c.query("savepoint attempt");
  const code = await pgErrorCode(c.query(sql, params));
  await c.query("rollback to savepoint attempt");
  return code;
};
const friends = async (c: Client) =>
  (
    await c.query<{ user_id: string; display_name: string }>(
      "select user_id, display_name from public.list_friends() order by 1",
    )
  ).rows;

describe.skipIf(!hasDb)("friends", () => {
  it("redimir crea la amistad en los dos sentidos", async () => {
    const r = await run(async (c, as) => {
      const code = await create(c);
      await as(B);
      const got = (await redeem(c, code)).rows[0].id;
      const forB = await friends(c);
      await as(A);
      return { got, forB, forA: await friends(c) };
    });
    expect(r.got).toBe(A);
    expect(r.forB).toEqual([{ user_id: A, display_name: "Ana" }]);
    expect(r.forA).toEqual([{ user_id: B, display_name: "Bo" }]);
  });

  it("el enlace es de un solo uso", async () => {
    const code = await run(async (c, as) => {
      const code = await create(c);
      await as(B);
      await redeem(c, code);
      await as(C);
      return pgErrorCode(redeem(c, code));
    });
    expect(code).toBe("FR001");
  });

  it("un enlace caducado o revocado no se puede canjear", async () => {
    const r = await run(async (c, as) => {
      const expired = await create(c);
      await c.query("reset role");
      await c.query(
        `update public.friend_invites set expires_at = now() - interval '1 minute' where code = $1`,
        [expired],
      );
      await c.query("set local role authenticated");
      const revoked = await create(c);
      await c.query("select public.revoke_friend_invite($1)", [revoked]);
      await as(B);
      return [
        await attempt(c, "select public.redeem_friend_invite($1)", [expired]),
        await attempt(c, "select public.redeem_friend_invite($1)", [revoked]),
        await attempt(c, "select public.redeem_friend_invite($1)", [
          "no-such-code",
        ]),
      ];
    });
    expect(r).toEqual(["FR001", "FR001", "FR001"]);
  });

  it("no puedes canjear tu propio enlace", async () => {
    const code = await run(async (c) =>
      pgErrorCode(redeem(c, await create(c))),
    );
    expect(code).toBe("FR005");
  });

  it("canjear de nuevo siendo ya amigos devuelve el mismo amigo sin consumir otro", async () => {
    const r = await run(async (c, as) => {
      const first = await create(c);
      const second = await create(c);
      await as(B);
      await redeem(c, first);
      const again = (await redeem(c, second)).rows[0].id;
      return { again, friends: await friends(c) };
    });
    expect(r.again).toBe(A);
    expect(r.friends).toHaveLength(1);
  });

  it("list_friends solo devuelve nombre y avatar de mis amigos", async () => {
    const r = await run(async (c, as) => {
      const cols = (
        await c.query("select * from public.list_friends()")
      ).fields.map((f) => f.name);
      await as(C);
      return { cols, none: await friends(c) };
    });
    expect(r.cols).toEqual(["user_id", "display_name", "avatar_path"]);
    expect(r.none).toEqual([]);
  });

  it("quitar amigo borra la amistad de los dos lados", async () => {
    const r = await run(async (c, as) => {
      const code = await create(c);
      await as(B);
      await redeem(c, code);
      await c.query("select public.remove_friend($1)", [A]);
      const forB = await friends(c);
      await as(A);
      return { forB, forA: await friends(c) };
    });
    expect(r).toEqual({ forB: [], forA: [] });
  });

  it("el tope de 10 enlaces activos", async () => {
    const code = await run(async (c) => {
      for (let i = 0; i < 10; i++) await create(c);
      return pgErrorCode(c.query("select public.create_friend_invite()"));
    });
    expect(code).toBe("FR004");
  });

  it.each(["friend_invites", "friendships"])(
    "un extraño no puede leer %s",
    async (table) => {
      const code = await run(async (c, as) => {
        await create(c);
        await as(C);
        return pgErrorCode(c.query(`select * from public.${table}`));
      });
      expect(code).toBe("42501");
    },
  );
});
