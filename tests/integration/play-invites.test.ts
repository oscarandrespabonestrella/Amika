import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a"; // owner
const B = "test_user_b"; // friend
const C = "test_user_c"; // friend
const D = "test_user_d"; // not a friend
const G1 = "00000000-0000-4000-8000-0000000000c1"; // catalog game
const G_A = "00000000-0000-4000-8000-0000000000c3"; // A's custom game
const P1 = "00000000-0000-4000-8000-0000000000f1"; // open match
const P2 = "00000000-0000-4000-8000-0000000000f2"; // second match with Xi
const P_MAN = "00000000-0000-4000-8000-0000000000f3"; // match of a custom game
const PP_A = "00000000-0000-4000-8000-0000000000a1";
const PP_B = "00000000-0000-4000-8000-0000000000a2";
const PP_X = "00000000-0000-4000-8000-0000000000a3";
const PP_X2 = "00000000-0000-4000-8000-0000000000a4";
const PL_A = "00000000-0000-4000-8000-0000000000b1";
const PL_B = "00000000-0000-4000-8000-0000000000b2";
const PL_X = "00000000-0000-4000-8000-0000000000b3";

async function fixtures(c: Client) {
  await c.query(
    `insert into public.profiles (id, display_name) values ($1,'Ana'),($2,'Bo'),($3,'Cy'),($4,'Di')`,
    [A, B, C, D],
  );
  await c.query(
    `insert into public.games (id, name, source, kind) values ($1,'Catán','bgg','base')`,
    [G1],
  );
  await c.query(
    `insert into public.games (id, name, source, owner_id) values ($1,'A Secret','manual',$2)`,
    [G_A, A],
  );
  await c.query(
    `insert into public.friendships (user_a, user_b) values
       (least($1::text,$2::text), greatest($1::text,$2::text)),
       (least($1::text,$3::text), greatest($1::text,$3::text))`,
    [A, B, C],
  );
  await c.query(
    `insert into public.plays (id, created_by, owner_id, game_id, played_on, status) values
       ($1,$4,$4,$5,'2026-11-01','open'), ($2,$4,$4,$5,'2026-11-02','closed'),
       ($3,$4,$4,$6,'2026-11-03','open')`,
    [P1, P2, P_MAN, A, G1, G_A],
  );
  await c.query(
    `insert into public.players (id, owner_id, name) values ($1,$4,'Ana'),($2,$4,'Bo'),($3,$4,'Xi')`,
    [PL_A, PL_B, PL_X, A],
  );
  await c.query(
    `insert into public.play_participants (id, play_id, seat, player_id) values
       ($1,$5,0,$6), ($2,$5,1,$7), ($3,$5,2,$8), ($4,$9,0,$8)`,
    [PP_A, PP_B, PP_X, PP_X2, P1, PL_A, PL_B, PL_X, P2],
  );
}

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

const attempt = async (c: Client, sql: string, params: unknown[] = []) => {
  await c.query("savepoint attempt");
  const code = await pgErrorCode(c.query(sql, params));
  await c.query("rollback to savepoint attempt");
  return code;
};
const invite = (c: Client, play: string, friend: string, seat: number) =>
  c.query<{ id: string }>(
    "select public.invite_to_play($1,$2,$3::smallint) id",
    [play, friend, seat],
  );
const count = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query<{ n: number }>(`select count(*)::int n from ${sql}`, params))
    .rows[0].n;
const respond = (c: Client, member: string, accept: boolean) =>
  c.query("select public.respond_play_invite($1,$2)", [member, accept]);

