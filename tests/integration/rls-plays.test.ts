import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";
const B = "test_user_b";
const G1 = "00000000-0000-4000-8000-0000000000c1"; // global base game
const GX = "00000000-0000-4000-8000-0000000000c2"; // global expansion
const G_B = "00000000-0000-4000-8000-0000000000c3"; // B's custom game
const S_A = "00000000-0000-4000-8000-0000000000d1"; // A's sheet on G1
const S_B = "00000000-0000-4000-8000-0000000000d2"; // B's sheet on G1
const V_A = "00000000-0000-4000-8000-0000000000e1";
const V_B = "00000000-0000-4000-8000-0000000000e2";
const P_A = "00000000-0000-4000-8000-0000000000f1"; // A's play (uses V_A, expansion GX)
const P_B = "00000000-0000-4000-8000-0000000000f2"; // B's play
const PP_A = "00000000-0000-4000-8000-0000000000a1";
const PP_B = "00000000-0000-4000-8000-0000000000a2";
const DEF = JSON.stringify({
  schemaVersion: 1,
  categories: [{ key: "military", label: "M", type: "number", scoring: true }],
});

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2)`, [A, B]);
  await c.query(
    `insert into public.games (id, name, source, kind) values
       ($1,'Catán','bgg','base'), ($2,'Catán: Seafarers','bgg','expansion')`,
    [G1, GX],
  );
  await c.query(
    `insert into public.games (id, name, source, owner_id) values ($1,'Bob Secret','manual',$2)`,
    [G_B, B],
  );
  await c.query(
    `insert into public.scoring_sheets (id, game_id, owner_id, title, locale) values
       ($1,$3,$4,'A sheet','en'), ($2,$3,$5,'B sheet','en')`,
    [S_A, S_B, G1, A, B],
  );
  await c.query(
    `insert into public.scoring_sheet_versions (id, sheet_id, definition) values ($1,$3,$5),($2,$4,$5)`,
    [V_A, V_B, S_A, S_B, DEF],
  );
  await c.query(
    `insert into public.plays (id, created_by, game_id, played_on, scoring_version_id) values
       ($1,$3,$5,'2026-11-01',$6), ($2,$4,$5,'2026-11-02',null)`,
    [P_A, P_B, A, B, G1, V_A],
  );
  await c.query(
    `insert into public.play_participants (id, play_id, seat, display_name, total_score, rank, is_winner) values
       ($1,$3,0,'Ana',5,1,true), ($2,$4,0,'Bo',null,null,false)`,
    [PP_A, PP_B, P_A, P_B],
  );
  await c.query(
    `insert into public.play_scores (participant_id, category_key, value) values ($1,'military','5'::jsonb)`,
    [PP_A],
  );
  await c.query(
    `insert into public.play_expansions (play_id, game_id) values ($1,$2)`,
    [P_A, GX],
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

const player = (seat: number, name = `P${seat}`) => ({
  seat,
  name,
  total: null,
  rank: null,
  isWinner: false,
  scores: {},
});
const payload = (over: Record<string, unknown> = {}) => ({
  gameId: G1,
  playedOn: "2026-11-16",
  durationMinutes: 60,
  scoringVersionId: V_A,
  notes: "n",
  expansionIds: [GX],
  participants: [
    {
      ...player(0, "Ana"),
      total: 62,
      rank: 1,
      isWinner: true,
      scores: { military: 6 },
    },
    { ...player(1, "Bo"), total: 3, rank: 2 },
  ],
  ...over,
});
const save = (c: Client, p: Record<string, unknown>) =>
  c.query<{ id: string }>("select public.save_play($1::jsonb) as id", [
    JSON.stringify(p),
  ]);
const count = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query<{ n: number }>(`select count(*)::int n from ${sql}`, params))
    .rows[0].n;

describe.skipIf(!hasDb)("RLS: plays", () => {
  it("a user only sees their own plays and children", async () => {
    const a = await asA(async (c) => ({
      plays: (await c.query("select id from public.plays")).rows,
      people: (await c.query("select id from public.play_participants")).rows,
      scores: (await c.query("select participant_id from public.play_scores"))
        .rows,
      expansions: (await c.query("select play_id from public.play_expansions"))
        .rows,
    }));
    expect(a).toEqual({
      plays: [{ id: P_A }],
      people: [{ id: PP_A }],
      scores: [{ participant_id: PP_A }],
      expansions: [{ play_id: P_A }],
    });
    const b = await asB(async (c) => ({
      plays: (await c.query("select id from public.plays")).rows,
      expansions: (await c.query("select play_id from public.play_expansions"))
        .rows,
    }));
    expect(b).toEqual({ plays: [{ id: P_B }], expansions: [] });
  });

  it("anonymous users have no access, tables or save_play", async () => {
    for (const table of [
      "plays",
      "play_participants",
      "play_scores",
      "play_expansions",
    ])
      expect(
        await asAnon((c) =>
          pgErrorCode(c.query(`select * from public.${table}`)),
        ),
        table,
      ).toBe("42501");
    expect(await asAnon((c) => pgErrorCode(save(c, payload())))).toBe("42501");
  });

  it("created_by defaults to the caller and cannot be spoofed", async () => {
    const owner = await asA(
      async (c) =>
        (
          await c.query(
            `insert into public.plays (game_id) values ($1) returning created_by`,
            [G1],
          )
        ).rows[0].created_by,
    );
    expect(owner).toBe(A);
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.plays (game_id, created_by) values ($1,$2)`,
            [G1, B],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("cannot log a match for a game the user cannot see", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(`insert into public.plays (game_id) values ($1)`, [G_B]),
        ),
      ),
    ).toBe("42501");
    expect(
      await asB((c) =>
        pgErrorCode(
          c.query(`insert into public.plays (game_id) values ($1)`, [G_B]),
        ),
      ),
    ).toBeNull();
  });

  it("cannot reference another user's sheet version; own or none is fine", async () => {
    const insert = (version: string | null) => (c: Client) =>
      pgErrorCode(
        c.query(
          `insert into public.plays (game_id, scoring_version_id) values ($1,$2)`,
          [G1, version],
        ),
      );
    expect(await asA(insert(V_B))).toBe("42501");
    expect(await asA(insert(V_A))).toBeNull();
    expect(await asA(insert(null))).toBeNull();
  });
});

