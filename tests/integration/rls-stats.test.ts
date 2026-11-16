import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";
const B = "test_user_b";
const G1 = "00000000-0000-4000-8000-0000000000a1";
const G2 = "00000000-0000-4000-8000-0000000000a2";
const G3 = "00000000-0000-4000-8000-0000000000a3"; // no matches
const ME = "00000000-0000-4000-8000-0000000000b1"; // A's "Me" (linked to A)
const ANA = "00000000-0000-4000-8000-0000000000b2";
const BO = "00000000-0000-4000-8000-0000000000b3";
const CY = "00000000-0000-4000-8000-0000000000b4"; // never played
const DEE = "00000000-0000-4000-8000-0000000000b5"; // only played without "me"
const B_ME = "00000000-0000-4000-8000-0000000000b6";
const B_ANA = "00000000-0000-4000-8000-0000000000b7";
const pl = (n: number) => `00000000-0000-4000-8000-0000000000c${n}`;

/**
 * A's matches on G1 (chronological by played_on, created_at):
 *  1  2026-01-01 30 min   Me 10 (1st, wins) · Ana 4
 *  2  2026-01-02 60 min   Me 8 · Ana 8 (tie: both win) · Bo 3
 *  3  2026-01-02 (none)   Me – · Ana –          (nobody has a score)
 *  4  2026-01-03          Me -5 · Ana -2 (Ana wins)  (negative totals)
 *  5  2026-01-04          Dee 5 (wins) · Bo 1       (without "me")
 * G2: 6  Me 3 · Bo 3 (tie). B has a match of their own on G1.
 */