describe.skipIf(!hasDb)("play invitations", () => {
  it("solo el dueño invita y solo a amigos", async () => {
    const r = await run(async (c, as) => {
      const notFriend = await attempt(
        c,
        "select public.invite_to_play($1,$2,1::smallint)",
        [P1, D],
      );
      await as(B);
      const notOwner = await attempt(
        c,
        "select public.invite_to_play($1,$2,1::smallint)",
        [P1, C],
      );
      return { notFriend, notOwner };
    });
    expect(r).toEqual({ notFriend: "PI001", notOwner: "42501" });
  });

  it("no se invita a una partida de un juego manual ni cerrada ni dos veces", async () => {
    const r = await run(async (c) => {
      const manual = await attempt(
        c,
        "select public.invite_to_play($1,$2,0::smallint)",
        [P_MAN, B],
      );
      const closed = await attempt(
        c,
        "select public.invite_to_play($1,$2,0::smallint)",
        [P2, B],
      );
      await invite(c, P1, B, 1);
      const twice = await attempt(
        c,
        "select public.invite_to_play($1,$2,1::smallint)",
        [P1, B],
      );
      return { manual, closed, twice };
    });
    expect(r).toEqual({ manual: "PI002", closed: "PI005", twice: "PI003" });
  });

  it("aceptar da acceso de lectura", async () => {
    const r = await run(async (c, as) => {
      const member = (await invite(c, P1, B, 1)).rows[0].id;
      await as(B);
      const before = await count(c, "public.plays where id = $1", [P1]);
      await respond(c, member, true);
      return {
        before,
        after: await count(c, "public.plays where id = $1", [P1]),
      };
    });
    expect(r).toEqual({ before: 0, after: 1 });
  });

  it("rechazar deja el nombre suelto y el dueño ve declined", async () => {
    const r = await run(async (c, as) => {
      const member = (await invite(c, P1, B, 1)).rows[0].id;
      await as(B);
      await respond(c, member, false);
      await as(A);
      return {
        status: (
          await c.query(
            `select status from public.play_members where id = $1`,
            [member],
          )
        ).rows[0].status,
        person: (
          await c.query(
            `select user_id, display_name from public.play_participants where id = $1`,
            [PP_B],
          )
        ).rows[0],
      };
    });
    expect(r).toEqual({
      status: "declined",
      person: { user_id: null, display_name: "Bo" },
    });
  });

  it("list_my_invites no expone participantes ni puntos", async () => {
    const r = await run(async (c, as) => {
      await invite(c, P1, B, 1);
      await as(B);
      return c.query("select * from public.list_my_invites()");
    });
    expect(r.fields.map((f) => f.name)).toEqual([
      "member_id",
      "play_id",
      "game_name",
      "invited_by_name",
      "invited_at",
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].game_name).toBe("Catán");
    expect(r.rows[0].invited_by_name).toBe("Ana");
  });

  it("salir conserva la partida para los demás", async () => {
    const r = await run(async (c, as) => {
      const member = (await invite(c, P1, B, 1)).rows[0].id;
      await as(B);
      await respond(c, member, true);
      await c.query("select public.leave_play($1)", [P1]);
      const mine = await count(c, "public.plays where id = $1", [P1]);
      await as(A);
      return {
        mine,
        owner: await count(c, "public.plays where id = $1", [P1]),
      };
    });
    expect(r).toEqual({ mine: 0, owner: 1 });
  });

  it("el tope de 12 miembros por partida", async () => {
    const code = await run(async (c) => {
      await c.query("reset role");
      await c.query(
        `insert into public.profiles (id) select 'bulk_' || g from generate_series(1, 11) g`,
      );
      await c.query(
        `insert into public.play_members (play_id, user_id, status, invited_by)
         select $1, 'bulk_' || g, 'accepted', $2 from generate_series(1, 11) g`,
        [P1, A],
      );
      await c.query("set local role authenticated");
      return attempt(c, "select public.invite_to_play($1,$2,1::smallint)", [
        P1,
        B,
      ]);
    });
    expect(code).toBe("P0001");
  });
});