describe.skipIf(!hasDb)("save_play", () => {
  it("creates a play with participants, scores and expansions atomically", async () => {
    const result = await asA(async (c) => {
      const id = (await save(c, payload())).rows[0].id;
      const play = (
        await c.query(
          `select created_by, game_id, played_on::text, duration_minutes, scoring_version_id, notes
             from public.plays where id = $1`,
          [id],
        )
      ).rows[0];
      return {
        play,
        people: (
          await c.query(
            `select seat, display_name, total_score, rank, is_winner
               from public.play_participants where play_id = $1 order by seat`,
            [id],
          )
        ).rows,
        scores: await count(
          c,
          `public.play_scores s join public.play_participants p on p.id = s.participant_id where p.play_id = $1`,
          [id],
        ),
        expansions: await count(
          c,
          `public.play_expansions where play_id = $1`,
          [id],
        ),
      };
    });
    expect(result.play).toEqual({
      created_by: A,
      game_id: G1,
      played_on: "2026-11-16",
      duration_minutes: 60,
      scoring_version_id: V_A,
      notes: "n",
    });
    expect(result.people).toEqual([
      {
        seat: 0,
        display_name: "Ana",
        total_score: 62,
        rank: 1,
        is_winner: true,
      },
      {
        seat: 1,
        display_name: "Bo",
        total_score: 3,
        rank: 2,
        is_winner: false,
      },
    ]);
    expect(result.scores).toBe(1);
    expect(result.expansions).toBe(1);
  });

  it("a bad child rolls everything back: no orphan play (13th participant)", async () => {
    const result = await asA(async (c) => {
      await c.query("savepoint s");
      const code = await pgErrorCode(
        save(
          c,
          payload({
            participants: Array.from({ length: 13 }, (_, i) => player(i)),
          }),
        ),
      );
      await c.query("rollback to savepoint s");
      return { code, plays: await count(c, "public.plays") };
    });
    expect(result).toEqual({ code: "P0001", plays: 1 }); // only the fixture play
  });

  it("rejects a version the caller cannot see and a game the caller cannot see", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(save(c, payload({ scoringVersionId: V_B }))),
      ),
    ).toBe("42501");
    expect(
      await asA((c) => pgErrorCode(save(c, payload({ gameId: G_B })))),
    ).toBe("42501");
  });

  it("an expansion child must be an expansion", async () => {
    expect(
      await asA((c) => pgErrorCode(save(c, payload({ expansionIds: [G1] })))),
    ).toBe("42501");
  });

  it("with playId it replaces the children and keeps the stored sheet version", async () => {
    const result = await asA(async (c) => {
      const id = (await save(c, payload())).rows[0].id;
      await save(
        c,
        payload({
          playId: id,
          scoringVersionId: null, // ignored on update
          gameId: G_B, // ignored on update
          notes: "edited",
          expansionIds: [],
          participants: [
            { ...player(0, "Solo"), total: 9, rank: 1, isWinner: true },
          ],
        }),
      );
      return {
        play: (
          await c.query(
            `select game_id, scoring_version_id, notes from public.plays where id = $1`,
            [id],
          )
        ).rows[0],
        people: (
          await c.query(
            `select display_name from public.play_participants where play_id = $1`,
            [id],
          )
        ).rows,
        scores: await count(
          c,
          `public.play_scores s join public.play_participants p on p.id = s.participant_id where p.play_id = $1`,
          [id],
        ),
        expansions: await count(
          c,
          `public.play_expansions where play_id = $1`,
          [id],
        ),
      };
    });
    expect(result.play).toEqual({
      game_id: G1,
      scoring_version_id: V_A,
      notes: "edited",
    });
    expect(result.people).toEqual([{ display_name: "Solo" }]);
    expect(result.scores).toBe(0);
    expect(result.expansions).toBe(0);
  });

  it("on someone else's play it raises P0002", async () => {
    expect(
      await asA((c) => pgErrorCode(save(c, payload({ playId: P_B })))),
    ).toBe("P0002");
  });
});

