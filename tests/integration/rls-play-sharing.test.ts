import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, withRole } from "./db";

const A = "test_user_a"; // owner
const B = "test_user_b"; // accepted member
const C = "test_user_c"; // invited, not accepted
const D = "test_user_d"; // stranger
const G1 = "00000000-0000-4000-8000-0000000000c1"; // global base game
const G_A = "00000000-0000-4000-8000-0000000000c3"; // A's custom game
const S_A = "00000000-0000-4000-8000-0000000000d1";
const V_A = "00000000-0000-4000-8000-0000000000e1";
const P1 = "00000000-0000-4000-8000-0000000000f1"; // shared play, open
const P_OLD = "00000000-0000-4000-8000-0000000000f2"; // legacy-style play (private)
const PP_A = "00000000-0000-4000-8000-0000000000a1";
const PP_B = "00000000-0000-4000-8000-0000000000a2";
const PL_A = "00000000-0000-4000-8000-0000000000b1";
const PL_B = "00000000-0000-4000-8000-0000000000b2";
const DEF = JSON.stringify({
  schemaVersion: 1,
  categories: [{ key: "military", label: "M", type: "number", scoring: true }],
});

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2),($3),($4)`, [
    A,
    B,
    C,
    D,
  ]);
  await c.query(
    `insert into public.games (id, name, source, kind) values ($1,'Catán','bgg','base')`,
    [G1],
  );
  await c.query(
    `insert into public.games (id, name, source, owner_id) values ($1,'A Secret','manual',$2)`,
    [G_A, A],
  );
  await c.query(
    `insert into public.scoring_sheets (id, game_id, owner_id, title, locale) values ($1,$2,$3,'A sheet','en')`,
    [S_A, G1, A],
  );
  await c.query(
    `insert into public.scoring_sheet_versions (id, sheet_id, definition) values ($1,$2,$3)`,
    [V_A, S_A, DEF],
  );
  await c.query(
    `insert into public.plays (id, created_by, owner_id, game_id, played_on, scoring_version_id, status) values
       ($1,$3,$3,$4,'2026-11-01',$5,'open'), ($2,$3,$3,$4,'2026-10-01',null,'closed')`,
    [P1, P_OLD, A, G1, V_A],
  );
  await c.query(
    `insert into public.players (id, owner_id, name) values ($1,$3,'Ana'), ($2,$3,'Bo')`,
    [PL_A, PL_B, A],
  );
  await c.query(
    `insert into public.play_participants (id, play_id, seat, player_id, user_id, display_name) values
       ($1,$3,0,$5,null,'Ana'), ($2,$3,1,$6,$4,'Bo')`,
    [PP_A, PP_B, P1, B, PL_A, PL_B],
  );
  await c.query(
    `insert into public.play_members (play_id, user_id, status, invited_by) values
       ($1,$2,'accepted',$4), ($1,$3,'invited',$4)`,
    [P1, B, C, A],
  );
  await c.query(
    `insert into public.play_scores (participant_id, category_key, value) values ($1,'military','5'::jsonb)`,
    [PP_A],
  );
}

const as =
  (sub: string) =>
  <T>(fn: (c: Client) => Promise<T>) =>
    withRole("authenticated", { sub }, fixtures, fn);
const asA = as(A);
const asB = as(B);
const asC = as(C);
const asD = as(D);

const n = async (c: Client, sql: string) =>
  (await c.query<{ n: number }>(`select count(*)::int n from ${sql}`)).rows[0]
    .n;
const visible = (c: Client) =>
  Promise.all([
    n(c, "public.plays where id = '" + P1 + "'"),
    n(c, "public.play_participants where play_id = '" + P1 + "'"),
    n(c, "public.play_scores"),
  ]);

describe.skipIf(!hasDb)("RLS: shared plays", () => {
  it("un extraño no ve la partida ni sus participantes ni sus puntos", async () => {
    expect(await asD(visible)).toEqual([0, 0, 0]);
  });

  it("un invitado sin aceptar no ve la partida", async () => {
    expect(await asC(visible)).toEqual([0, 0, 0]);
  });

  it("un miembro aceptado ve la partida, sus participantes y la hoja de esa partida", async () => {
    expect(await asB(visible)).toEqual([1, 2, 1]);
    const sheet = await asB((c) =>
      c.query(`select title, version from public.play_sheet($1)`, [P1]),
    );
    expect(sheet.rows).toEqual([{ title: "A sheet", version: 1 }]);
    // ...but cannot read the sheet tables directly, so it cannot use it for its own matches
    expect(await asB((c) => n(c, "public.scoring_sheet_versions"))).toBe(0);
  });

  it("un invitado sin aceptar y un extraño no obtienen la hoja", async () => {
    for (const run of [asC, asD]) {
      const sheet = await run((c) =>
        c.query(`select 1 from public.play_sheet($1)`, [P1]),
      );
      expect(sheet.rows).toEqual([]);
    }
  });

  it("un miembro no ve las partidas privadas del dueño", async () => {
    expect(await asB((c) => n(c, "public.plays"))).toBe(1);
  });

  it("un miembro aceptado escribe solo sus puntos", async () => {
    const r = await asB(async (c) => {
      const own = await c.query(
        `insert into public.play_scores (participant_id, category_key, value)
         values ($1,'military','7'::jsonb)`,
        [PP_B],
      );
      const other = await c.query(
        `update public.play_scores set value = '99'::jsonb where participant_id = $1`,
        [PP_A],
      );
      return { own: own.rowCount, other: other.rowCount };
    });
    expect(r).toEqual({ own: 1, other: 0 });
  });

  it("un miembro no escribe con la partida cerrada", async () => {
    await expect(
      asB(async (c) => {
        await c.query(`reset role`);
        await c.query(
          `update public.plays set status = 'closed' where id = $1`,
          [P1],
        );
        await c.query(`set local role authenticated`);
        await c.query(
          `insert into public.play_scores (participant_id, category_key, value)
           values ($1,'military','7'::jsonb)`,
          [PP_B],
        );
      }),
    ).rejects.toThrow();
  });

  it("un miembro no modifica la partida ni sus participantes", async () => {
    const r = await asB(async (c) => ({
      play: (
        await c.query(`update public.plays set notes = 'x' where id = $1`, [P1])
      ).rowCount,
      person: (
        await c.query(`delete from public.play_participants where id = $1`, [
          PP_A,
        ])
      ).rowCount,
    }));
    expect(r).toEqual({ play: 0, person: 0 });
  });

  it("el dueño escribe todo mientras está abierta", async () => {
    const r = await asA(async (c) => {
      const s = await c.query(
        `update public.play_scores set value = '6'::jsonb where participant_id = $1`,
        [PP_A],
      );
      const p = await c.query(
        `update public.plays set notes = 'ok' where id = $1`,
        [P1],
      );
      return { s: s.rowCount, p: p.rowCount };
    });
    expect(r).toEqual({ s: 1, p: 1 });
  });

  it("las partidas existentes siguen siendo cerradas y de su creador", async () => {
    const r = await asA((c) =>
      c.query<{ status: string; owner_id: string; created_by: string }>(
        `select status, owner_id, created_by from public.plays where id = $1`,
        [P_OLD],
      ),
    );
    expect(r.rows).toEqual([{ status: "closed", owner_id: A, created_by: A }]);
    expect(
      await asB((c) => n(c, "public.plays where id = '" + P_OLD + "'")),
    ).toBe(0);
  });

  it("el dueño figura como miembro aceptado al crear una partida", async () => {
    const r = await asA((c) =>
      c.query<{ user_id: string; status: string }>(
        `select user_id, status from public.play_members where play_id = $1 and user_id = $2`,
        [P1, A],
      ),
    );
    expect(r.rows).toEqual([{ user_id: A, status: "accepted" }]);
  });

  it("un participante recibe su nombre guardado del jugador", async () => {
    const r = await asA(async (c) => {
      await c.query(`update public.players set name = 'Anita' where id = $1`, [
        PL_A,
      ]);
      return c.query<{ display_name: string }>(
        `select display_name from public.play_participants where id = $1`,
        [PP_A],
      );
    });
    expect(r.rows[0].display_name).toBe("Anita");
  });

  it("nadie escribe directamente en play_members", async () => {
    await expect(
      asA((c) =>
        c.query(
          `insert into public.play_members (play_id, user_id, status) values ($1,$2,'accepted')`,
          [P1, D],
        ),
      ),
    ).rejects.toThrow();
  });
});
