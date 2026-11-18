import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";
const G = "00000000-0000-4000-8000-0000000000f1";

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1)`, [A]);
  await c.query(
    `insert into public.games (id, name, source) values ($1,'Budget Game','bgg')`,
    [G],
  );
}

/** A failing statement aborts the whole transaction: isolate it in a savepoint. */
async function failsWith(c: Client, run: () => Promise<unknown>) {
  await c.query("savepoint attempt");
  const code = await pgErrorCode(run());
  await c.query(
    code ? "rollback to savepoint attempt" : "release savepoint attempt",
  );
  return code;
}

const asA = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("authenticated", { sub: A }, fixtures, fn);
const asAnon = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("anon", null, fixtures, fn);

describe.skipIf(!hasDb)("manual search cache: service-role only", () => {
  it("neither signed-in nor anonymous users can read or write it", async () => {
    for (const run of [asA, asAnon]) {
      expect(
        await run((c) =>
          failsWith(c, () =>
            c.query("select * from public.manual_search_cache"),
          ),
        ),
      ).toBe("42501");
      expect(
        await run((c) =>
          failsWith(c, () =>
            c.query(
              `insert into public.manual_search_cache (game_id, outcome) values ($1,'not_found')`,
              [G],
            ),
          ),
        ),
      ).toBe("42501");
    }
  });

  it("stores one row per game, validates its shape, and goes away with the game", async () => {
    const result = await withRole(
      "authenticated",
      { sub: A },
      fixtures,
      async (c) => {
        await c.query("reset role"); // the app writes it with the service role
        await c.query(
          `insert into public.manual_search_cache (game_id, outcome, results)
           values ($1,'results','[{"url":"https://a.example/x.pdf"}]')`,
          [G],
        );
        const duplicate = await failsWith(c, () =>
          c.query(
            `insert into public.manual_search_cache (game_id, outcome) values ($1,'not_found')`,
            [G],
          ),
        );
        const badOutcome = await failsWith(c, () =>
          c.query(
            `update public.manual_search_cache set outcome = 'maybe' where game_id = $1`,
            [G],
          ),
        );
        const notAnArray = await failsWith(c, () =>
          c.query(
            `update public.manual_search_cache set results = '{}'::jsonb where game_id = $1`,
            [G],
          ),
        );
        await c.query(`delete from public.games where id = $1`, [G]);
        const left = (await c.query("select 1 from public.manual_search_cache"))
          .rowCount;
        return { duplicate, badOutcome, notAnArray, left };
      },
    );
    expect(result).toEqual({
      duplicate: "23505",
      badOutcome: "23514",
      notAnArray: "23514",
      left: 0,
    });
  });
});

describe.skipIf(!hasDb)("manual_requests: api_call kind", () => {
  it("accepts search, download and api_call, and nothing else", async () => {
    const result = await withRole(
      "authenticated",
      { sub: A },
      fixtures,
      async (c) => {
        await c.query("reset role");
        for (const kind of ["search", "download", "api_call"])
          await c.query(
            `insert into public.manual_requests (user_id, kind) values ($1,$2)`,
            [A, kind],
          );
        const unknown = await failsWith(c, () =>
          c.query(
            `insert into public.manual_requests (user_id, kind) values ($1,'other')`,
            [A],
          ),
        );
        const monthly = (
          await c.query(
            `select count(*)::int n from public.manual_requests
             where kind = 'api_call' and created_at >= date_trunc('month', now() at time zone 'utc')`,
          )
        ).rows[0].n;
        return { unknown, monthly };
      },
    );
    expect(result.unknown).toBe("23514");
    expect(result.monthly).toBeGreaterThanOrEqual(1);
  });
});