describe.skipIf(!hasDb)("shared saving and linking", () => {
  const savePayload = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      playId: P1,
      gameId: G1,
      playedOn: "2026-11-01",
      notes: "edited",
      expansionIds: [],
      participants: [
        { seat: 0, playerId: PL_A, name: "Ana", scores: { military: 1 } },
        { seat: 1, playerId: PL_B, name: "Bo", scores: { military: 2 } },
        { seat: 2, playerId: PL_X, name: "Xi", scores: {} },
      ],
      ...extra,
    });

  it("save_play del dueño no borra los puntos que escribió un invitado", async () => {
    const r = await run(async (c, as) => {
      const member = (await invite(c, P1, B, 1)).rows[0].id;
      await as(B);
      await respond(c, member, true);
      await c.query(`select public.save_my_scores($1,$2::jsonb)`, [
        P1,
        JSON.stringify({ military: 7, bonus: 3 }),
      ]);
      await as(A);
      await c.query(`select public.save_play($1::jsonb)`, [
        savePayload({
          participants: [
            { seat: 0, playerId: PL_A, name: "Ana", scores: { military: 1 } },
            { seat: 1, playerId: PL_B, name: "Bo", scores: { military: 2 } },
            { seat: 2, playerId: PL_X, name: "Xi", scores: {} },
          ],
        }),
      ]);
      return (
        await c.query(
          `select category_key, value from public.play_scores
            where participant_id = $1 order by 1`,
          [PP_B],
        )
      ).rows;
    });
    // the owner's payload overrides what it mentions, but never deletes the rest
    expect(r).toEqual([
      { category_key: "bonus", value: 3 },
      { category_key: "military", value: 2 },
    ]);
  });

  it("save_my_scores no escribe en la columna de otro ni en una partida cerrada", async () => {
    const r = await run(async (c, as) => {
      const member = (await invite(c, P1, B, 1)).rows[0].id;
      await as(B);
      await respond(c, member, true);
      const notMine = await attempt(
        c,
        "select public.save_my_scores($1,$2::jsonb)",
        [P2, "{}"],
      );
      await as(A);
      await c.query(`select public.close_play($1,$2::jsonb)`, [
        P1,
        JSON.stringify({ participants: [] }),
      ]);
      await as(B);
      const closed = await attempt(
        c,
        "select public.save_my_scores($1,$2::jsonb)",
        [P1, '{"military":1}'],
      );
      return { notMine, closed };
    });
    expect(r).toEqual({ notMine: "P0002", closed: "PI005" });
  });

  it("close_play fija totales y rechaza más ediciones de miembros", async () => {
    const r = await run(async (c) => {
      await c.query(`select public.close_play($1,$2::jsonb)`, [
        P1,
        JSON.stringify({
          participants: [
            { seat: 0, total: 10, rank: 1, isWinner: true },
            { seat: 1, total: 4, rank: 2, isWinner: false },
          ],
        }),
      ]);
      return {
        status: (
          await c.query(`select status from public.plays where id = $1`, [P1])
        ).rows[0].status,
        people: (
          await c.query(
            `select seat, total_score, rank, is_winner from public.play_participants
              where play_id = $1 and total_score is not null order by seat`,
            [P1],
          )
        ).rows,
      };
    });
    expect(r.status).toBe("closed");
    expect(r.people).toEqual([
      { seat: 0, total_score: 10, rank: 1, is_winner: true },
      { seat: 1, total_score: 4, rank: 2, is_winner: false },
    ]);
  });

  it("vincular crea una sola solicitud agrupada con N partidas; aceptar añade al amigo", async () => {
    const r = await run(async (c, as) => {
      const req = (
        await c.query<{ id: string }>(
          "select public.link_player_to_friend($1,$2) id",
          [PL_X, B],
        )
      ).rows[0].id;
      const again = (
        await c.query<{ id: string }>(
          "select public.link_player_to_friend($1,$2) id",
          [PL_X, B],
        )
      ).rows[0].id;
      await as(B);
      const listed = (
        await c.query(
          "select owner_name, player_name, plays from public.list_my_link_requests()",
        )
      ).rows;
      const added = (
        await c.query<{ n: number }>(
          "select public.respond_player_link($1, true) n",
          [req],
        )
      ).rows[0].n;
      const seen = await count(c, "public.plays");
      const linked = (
        await c.query(
          `select user_id from public.play_participants where id = $1`,
          [PP_X],
        )
      ).rows[0].user_id;
      return { same: req === again, listed, added, seen, linked };
    });
    expect(r.same).toBe(true);
    expect(r.listed).toEqual([
      { owner_name: "Ana", player_name: "Xi", plays: 2 },
    ]);
    expect(r.added).toBe(2);
    expect(r.seen).toBe(2);
    expect(r.linked).toBe(B);
  });

  it("rechazar la vinculación no cambia nada y no se vincula a un no amigo", async () => {
    const r = await run(async (c, as) => {
      const notFriend = await attempt(
        c,
        "select public.link_player_to_friend($1,$2)",
        [PL_X, D],
      );
      const req = (
        await c.query<{ id: string }>(
          "select public.link_player_to_friend($1,$2) id",
          [PL_X, B],
        )
      ).rows[0].id;
      await as(B);
      await c.query("select public.respond_player_link($1, false)", [req]);
      return { notFriend, seen: await count(c, "public.plays") };
    });
    expect(r).toEqual({ notFriend: "PI001", seen: 0 });
  });

  it("deshacer la vinculación no borra partidas", async () => {
    const r = await run(async (c, as) => {
      const req = (
        await c.query<{ id: string }>(
          "select public.link_player_to_friend($1,$2) id",
          [PL_X, B],
        )
      ).rows[0].id;
      await as(B);
      await c.query("select public.respond_player_link($1, true)", [req]);
      await as(A);
      await c.query("select public.unlink_player($1)", [PL_X]);
      const owner = await count(c, "public.plays");
      await as(B);
      return { owner, friend: await count(c, "public.plays") };
    });
    expect(r).toEqual({ owner: 3, friend: 0 });
  });

  it("un cliente no puede vincular a un amigo por su cuenta", async () => {
    const code = await run((c) =>
      attempt(
        c,
        `update public.players set linked_user_id = $2 where id = $1`,
        [PL_X, B],
      ),
    );
    expect(code).not.toBeNull();
  });
});

