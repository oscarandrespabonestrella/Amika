import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a"; // host
const B = "test_user_b"; // friend
const C = "test_user_c"; // stranger
const N1 = "00000000-0000-4000-8000-000000001301";
const G_OWNED = "00000000-0000-4000-8000-000000001311"; // owned base 2-4 players, 60 min
const G_EXP = "00000000-0000-4000-8000-000000001312"; // owned expansion
const G_PREV = "00000000-0000-4000-8000-000000001313"; // previously owned
const NG1 = "00000000-0000-4000-8000-000000001321"; // night game of G_OWNED
const PL_A = "00000000-0000-4000-8000-000000001331";
const P1 = "00000000-0000-4000-8000-000000001341";
const P2 = "00000000-0000-4000-8000-000000001342";

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2),($3)`, [
    A,
    B,
    C,
  ]);
  await c.query(
    `insert into public.friendships (user_a, user_b) values (least($1::text,$2::text), greatest($1::text,$2::text))`,
    [A, B],
  );
  await c.query(
    `insert into public.games (id, name, source, kind, min_players, max_players, min_playtime, max_playtime) values
       ($1,'Owned','bgg','base',2,4,60,60),
       ($2,'Expansion','bgg','expansion',2,4,30,30),
       ($3,'Previous','bgg','base',2,4,30,30)`,
    [G_OWNED, G_EXP, G_PREV],
  );
  await c.query(
    `insert into public.library_items (user_id, game_id, status) values
       ($1,$2,'owned'), ($1,$3,'owned'), ($1,$4,'previously_owned')`,
    [A, G_OWNED, G_EXP, G_PREV],
  );
  await c.query(
    `insert into public.game_nights (id, owner_id, title, starts_on) values ($1,$2,'Jueves','2099-01-01')`,
    [N1, A],
  );
  await c.query(
    `insert into public.game_night_games (id, night_id, game_id, added_by, source, name_snapshot)
     values ($1,$2,$3,$4,'host','Owned')`,
    [NG1, N1, G_OWNED, A],
  );
  await c.query(
    `insert into public.players (id, owner_id, name) values ($1,$2,'Ana')`,
    [PL_A, A],
  );
  await c.query(
    `insert into public.plays (id, created_by, owner_id, game_id, played_on, status) values
       ($1,$3,$3,$4,'2026-09-01','closed'), ($2,$3,$3,$4,'2026-10-01','closed')`,
    [P1, P2, A, G_OWNED],
  );
  await c.query(
    `insert into public.play_participants (play_id, seat, player_id, user_id, display_name) values
       ($1,0,$3,$4,'Ana'), ($2,0,$3,$4,'Ana')`,
    [P1, P2, PL_A, A],
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
const asC = as(C);

const accept = (status: string) => async (c: Client) => {
  await c.query(
    `insert into public.game_night_members (night_id, user_id, status) values ($1,$2,$3)`,
    [N1, B, status],
  );
};

const nightIds = async (c: Client) =>
  (await c.query<{ id: string }>(`select id::text from public.game_nights`))
    .rows;

describe.skipIf(!hasDb)("RLS: game nights", () => {
  it("owner sees own nights only", async () => {
    expect(await asA(nightIds)).toHaveLength(1);
    expect(await asC(nightIds)).toEqual([]);
  });

  it("invited but not accepted cannot read", async () => {
    expect(await asB(nightIds, accept("invited"))).toEqual([]);
  });

  it("accepted friend reads night, games, votes", async () => {
    const res = await asB(async (c) => {
      const nights = await nightIds(c);
      const games = await c.query(`select id from public.game_night_games`);
      const members = await c.query(
        `select user_id from public.game_night_members`,
      );
      return { nights, games: games.rows, members: members.rows };
    }, accept("accepted"));
    expect(res.nights).toHaveLength(1);
    expect(res.games).toHaveLength(1);
    expect(res.members).toHaveLength(1);
  });

  it("ex-friend loses access", async () => {
    const rows = await asB(nightIds, async (c) => {
      await accept("accepted")(c);
      await c.query(`delete from public.friendships`);
    });
    expect(rows).toEqual([]);
  });

  it("members cannot write votes directly", async () => {
    const code = await asB(
      (c) =>
        pgErrorCode(
          c.query(
            `insert into public.game_night_votes (night_game_id, user_id) values ($1,$2)`,
            [NG1, B],
          ),
        ),
      accept("accepted"),
    );
    expect(code).toBe("42501");
  });

  it("twelfth game ok, thirteenth fails", async () => {
    const res = await asA(
      async (c) => {
        const insert = (n: number) =>
          c.query(
            `insert into public.game_night_games (night_id, game_id, added_by, source, name_snapshot)
             select $1, id, $2, 'host', 'x' from public.games where name = $3`,
            [N1, A, `Extra ${n}`],
          );
        await insert(11); // 12th game of the night
        const code = await pgErrorCode(insert(12)); // 13th
        return code;
      },
      async (c) => {
        await c.query(
          `insert into public.games (name, source, kind)
           select 'Extra ' || n, 'bgg', 'base' from generate_series(1, 12) n`,
        );
        await c.query(
          `insert into public.game_night_games (night_id, game_id, added_by, source, name_snapshot)
           select $1, id, $2, 'host', 'x' from public.games where name in
             (select 'Extra ' || n from generate_series(1, 10) n)`,
          [N1, A],
        );
      },
    );
    expect(res).toBe("GN004");
  });

  const fillTo19 = async (c: Client) => {
    await c.query(
      `insert into public.game_nights (owner_id, title, starts_on)
       select $1, 'n' || n, '2099-03-01' from generate_series(1, 18) n`,
      [A],
    );
  };

  it("twenty-first open night fails", async () => {
    // fixtures already hold 1 open night; 18 more make 19; the 20th is ok, the 21st fails
    const code = await asA(async (c) => {
      await c.query(
        `insert into public.game_nights (owner_id, title, starts_on) values ($1,'20th','2099-02-01')`,
        [A],
      );
      return pgErrorCode(
        c.query(
          `insert into public.game_nights (owner_id, title, starts_on) values ($1,'21st','2099-02-01')`,
          [A],
        ),
      );
    }, fillTo19);
    expect(code).toBe("GN004");
  });

  it("reopening an expired night via starts_on at the cap fails", async () => {
    const code = await asA(
      (c) =>
        pgErrorCode(
          c.query(
            `update public.game_nights set starts_on = '2099-05-01' where title = 'old'`,
          ),
        ),
      async (c) => {
        await fillTo19(c);
        await c.query(
          `insert into public.game_nights (owner_id, title, starts_on) values ($1,'20th','2099-02-01'), ($1,'old','2020-01-01')`,
          [A],
        );
      },
    );
    expect(code).toBe("GN004");
  });

  it("editing an expired night at the cap is allowed", async () => {
    const code = await asA(
      (c) =>
        pgErrorCode(
          c.query(
            `update public.game_nights set starts_on = '2020-01-02' where title = 'old'`,
          ),
        ),
      async (c) => {
        await fillTo19(c);
        await c.query(
          `insert into public.game_nights (owner_id, title, starts_on) values ($1,'20th','2099-02-01'), ($1,'old','2020-01-01')`,
          [A],
        );
      },
    );
    expect(code).toBeNull();
  });

  it("night_is_open false after starts_on + 2 days", async () => {
    const res = await asA(async (c) => {
      const isOpen = async () =>
        (
          await c.query<{ o: boolean }>(
            `select public.night_is_open(n) o from public.game_nights n where id = $1`,
            [N1],
          )
        ).rows[0].o;
      const open = await isOpen();
      await c.query(
        `update public.game_nights set starts_on = current_date - 3 where id = $1`,
        [N1],
      );
      return { open, closed: await isOpen() };
    });
    expect(res).toEqual({ open: true, closed: false });
  });

  it("library removal keeps night game", async () => {
    const left = await asA(async (c) => {
      await c.query(`delete from public.library_items where game_id = $1`, [
        G_OWNED,
      ]);
      return (
        await c.query(`select id from public.game_night_games where id = $1`, [
          NG1,
        ])
      ).rows;
    });
    expect(left).toHaveLength(1);
  });

  it("picker_candidates filters and counts", async () => {
    const res = await asA(async (c) => {
      const fit = await c.query(
        `select *, last_played_on::text as lp from public.picker_candidates(3, 90)`,
      );
      const none = await c.query(
        `select * from public.picker_candidates(5, null)`,
      );
      return { fit: fit.rows, none: none.rows };
    });
    expect(res.fit).toHaveLength(1);
    expect(res.fit[0].game_id).toBe(G_OWNED);
    expect(res.fit[0].play_count).toBe(2);
    expect(res.fit[0].lp).toBe("2026-10-01");
    expect(res.none).toEqual([]);
  });
});