describe.skipIf(!hasDb)("play constraints and caps", () => {
  const insertPerson = (extra: string, params: unknown[]) => (c: Client) =>
    pgErrorCode(
      c.query(
        `insert into public.play_participants (play_id, seat, display_name, total_score, rank) values ${extra}`,
        params,
      ),
    );

  it("seat, name, total and rank are range-checked (23514)", async () => {
    expect(await asA(insertPerson(`($1,12,'x',null,null)`, [P_A]))).toBe(
      "23514",
    );
    expect(await asA(insertPerson(`($1,1,'',null,null)`, [P_A]))).toBe("23514");
    expect(
      await asA(insertPerson(`($1,1,$2,null,null)`, [P_A, "x".repeat(61)])),
    ).toBe("23514");
    expect(await asA(insertPerson(`($1,1,'x',2000000000,null)`, [P_A]))).toBe(
      "23514",
    );
    expect(await asA(insertPerson(`($1,1,'x',1,0)`, [P_A]))).toBe("23514");
    expect(await asA(insertPerson(`($1,1,'x',1,1)`, [P_A]))).toBeNull();
  });

  it("a duplicate seat is refused (23505)", async () => {
    expect(await asA(insertPerson(`($1,0,'dup',null,null)`, [P_A]))).toBe(
      "23505",
    );
  });

  it("score keys and value sizes are checked (23514)", async () => {
    const insert = (key: string, value: string) =>
      asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.play_scores (participant_id, category_key, value) values ($1,$2,$3::jsonb)`,
            [PP_A, key, value],
          ),
        ),
      );
    expect(await insert("Bad Key", "1")).toBe("23514");
    expect(await insert("ok_key", JSON.stringify("x".repeat(600)))).toBe(
      "23514",
    );
    expect(await insert("ok_key", "1")).toBeNull();
  });

  it("a user cannot write children of someone else's play", async () => {
    expect(await asA(insertPerson(`($1,5,'sneaky',null,null)`, [P_B]))).toBe(
      "42501",
    );
  });

  it("the 13th participant of a play is refused by the cap (P0001)", async () => {
    // 12 people already (seats 0..11); the 13th has to reuse a seat. The cap trigger
    // fires before the unique index, so the answer is the cap, not 23505.
    const code = await asA(
      insertPerson(`($1,11,'thirteen',null,null)`, [P_A]),
      async (c) => {
        await c.query(
          `insert into public.play_participants (play_id, seat, display_name)
         select $1, g, 'p' || g from generate_series(1, 11) g`,
          [P_A],
        );
      },
    );
    expect(code).toBe("P0001");
  });

  it("the 21st expansion of a play is refused (P0001)", async () => {
    const code = await asA(
      (c) =>
        pgErrorCode(
          c.query(
            `insert into public.play_expansions (play_id, game_id) values ($1,$2)`,
            [P_A, "00000000-0000-4000-8000-0000000099ff"],
          ),
        ),
      async (c) => {
        await c.query(
          `insert into public.games (id, name, source, kind)
           select ('00000000-0000-4000-8000-0000000099' || lpad(to_hex(g), 2, '0'))::uuid, 'x' || g, 'bgg', 'expansion'
             from generate_series(1, 255) g where g <= 19 or g = 255`,
        );
        await c.query(
          `insert into public.play_expansions (play_id, game_id)
           select $1, ('00000000-0000-4000-8000-0000000099' || lpad(to_hex(g), 2, '0'))::uuid
             from generate_series(1, 19) g`,
          [P_A],
        ); // + GX from the fixture = 20
      },
    );
    expect(code).toBe("P0001");
  });

  it("the 5001st play of a user is refused (P0001)", async () => {
    const code = await asA(
      (c) =>
        pgErrorCode(
          c.query(`insert into public.plays (game_id) values ($1)`, [G1]),
        ),
      async (c) => {
        await c.query(
          `insert into public.plays (created_by, game_id) select $1, $2 from generate_series(1, 4999)`,
          [A, G1],
        ); // + the fixture play = 5000
      },
    );
    expect(code).toBe("P0001");
  });
});

describe.skipIf(!hasDb)("ownership and cascades", () => {
  it("a user cannot update or delete another user's play", async () => {
    const result = await asA(async (c) => ({
      updated: (
        await c.query(`update public.plays set notes = 'x' where id = $1`, [
          P_B,
        ])
      ).rowCount,
      deleted: (await c.query(`delete from public.plays where id = $1`, [P_B]))
        .rowCount,
    }));
    expect(result).toEqual({ updated: 0, deleted: 0 });
  });

  it("deleting a play removes its participants, scores and expansions", async () => {
    const left = await asA(async (c) => {
      await c.query(`delete from public.plays where id = $1`, [P_A]);
      await c.query("reset role");
      return {
        people: await count(c, "public.play_participants where play_id = $1", [
          P_A,
        ]),
        scores: await count(c, "public.play_scores where participant_id = $1", [
          PP_A,
        ]),
        expansions: await count(
          c,
          "public.play_expansions where play_id = $1",
          [P_A],
        ),
      };
    });
    expect(left).toEqual({ people: 0, scores: 0, expansions: 0 });
  });

  it("deleting a sheet that has plays is refused (23503); one without plays is deleted", async () => {
    const refused = await asA((c) =>
      pgErrorCode(
        c.query(`delete from public.scoring_sheets where id = $1`, [S_A]),
      ),
    );
    expect(refused).toBe("23503");

    const deleted = await asA(async (c) => {
      const { rows } = await c.query(
        `insert into public.scoring_sheets (game_id, title, locale) values ($1,'Spare','en') returning id`,
        [G1],
      );
      return (
        await c.query(`delete from public.scoring_sheets where id = $1`, [
          rows[0].id,
        ])
      ).rowCount;
    });
    expect(deleted).toBe(1);
  });

  it("deleting a profile cascades cleanly even though its plays reference its own sheet versions", async () => {
    const left = await asA(async (c) => {
      await c.query("reset role");
      await c.query(`delete from public.profiles where id = $1`, [A]);
      return {
        plays: await count(c, "public.plays where created_by = $1", [A]),
        sheets: await count(c, "public.scoring_sheets where owner_id = $1", [
          A,
        ]),
      };
    });
    expect(left).toEqual({ plays: 0, sheets: 0 });
  });

  it("deleting a game cascades its plays and sheets cleanly", async () => {
    const left = await asA(async (c) => {
      await c.query("reset role");
      await c.query(`delete from public.games where id = $1`, [G1]);
      return {
        plays: await count(c, "public.plays where game_id = $1", [G1]),
        sheets: await count(c, "public.scoring_sheets where game_id = $1", [
          G1,
        ]),
      };
    });
    expect(left).toEqual({ plays: 0, sheets: 0 });
  });
});
