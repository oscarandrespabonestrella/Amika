import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a"; // host
const B = "test_user_b"; // friend
const C = "test_user_c"; // stranger
const N1 = "00000000-0000-4000-8000-000000001401";
const G_HOST = "00000000-0000-4000-8000-000000001411"; // in the night, host game
const G_B1 = "00000000-0000-4000-8000-000000001412"; // owned by B
const G_B2 = "00000000-0000-4000-8000-000000001413";
const G_B3 = "00000000-0000-4000-8000-000000001414";
const G_B4 = "00000000-0000-4000-8000-000000001415";
const G_NOT_OWNED = "00000000-0000-4000-8000-000000001416"; // B does not own it
const G_CUSTOM = "00000000-0000-4000-8000-000000001417"; // custom game of B
const NG1 = "00000000-0000-4000-8000-000000001421"; // night game of G_HOST

async function fixtures(c: Client) {
  await c.query(
    `insert into public.profiles (id, display_name) values ($1,'Ana'),($2,'Beto'),($3,'Cris')`,
    [A, B, C],
  );
  await c.query(
    `insert into public.friendships (user_a, user_b) values (least($1::text,$2::text), greatest($1::text,$2::text))`,
    [A, B],
  );
  await c.query(
    `insert into public.games (id, name, source, kind, cover_url) values
       ($1,'Host game','bgg','base','https://example.com/host.jpg'),
       ($2,'B one','bgg','base','https://example.com/b1.jpg'),
       ($3,'B two','bgg','base',null),
       ($4,'B three','bgg','base',null),
       ($5,'B four','bgg','base',null),
       ($6,'Not owned','bgg','base',null)`,
    [G_HOST, G_B1, G_B2, G_B3, G_B4, G_NOT_OWNED],
  );
  await c.query(
    `insert into public.games (id, name, source, owner_id) values ($1,'Custom','manual',$2)`,
    [G_CUSTOM, B],
  );
  await c.query(
    `insert into public.library_items (user_id, game_id, status)
     select $1, g, 'owned' from unnest($2::uuid[]) g`,
    [B, [G_B1, G_B2, G_B3, G_B4, G_CUSTOM]],
  );
  await c.query(
    `insert into public.game_nights (id, owner_id, title, starts_on) values ($1,$2,'Jueves','2099-01-01')`,
    [N1, A],
  );
  await c.query(
    `insert into public.game_night_games (id, night_id, game_id, added_by, source, name_snapshot)
     values ($1,$2,$3,$4,'host','Host game')`,
    [NG1, N1, G_HOST, A],
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

const member = (status: string) => async (c: Client) => {
  await c.query(
    `insert into public.game_night_members (night_id, user_id, status) values ($1,$2,$3)`,
    [N1, B, status],
  );
};
const closeNight = async (c: Client) => {
  await c.query(`update public.game_nights set status = 'closed'`);
};

const invite = (c: Client, friend: string) =>
  c.query(`select public.invite_to_night($1,$2)`, [N1, friend]);
const suggest = (c: Client, game: string) =>
  c.query<{ id: string }>(`select public.suggest_night_game($1,$2) as id`, [
    N1,
    game,
  ]);
const toggle = (c: Client) =>
  c.query<{ v: boolean }>(`select public.toggle_night_vote($1) as v`, [NG1]);

describe.skipIf(!hasDb)("game night friend functions", () => {
  it("invite requires friendship", async () => {
    expect(await asA((c) => pgErrorCode(invite(c, C)))).toBe("GN001");
  });

  it("only owner invites", async () => {
    expect(
      await asB((c) => pgErrorCode(invite(c, C)), member("accepted")),
    ).toBe("42501");
  });

  it("double invite", async () => {
    const code = await asA(async (c) => {
      await invite(c, B);
      return pgErrorCode(invite(c, B));
    });
    expect(code).toBe("GN003");
  });

  it("reinvite after decline", async () => {
    const status = await asA(async (c) => {
      await invite(c, B);
      return (
        await c.query<{ status: string }>(
          `select status from public.game_night_members where user_id = $1`,
          [B],
        )
      ).rows[0].status;
    }, member("declined"));
    expect(status).toBe("invited");
  });

  it("invite to a closed night fails", async () => {
    expect(await asA((c) => pgErrorCode(invite(c, B)), closeNight)).toBe(
      "GN002",
    );
  });

  it("accept then read", async () => {
    const res = await asB(async (c) => {
      const before = await c.query(`select * from public.night_invites()`);
      await c.query(`select public.respond_night_invite($1, true)`, [N1]);
      const nights = await c.query(`select id from public.game_nights`);
      const after = await c.query(`select * from public.night_invites()`);
      return { before: before.rows, nights: nights.rows, after: after.rows };
    }, member("invited"));
    expect(res.before).toHaveLength(1);
    expect(res.before[0].host_name).toBe("Ana");
    expect(res.nights).toHaveLength(1);
    expect(res.after).toEqual([]);
  });

  it("respond without invitation fails", async () => {
    const code = await asB((c) =>
      pgErrorCode(
        c.query(`select public.respond_night_invite($1, true)`, [N1]),
      ),
    );
    expect(code).toBe("P0002");
  });

  it("suggest not owned", async () => {
    expect(
      await asB(
        (c) => pgErrorCode(suggest(c, G_NOT_OWNED)),
        member("accepted"),
      ),
    ).toBe("GN006");
  });

  it("suggest custom game", async () => {
    expect(
      await asB((c) => pgErrorCode(suggest(c, G_CUSTOM)), member("accepted")),
    ).toBe("GN006");
  });

  it("suggest copies snapshots from the catalog", async () => {
    const row = await asB(async (c) => {
      const id = (await suggest(c, G_B1)).rows[0].id;
      return (
        await c.query(
          `select name_snapshot, cover_snapshot, source, added_by
             from public.game_night_games where id = $1`,
          [id],
        )
      ).rows[0];
    }, member("accepted"));
    expect(row).toEqual({
      name_snapshot: "B one",
      cover_snapshot: "https://example.com/b1.jpg",
      source: "suggested",
      added_by: B,
    });
  });

  it("suggest the same game twice", async () => {
    const code = await asB(async (c) => {
      await suggest(c, G_B1);
      return pgErrorCode(suggest(c, G_B1));
    }, member("accepted"));
    expect(code).toBe("GN003");
  });

  it("non member cannot suggest", async () => {
    expect(await asB((c) => pgErrorCode(suggest(c, G_B1)))).toBe("42501");
  });

  it("fourth suggestion", async () => {
    const code = await asB(async (c) => {
      await suggest(c, G_B1);
      await suggest(c, G_B2);
      await suggest(c, G_B3);
      return pgErrorCode(suggest(c, G_B4));
    }, member("accepted"));
    expect(code).toBe("GN004");
  });

  it("toggle vote twice", async () => {
    const res = await asB(async (c) => {
      const first = (await toggle(c)).rows[0].v;
      const mid = (
        await c.query(`select count(*)::int n from public.game_night_votes`)
      ).rows[0].n;
      const second = (await toggle(c)).rows[0].v;
      const end = (
        await c.query(`select count(*)::int n from public.game_night_votes`)
      ).rows[0].n;
      return { first, mid, second, end };
    }, member("accepted"));
    expect(res).toEqual({ first: true, mid: 1, second: false, end: 0 });
  });

  it("host can vote", async () => {
    expect(await asA(async (c) => (await toggle(c)).rows[0].v)).toBe(true);
  });

  it("invited-only user cannot vote", async () => {
    expect(await asB((c) => pgErrorCode(toggle(c)), member("invited"))).toBe(
      "42501",
    );
  });

  it("closed night rejects vote", async () => {
    const code = await asB(
      (c) => pgErrorCode(toggle(c)),
      async (c) => {
        await member("accepted")(c);
        await closeNight(c);
      },
    );
    expect(code).toBe("GN002");
  });

  it("night_votes shows names", async () => {
    const rows = await asB(async (c) => {
      await toggle(c);
      return (await c.query(`select * from public.night_votes($1)`, [N1])).rows;
    }, member("accepted"));
    expect(rows).toEqual([
      { night_game_id: NG1, voter_name: "Beto", is_guest: false },
    ]);
  });

  it("night_votes is for members only", async () => {
    const code = await asB((c) =>
      pgErrorCode(c.query(`select * from public.night_votes($1)`, [N1])),
    );
    expect(code).toBe("42501");
  });

  it("leave keeps votes", async () => {
    const res = await asA(
      async (c) => {
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: B, role: "authenticated" }),
        ]);
        await c.query(`select public.leave_night($1)`, [N1]);
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: A, role: "authenticated" }),
        ]);
        return (
          await c.query(
            `select 1 from public.game_night_votes where user_id = $1`,
            [B],
          )
        ).rowCount;
      },
      async (c) => {
        await member("accepted")(c);
        await c.query(
          `insert into public.game_night_votes (night_game_id, user_id) values ($1,$2)`,
          [NG1, B],
        );
      },
    );
    expect(res).toBe(1);
  });

  it("invite cap of 30 friends", async () => {
    const code = await asA(
      (c) => pgErrorCode(invite(c, B)),
      async (c) => {
        await c.query(
          `insert into public.profiles (id) select 'fill_' || n from generate_series(1, 30) n`,
        );
        await c.query(
          `insert into public.game_night_members (night_id, user_id, status)
           select $1, 'fill_' || n, 'invited' from generate_series(1, 30) n`,
          [N1],
        );
      },
    );
    expect(code).toBe("GN004");
  });
});