async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2)`, [A, B]);
  await c.query(
    `insert into public.games (id, name, source, kind) values
       ($1,'Catán','bgg','base'),($2,'Azul','bgg','base'),($3,'Zanzíbar','bgg','base')`,
    [G1, G2, G3],
  );
  await c.query(
    `insert into public.players (id, owner_id, name, linked_user_id) values
       ($1,$8,'Me',$8), ($2,$8,'Ana',null), ($3,$8,'Bo',null), ($4,$8,'Cy',null),
       ($5,$8,'Dee',null), ($6,$9,'B me',$9), ($7,$9,'Ana',null)`,
    [ME, ANA, BO, CY, DEE, B_ME, B_ANA, A, B],
  );
  const plays: [number, string, string, string, number | null, number][] = [
    [1, A, G1, "2026-01-01", 30, 1],
    [2, A, G1, "2026-01-02", 60, 2],
    [3, A, G1, "2026-01-02", null, 3],
    [4, A, G1, "2026-01-03", null, 4],
    [5, A, G1, "2026-01-04", null, 5],
    [6, A, G2, "2026-01-05", null, 6],
    [7, B, G1, "2026-01-06", null, 7],
  ];
  for (const [n, by, game, day, dur, minute] of plays)
    await c.query(
      `insert into public.plays (id, created_by, game_id, played_on, duration_minutes, created_at)
       values ($1,$2,$3,$4,$5, timestamptz '2026-02-01 00:00:00+00' + make_interval(mins => $6))`,
      [pl(n), by, game, day, dur, minute],
    );
  // [play, seat, player, total, rank, winner]
  const rows: [
    number,
    number,
    string,
    number | null,
    number | null,
    boolean,
  ][] = [
    [1, 0, ME, 10, 1, true],
    [1, 1, ANA, 4, 2, false],
    [2, 0, ME, 8, 1, true],
    [2, 1, ANA, 8, 1, true],
    [2, 2, BO, 3, 3, false],
    [3, 0, ME, null, null, false],
    [3, 1, ANA, null, null, false],
    [4, 0, ME, -5, 2, false],
    [4, 1, ANA, -2, 1, true],
    [5, 0, DEE, 5, 1, true],
    [5, 1, BO, 1, 2, false],
    [6, 0, ME, 3, 1, true],
    [6, 1, BO, 3, 1, true],
    [7, 0, B_ME, 9, 1, true],
    [7, 1, B_ANA, 2, 2, false],
  ];
  for (const [n, seat, player, total, rank, win] of rows)
    await c.query(
      `insert into public.play_participants (play_id, seat, player_id, total_score, rank, is_winner)
       values ($1,$2,$3,$4,$5,$6)`,
      [pl(n), seat, player, total, rank, win],
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

type GS = {
  name: string;
  plays: number;
  scored_plays: number;
  wins: number;
  avg_score: string | null;
  best_score: number | null;
};

describe.skipIf(!hasDb)("game_stats", () => {
  it("counts plays, scored plays, wins (a tie counts for all), average and best", async () => {
    const rows = await asA((c) =>
      q<GS>(c, "select * from public.game_stats($1)", [G1]),
    );
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.Me).toMatchObject({ plays: 4, scored_plays: 3, wins: 2 });
    expect(Number(by.Me.avg_score)).toBeCloseTo(13 / 3, 5); // (10 + 8 - 5) / 3
    expect(by.Me.best_score).toBe(10);
    expect(by.Ana).toMatchObject({ plays: 4, scored_plays: 3, wins: 2 });
    expect(Number(by.Ana.avg_score)).toBeCloseTo(10 / 3, 5); // (4 + 8 - 2) / 3
    expect(by.Ana.best_score).toBe(8);
    expect(by.Bo).toMatchObject({ plays: 2, scored_plays: 2, wins: 0 });
    expect(by.Dee).toMatchObject({ plays: 1, wins: 1, best_score: 5 });
    expect(by.Cy).toBeUndefined(); // never played this game
  });

  it("a player with only unscored matches has null average and best, no wins", async () => {
    const rows = await asA(
      (c) => q<GS>(c, "select * from public.game_stats($1)", [G1]),
      (c) =>
        c
          .query(
            `update public.play_participants set total_score = null, rank = null, is_winner = false
             where player_id = '${BO}'`,
          )
          .then(() => undefined),
    );
    const bo = rows.find((r) => r.name === "Bo")!;
    expect(bo).toMatchObject({ plays: 2, scored_plays: 0, wins: 0 });
    expect(bo.avg_score).toBeNull();
    expect(bo.best_score).toBeNull();
  });

  it("is ordered by wins, then scored plays, then name", async () => {
    const rows = await asA((c) =>
      q<GS>(c, "select * from public.game_stats($1)", [G1]),
    );
    expect(rows.map((r) => r.name)).toEqual(["Ana", "Me", "Dee", "Bo"]);
  });

  it("returns nothing for a game with no matches, a foreign game or a random id", async () => {
    for (const id of [G3, "00000000-0000-4000-8000-00000000ffff"])
      expect(
        await asA((c) => q(c, "select * from public.game_stats($1)", [id])),
      ).toEqual([]);
    // B only sees their own match of G1
    const b = await asB((c) =>
      q<GS>(c, "select * from public.game_stats($1)", [G1]),
    );
    expect(b.map((r) => r.name).sort()).toEqual(["Ana", "B me"]);
  });

  it("follows a merge: the merged player's numbers add up, under one id", async () => {
    const rows = await asA(
      (c) => q<GS>(c, "select * from public.game_stats($1)", [G1]),
      // Cy never played, so merging Cy into Dee changes nothing; merge Dee into Cy.
      (c) =>
        c
          .query("select public.merge_players($1,$2)", [CY, DEE])
          .then(() => undefined),
    );
    expect(rows.find((r) => r.name === "Dee")).toBeUndefined();
    expect(rows.find((r) => r.name === "Cy")).toMatchObject({
      plays: 1,
      wins: 1,
    });
  });
});

describe.skipIf(!hasDb)("game_summary", () => {
  it("counts matches, averages only the recorded durations, gives the date range", async () => {
    const [s] = await asA((c) =>
      q<Record<string, string | number | null>>(
        c,
        "select plays, avg_duration_minutes, first_played_on::text, last_played_on::text from public.game_summary($1)",
        [G1],
      ),
    );
    expect(s.plays).toBe(5);
    expect(Number(s.avg_duration_minutes)).toBe(45);
    expect(String(s.first_played_on)).toContain("2026-01-01");
    expect(String(s.last_played_on)).toContain("2026-01-04");
  });

  it("is zeros/nulls (one row) for a game without matches", async () => {
    const [s] = await asA((c) =>
      q<Record<string, unknown>>(c, "select * from public.game_summary($1)", [
        G3,
      ]),
    );
    expect(s).toMatchObject({
      plays: 0,
      avg_duration_minutes: null,
      first_played_on: null,
      last_played_on: null,
    });
  });
});

type SP = {
  seq: number;
  play_id: string;
  name: string;
  total: number;
  played_on: string;
};

describe.skipIf(!hasDb)("game_score_series", () => {
  it("lists scored participants in chronological order with seq per match", async () => {
    const rows = await asA((c) =>
      q<SP>(
        c,
        "select * from public.game_score_series($1) order by seq, name",
        [G1],
      ),
    );
    // Match 3 has no scores, so it produces no rows but still occupies a seq.
    expect(rows.map((r) => [r.seq, r.name, r.total])).toEqual([
      [1, "Ana", 4],
      [1, "Me", 10],
      [2, "Ana", 8],
      [2, "Bo", 3],
      [2, "Me", 8],
      [4, "Ana", -2],
      [4, "Me", -5],
      [5, "Bo", 1],
      [5, "Dee", 5],
    ]);
  });

  it("is limited to the latest p_limit matches, numbered from 1", async () => {
    const rows = await asA((c) =>
      q<SP>(
        c,
        "select * from public.game_score_series($1, 2) order by seq, name",
        [G1],
      ),
    );
    // Latest 2 matches are #4 and #5 (match 3 is unscored but counts as a match).
    expect(rows.map((r) => [r.seq, r.name])).toEqual([
      [1, "Ana"],
      [1, "Me"],
      [2, "Bo"],
      [2, "Dee"],
    ]);
  });

  it("clamps the limit to 200 and floors it at 1", async () => {
    const big = await asA((c) =>
      q(c, "select * from public.game_score_series($1, 100000)", [G1]),
    );
    expect(big).toHaveLength(9);
    const low = await asA((c) =>
      q<SP>(c, "select * from public.game_score_series($1, 0)", [G1]),
    );
    expect(new Set(low.map((r) => r.seq))).toEqual(new Set([1]));
  });

  it("never returns another user's matches", async () => {
    const rows = await asB((c) =>
      q<SP>(c, "select * from public.game_score_series($1)", [G1]),
    );
    expect(rows.map((r) => r.name).sort()).toEqual(["Ana", "B me"]);
  });
});

describe.skipIf(!hasDb)("personal statistics", () => {
  it("my_overview: record of the 'me' player", async () => {
    const [o] = await asA((c) =>
      q<Record<string, unknown>>(c, "select * from public.my_overview()"),
    );
    expect(o).toMatchObject({
      me_player_id: ME,
      plays: 5, // matches 1,2,3,4 on G1 and 6 on G2
      scored_plays: 4,
      wins: 3,
      games_played: 2,
    });
  });

  it("my_overview without 'me' is zeros with a null player", async () => {
    const [o] = await asA(
      (c) =>
        q<Record<string, unknown>>(c, "select * from public.my_overview()"),
      (c) =>
        c
          .query(
            `update public.players set linked_user_id = null where id = $1`,
            [ME],
          )
          .then(() => undefined),
    );
    expect(o).toMatchObject({
      me_player_id: null,
      plays: 0,
      scored_plays: 0,
      wins: 0,
      games_played: 0,
    });
    const rivals = await asA(
      (c) => q(c, "select * from public.head_to_head()"),
      (c) =>
        c
          .query(
            `update public.players set linked_user_id = null where id = $1`,
            [ME],
          )
          .then(() => undefined),
    );
    expect(rivals).toEqual([]);
  });

  it("my_top_games: most played first, with my wins", async () => {
    const rows = await asA((c) =>
      q<{ name: string; plays: number; wins: number }>(
        c,
        "select * from public.my_top_games()",
      ),
    );
    expect(rows.map((r) => [r.name, r.plays, r.wins])).toEqual([
      ["Catán", 4, 2],
      ["Azul", 1, 1],
    ]);
    const one = await asA((c) => q(c, "select * from public.my_top_games(1)"));
    expect(one).toHaveLength(1);
  });

  it("head_to_head: only matches where both have a rank; ties are ties; absent rivals absent", async () => {
    const rows = await asA((c) =>
      q<{
        name: string;
        plays_together: number;
        my_wins: number;
        their_wins: number;
        ties: number;
      }>(c, "select * from public.head_to_head()"),
    );
    // Ana: matches 1 (me), 2 (tie), 4 (her) — match 3 has no ranks.
    // Bo: match 2 (me, 1 vs 3) and 6 (tie). Dee and Cy never shared a match with me.
    expect(
      rows.map((r) => [
        r.name,
        r.plays_together,
        r.my_wins,
        r.their_wins,
        r.ties,
      ]),
    ).toEqual([
      ["Ana", 3, 1, 1, 1],
      ["Bo", 2, 1, 0, 1],
    ]);
  });

  it("another user's data never leaks, and each user has their own 'me'", async () => {
    const [o] = await asB((c) =>
      q<Record<string, unknown>>(c, "select * from public.my_overview()"),
    );
    expect(o).toMatchObject({ me_player_id: B_ME, plays: 1, wins: 1 });
    const rivals = await asB((c) =>
      q<{ name: string }>(c, "select * from public.head_to_head()"),
    );
    expect(rivals.map((r) => r.name)).toEqual(["Ana"]);
  });

  it("follows a merge: head-to-head adds up under the kept player", async () => {
    const rows = await asA(
      (c) =>
        q<{ name: string; plays_together: number }>(
          c,
          "select * from public.head_to_head()",
        ),
      // Cy never played: merging Ana into Cy keeps the numbers under Cy's id and name.
      (c) =>
        c
          .query("select public.merge_players($1,$2)", [CY, ANA])
          .then(() => undefined),
    );
    expect(rows.find((r) => r.name === "Ana")).toBeUndefined();
    expect(rows.find((r) => r.name === "Cy")?.plays_together).toBe(3);
  });
});

describe.skipIf(!hasDb)("statistics functions: access", () => {
  const calls = [
    "game_stats('" + G1 + "')",
    "game_summary('" + G1 + "')",
    "game_score_series('" + G1 + "')",
    "my_overview()",
    "my_top_games()",
    "head_to_head()",
  ];
  it("anon cannot execute any of them", async () => {
    for (const call of calls) {
      const code = await withRole("anon", null, fixtures, (c) =>
        pgErrorCode(c.query(`select * from public.${call}`)),
      );
      expect(code, call).toBe("42501");
    }
  });
});
