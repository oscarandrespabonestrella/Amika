import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, withRole } from "./db";

const A = "test_user_a"; // owner
const B = "test_user_b"; // accepted guest
const C = "test_user_c"; // stranger
const G1 = "00000000-0000-4000-8000-0000000000c1";
const P1 = "00000000-0000-4000-8000-0000000000f1";
const PP_A = "00000000-0000-4000-8000-0000000000a1";
const PP_B = "00000000-0000-4000-8000-0000000000a2";
const PL_A = "00000000-0000-4000-8000-0000000000b1";
const PL_B = "00000000-0000-4000-8000-0000000000b2";

async function fixtures(c: Client) {
  await c.query(
    `insert into public.profiles (id, display_name) values ($1,'Ana'),($2,'Bo'),($3,'Cy')`,
    [A, B, C],
  );
  await c.query(
    `insert into public.games (id, name, source, kind) values ($1,'Catán','bgg','base')`,
    [G1],
  );
  await c.query(
    `insert into public.plays (id, created_by, owner_id, game_id, played_on, status)
     values ($1,$2,$2,$3,'2026-11-01','closed')`,
    [P1, A, G1],
  );
  await c.query(
    `insert into public.players (id, owner_id, name, linked_user_id)
     values ($1,$3,'Ana',$3), ($2,$3,'Bo',null)`,
    [PL_A, PL_B, A],
  );
  await c.query(
    `insert into public.play_participants (id, play_id, seat, player_id, user_id, total_score, rank, is_winner)
     values ($1,$3,0,$4,null,10,1,true), ($2,$3,1,$5,$6,4,2,false)`,
    [PP_A, PP_B, P1, PL_A, PL_B, B],
  );
  await c.query(
    `insert into public.play_members (play_id, user_id, status, invited_by)
     values ($1,$2,'accepted',$3)`,
    [P1, B, A],
  );
}

const as =
  (sub: string) =>
  <T>(fn: (c: Client) => Promise<T>) =>
    withRole("authenticated", { sub }, fixtures, fn);

describe.skipIf(!hasDb)("statistics with shared matches", () => {
  it("un invitado ve la partida compartida en my_overview", async () => {
    const row = await as(B)(
      async (c) =>
        (await c.query("select * from public.my_overview()")).rows[0],
    );
    expect(row).toMatchObject({
      plays: 1,
      scored_plays: 1,
      wins: 0,
      shared_plays: 1,
    });
    expect(row.me_player_id).toBeNull();
  });

  it("el dueño sigue contando su partida como propia", async () => {
    const row = await as(A)(
      async (c) =>
        (await c.query("select * from public.my_overview()")).rows[0],
    );
    expect(row).toMatchObject({
      me_player_id: PL_A,
      plays: 1,
      wins: 1,
      shared_plays: 0,
    });
  });

  it("head_to_head de un invitado usa el nombre guardado, sin leer players", async () => {
    const rows = await as(B)(
      async (c) =>
        (
          await c.query(
            "select name, my_wins, their_wins from public.head_to_head()",
          )
        ).rows,
    );
    expect(rows).toEqual([{ name: "Ana", my_wins: 0, their_wins: 1 }]);
  });

  it("game_stats y my_top_games funcionan para un invitado", async () => {
    const r = await as(B)(async (c) => ({
      stats: (
        await c.query(
          "select name, plays, wins from public.game_stats($1) order by name",
          [G1],
        )
      ).rows,
      top: (await c.query("select name, plays from public.my_top_games()"))
        .rows,
    }));
    expect(r.stats).toEqual([
      { name: "Ana", plays: 1, wins: 1 },
      { name: "Bo", plays: 1, wins: 0 },
    ]);
    expect(r.top).toEqual([{ name: "Catán", plays: 1 }]);
  });

  it("un extraño no cuenta nada", async () => {
    const r = await as(C)(async (c) => ({
      overview: (await c.query("select plays from public.my_overview()"))
        .rows[0],
      stats: (await c.query("select * from public.game_stats($1)", [G1])).rows,
    }));
    expect(r).toEqual({ overview: { plays: 0 }, stats: [] });
  });
});