describe.skipIf(!hasDb)("delete passes the match to the others", () => {
  const accept = async (
    c: Client,
    as: (sub: string) => Promise<void>,
    friend: string,
    seat: number,
  ) => {
    const member = (await invite(c, P1, friend, seat)).rows[0].id;
    await as(friend);
    await respond(c, member, true);
    await as(A);
  };

  it("borrar con miembros traspasa al más antiguo", async () => {
    const r = await run(async (c, as) => {
      await accept(c, as, B, 1);
      await accept(c, as, C, 2);
      await c.query("select public.delete_play($1)", [P1]);
      const gone = await count(c, "public.plays where id = $1", [P1]);
      await as(B);
      const owner = (
        await c.query(`select owner_id from public.plays where id = $1`, [P1])
      ).rows[0]?.owner_id;
      // the new owner can edit it: its participants now belong to B's roster
      const mine = await count(
        c,
        `public.play_participants pp join public.players pl on pl.id = pp.player_id
          where pp.play_id = $1 and pl.owner_id = $2`,
        [P1, B],
      );
      await as(C);
      return {
        gone,
        owner,
        mine,
        cSees: await count(c, "public.plays where id = $1", [P1]),
      };
    });
    expect(r).toEqual({ gone: 0, owner: B, mine: 3, cSees: 1 });
  });

  it("borrar sin miembros elimina la partida", async () => {
    const left = await run(async (c) => {
      await c.query("select public.delete_play($1)", [P1]);
      return count(c, "public.plays where id = $1", [P1]);
    });
    expect(left).toBe(0);
  });

  it("solo el dueño puede borrar la partida", async () => {
    const code = await run(async (c, as) => {
      await accept(c, as, B, 1);
      await as(B);
      return attempt(c, "select public.delete_play($1)", [P1]);
    });
    expect(code).toBe("42501");
  });

  it("transfer_or_delete_plays deja intactas las partidas con otros miembros y permite borrar la cuenta", async () => {
    const r = await run(async (c, as) => {
      await accept(c, as, B, 1);
      await c.query("reset role");
      await c.query("select public.transfer_or_delete_plays($1)", [A]);
      await c.query("delete from public.profiles where id = $1", [A]); // no FK blocks it
      await c.query("set local role authenticated");
      await as(B);
      return {
        p1: await count(c, "public.plays where id = $1", [P1]),
        p2: await count(c, "public.plays where id = $1", [P2]),
      };
    });
    expect(r).toEqual({ p1: 1, p2: 0 });
  });
});
