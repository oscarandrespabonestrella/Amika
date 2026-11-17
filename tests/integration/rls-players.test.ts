import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { normalizePlayerName } from "../../src/features/players/normalize";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";
const B = "test_user_b";
const G1 = "00000000-0000-4000-8000-0000000000a1"; // catalog game
const G2 = "00000000-0000-4000-8000-0000000000a2"; // another catalog game
const PL_ANA = "00000000-0000-4000-8000-0000000000b1"; // A's "Ana"
const PL_BO = "00000000-0000-4000-8000-0000000000b2"; // A's "Bo"
const PL_CY = "00000000-0000-4000-8000-0000000000b3"; // A's "Cy" (never played)
const PL_B_ANA = "00000000-0000-4000-8000-0000000000b4"; // B's "Ana"
const P_1 = "00000000-0000-4000-8000-0000000000c1"; // A: Ana + Bo
const P_2 = "00000000-0000-4000-8000-0000000000c2"; // A: Ana only
const P_B = "00000000-0000-4000-8000-0000000000c3"; // B: B's Ana

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2)`, [A, B]);
  await c.query(
    `insert into public.games (id, name, source, kind) values ($1,'Catán','bgg','base'),($2,'Azul','bgg','base')`,
    [G1, G2],
  );
  await c.query(
    `insert into public.players (id, owner_id, name) values
       ($1,$5,'Ana'), ($2,$5,'Bo'), ($3,$5,'Cy'), ($4,$6,'Ana')`,
    [PL_ANA, PL_BO, PL_CY, PL_B_ANA, A, B],
  );
  await c.query(
    `insert into public.plays (id, created_by, game_id) values ($1,$4,$5),($2,$4,$6),($3,$7,$5)`,
    [P_1, P_2, P_B, A, G1, G2, B],
  );
  await c.query(
    `insert into public.play_participants (play_id, seat, player_id, total_score, rank, is_winner) values
       ($1,0,$4,10,1,true), ($1,1,$5,4,2,false), ($2,0,$4,null,null,false), ($3,0,$6,null,null,false)`,
    [P_1, P_2, P_B, PL_ANA, PL_BO, PL_B_ANA],
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

const ids = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query<{ id: string }>(sql, params)).rows.map((r) => r.id).sort();
const count = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query<{ n: number }>(`select count(*)::int n from ${sql}`, params))
    .rows[0].n;
const person = (seat: number, name: string, playerId?: string) => ({
  seat,
  name,
  ...(playerId ? { playerId } : {}),
  total: null,
  rank: null,
  isWinner: false,
  scores: {},
});
const save = (
  c: Client,
  participants: unknown[],
  extra: Record<string, unknown> = {},
) =>
  c.query<{ id: string }>("select public.save_play($1::jsonb) as id", [
    JSON.stringify({
      gameId: G2,
      playedOn: "2026-11-16",
      durationMinutes: null,
      scoringVersionId: null,
      notes: null,
      expansionIds: [],
      participants,
      ...extra,
    }),
  ]);

describe.skipIf(!hasDb)("normalize_player_name", () => {
  it("matches the TypeScript imitation for common names", async () => {
    const inputs = [
      "Ana",
      "ana ",
      "  ANA",
      "Aná",
      "Ana  María",
      "ÁNA",
      "🐦  Zoë",
      "",
      "Zoë",
      "Ana\tMaría",
      // Other scripts: the database keeps their vowel signs, so the imitation must too.
      "कमल",
      "कमला",
    ];
    const rows = await asA(async (c) =>
      Promise.all(
        inputs.map(async (input) => ({
          input,
          sql: (
            await c.query(`select public.normalize_player_name($1) as n`, [
              input,
            ])
          ).rows[0].n,
        })),
      ),
    );
    for (const row of rows)
      expect(row.sql, JSON.stringify(row.input)).toBe(
        normalizePlayerName(row.input),
      );
  });
});

describe.skipIf(!hasDb)("RLS: players", () => {
  it("a user only sees their own players", async () => {
    expect(await asA((c) => ids(c, `select id from public.players`))).toEqual(
      [PL_ANA, PL_BO, PL_CY].sort(),
    );
    expect(await asB((c) => ids(c, `select id from public.players`))).toEqual([
      PL_B_ANA,
    ]);
  });

  it("anonymous users have no access", async () => {
    expect(
      await asAnon((c) => pgErrorCode(c.query(`select * from public.players`))),
    ).toBe("42501");
  });

  it("owner_id defaults to the caller and cannot be spoofed or changed", async () => {
    const owner = await asA(
      async (c) =>
        (
          await c.query(
            `insert into public.players (name) values ('Dee') returning owner_id`,
          )
        ).rows[0].owner_id,
    );
    expect(owner).toBe(A);
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.players (owner_id, name) values ($1,'Eve')`,
            [B],
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(`update public.players set owner_id = $2 where id = $1`, [
            PL_ANA,
            B,
          ]),
        ),
      ),
    ).toBe("42501");
  });

  it("the name is unique per owner after normalization, but another owner may reuse it", async () => {
    for (const variant of ["ana ", "ANA", "Aná"])
      expect(
        await asA((c) =>
          pgErrorCode(
            c.query(`insert into public.players (name) values ($1)`, [variant]),
          ),
        ),
        variant,
      ).toBe("23505");
    expect(
      await asB((c) =>
        pgErrorCode(c.query(`insert into public.players (name) values ('Bo')`)),
      ),
    ).toBeNull();
  });

  it("name must have 1 to 60 characters (23514)", async () => {
    for (const bad of ["", "x".repeat(61)])
      expect(
        await asA((c) =>
          pgErrorCode(
            c.query(`insert into public.players (name) values ($1)`, [bad]),
          ),
        ),
      ).toBe("23514");
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(`insert into public.players (name) values ($1)`, [
            "x".repeat(60),
          ]),
        ),
      ),
    ).toBeNull();
  });

  it("linked_user_id can only be the owner (me) or null, and only one player is me", async () => {
    const link = (player: string, user: string | null) => (c: Client) =>
      pgErrorCode(
        c.query(`update public.players set linked_user_id = $2 where id = $1`, [
          player,
          user,
        ]),
      );
    expect(await asA(link(PL_ANA, B))).toBe("23514"); // somebody else: not in Phase 6
    expect(await asA(link(PL_ANA, A))).toBeNull();
    expect(await asA(link(PL_ANA, null))).toBeNull();
    const second = await asA(async (c) => {
      await c.query(
        `update public.players set linked_user_id = $2 where id = $1`,
        [PL_ANA, A],
      );
      return pgErrorCode(
        c.query(`update public.players set linked_user_id = $2 where id = $1`, [
          PL_BO,
          A,
        ]),
      );
    });
    expect(second).toBe("23505");
  });

  it("the 201st player is refused (P0001)", async () => {
    const code = await asA(
      (c) =>
        pgErrorCode(
          c.query(`insert into public.players (name) values ('one too many')`),
        ),
      async (c) => {
        await c.query(
          `insert into public.players (owner_id, name) select $1, 'bulk' || g from generate_series(1, 197) g`,
          [A],
        ); // + the 3 fixture players = 200
      },
    );
    expect(code).toBe("P0001");
  });

  it("another user cannot update or delete my players", async () => {
    const result = await asB(async (c) => ({
      updated: (
        await c.query(
          `update public.players set name = 'Hacked' where id = $1`,
          [PL_ANA],
        )
      ).rowCount,
      deleted: (
        await c.query(`delete from public.players where id = $1`, [PL_CY])
      ).rowCount,
    }));
    expect(result).toEqual({ updated: 0, deleted: 0 });
  });

  it("renaming to an existing name fails (23505)", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(`update public.players set name = 'bo ' where id = $1`, [
            PL_ANA,
          ]),
        ),
      ),
    ).toBe("23505");
  });
});

describe.skipIf(!hasDb)("participants and the roster", () => {
  it("a participant must have a player, and the column display_name is gone", async () => {
    const insert = (c: Client) =>
      pgErrorCode(
        c.query(
          `insert into public.play_participants (play_id, seat) values ($1,5)`,
          [P_1],
        ),
      );
    // Through the API the policy refuses it first; the column is NOT NULL regardless.
    expect(await asA(insert)).toBe("42501");
    expect(
      await asA(async (c) => {
        await c.query("reset role");
        return insert(c);
      }),
    ).toBe("23502");
    const cols = await asA(async (c) =>
      (
        await c.query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'play_participants'`,
        )
      ).rows.map((r) => r.column_name),
    );
    expect(cols).toContain("player_id");
    // display_name returned in 0020 as a snapshot for guests who cannot read the roster
  });

  it("a participant cannot point at another user's player (42501)", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.play_participants (play_id, seat, player_id) values ($1,5,$2)`,
            [P_1, PL_B_ANA],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("one player cannot appear twice in a match (23505)", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.play_participants (play_id, seat, player_id) values ($1,5,$2)`,
            [P_1, PL_ANA],
          ),
        ),
      ),
    ).toBe("23505");
  });
});

describe.skipIf(!hasDb)("save_play with the roster", () => {
  it("uses a given playerId and creates nothing", async () => {
    const result = await asA(async (c) => {
      const before = await count(c, `public.players`);
      const id = (await save(c, [person(0, "Ignored name", PL_BO)])).rows[0].id;
      const used = (
        await c.query(
          `select player_id from public.play_participants where play_id = $1`,
          [id],
        )
      ).rows;
      return { used, created: (await count(c, `public.players`)) - before };
    });
    expect(result).toEqual({ used: [{ player_id: PL_BO }], created: 0 });
  });

  it("creates a new player from a new name", async () => {
    const result = await asA(async (c) => {
      const id = (await save(c, [person(0, "Dee")])).rows[0].id;
      return (
        await c.query(
          `select pl.name, pl.owner_id from public.play_participants pp
             join public.players pl on pl.id = pp.player_id where pp.play_id = $1`,
          [id],
        )
      ).rows;
    });
    expect(result).toEqual([{ name: "Dee", owner_id: A }]);
  });

  it('reuses the existing player for "ana ", "ANA" and "Aná" (Review Focus 3)', async () => {
    for (const variant of ["ana ", "ANA", "Aná"]) {
      const result = await asA(async (c) => {
        const before = await count(c, `public.players`);
        const id = (await save(c, [person(0, variant)])).rows[0].id;
        const row = (
          await c.query(
            `select player_id from public.play_participants where play_id = $1`,
            [id],
          )
        ).rows[0];
        return {
          player: row.player_id,
          created: (await count(c, `public.players`)) - before,
        };
      });
      expect(result, variant).toEqual({ player: PL_ANA, created: 0 });
    }
  });

  it("another user's playerId is refused (42501)", async () => {
    expect(
      await asA((c) => pgErrorCode(save(c, [person(0, "x", PL_B_ANA)]))),
    ).toBe("42501");
  });

  it("two participants that resolve to the same player fail (23505) and nothing is saved", async () => {
    const result = await asA(async (c) => {
      await c.query("savepoint s");
      const code = await pgErrorCode(
        save(c, [person(0, "Ana"), person(1, "ana ")]),
      );
      await c.query("rollback to savepoint s");
      return { code, plays: await count(c, `public.plays`) };
    });
    expect(result).toEqual({ code: "23505", plays: 2 }); // only A's two fixture plays
  });
});

describe.skipIf(!hasDb)("merge_players", () => {
  const merge = (keep: string, remove: string) => (c: Client) =>
    c.query(`select public.merge_players($1,$2)`, [keep, remove]);

  it("moves the matches to the kept player and deletes the other", async () => {
    // Bo (P_1) merges into Cy, who never played: Cy takes Bo's seat.
    const result = await asA(async (c) => {
      await merge(PL_CY, PL_BO)(c);
      return {
        removed: await count(c, `public.players where id = $1`, [PL_BO]),
        cyMatches: await count(
          c,
          `public.play_participants where player_id = $1`,
          [PL_CY],
        ),
        boMatches: await count(
          c,
          `public.play_participants where player_id = $1`,
          [PL_BO],
        ),
      };
    });
    expect(result).toEqual({ removed: 0, cyMatches: 1, boMatches: 0 });
  });

  it("is refused when the two played together in some match (PL001), leaving everything as it was", async () => {
    const result = await asA(async (c) => {
      await c.query("savepoint s");
      const code = await pgErrorCode(merge(PL_ANA, PL_BO)(c));
      await c.query("rollback to savepoint s");
      return {
        code,
        players: await count(c, `public.players`),
        boMatches: await count(
          c,
          `public.play_participants where player_id = $1`,
          [PL_BO],
        ),
      };
    });
    expect(result).toEqual({ code: "PL001", players: 3, boMatches: 1 });
  });

  it('transfers the "me" mark to the kept player', async () => {
    const linked = await asA(
      async (c) => {
        await merge(PL_CY, PL_BO)(c);
        return (
          await c.query(
            `select linked_user_id from public.players where id = $1`,
            [PL_CY],
          )
        ).rows[0].linked_user_id;
      },
      async (c) => {
        await c.query(
          `update public.players set linked_user_id = $2 where id = $1`,
          [PL_BO, A],
        );
      },
    );
    expect(linked).toBe(A);
  });

  it("refuses another user's player and merging a player into itself", async () => {
    expect(await asA((c) => pgErrorCode(merge(PL_ANA, PL_B_ANA)(c)))).toBe(
      "P0002",
    );
    expect(
      await asA((c) =>
        pgErrorCode(merge(PL_ANA, "00000000-0000-4000-8000-0000000000ff")(c)),
      ),
    ).toBe("P0002");
    expect(await asA((c) => pgErrorCode(merge(PL_ANA, PL_ANA)(c)))).toBe(
      "22023",
    );
  });

  it("is not callable anonymously", async () => {
    expect(await asAnon((c) => pgErrorCode(merge(PL_ANA, PL_BO)(c)))).toBe(
      "42501",
    );
  });
});

describe.skipIf(!hasDb)(
  "deleting players and cascades (Review Focus 4)",
  () => {
    it("a player with matches cannot be deleted (23503); one without can", async () => {
      expect(
        await asA((c) =>
          pgErrorCode(
            c.query(`delete from public.players where id = $1`, [PL_ANA]),
          ),
        ),
      ).toBe("23503");
      expect(
        await asA(
          async (c) =>
            (await c.query(`delete from public.players where id = $1`, [PL_CY]))
              .rowCount,
        ),
      ).toBe(1);
    });

    it("deleting a match keeps the players; deleting a game removes its matches but keeps the players", async () => {
      const result = await asA(async (c) => {
        await c.query(`delete from public.plays where id = $1`, [P_2]);
        const afterMatch = await count(c, `public.players`);
        await c.query("reset role");
        await c.query(`delete from public.games where id = $1`, [G1]);
        return {
          afterMatch,
          afterGame: await count(c, `public.players where owner_id = $1`, [A]),
          participants: await count(
            c,
            `public.play_participants pp join public.plays p on p.id = pp.play_id where p.created_by = $1`,
            [A],
          ),
        };
      });
      expect(result).toEqual({ afterMatch: 3, afterGame: 3, participants: 0 });
    });

    it("deleting an account removes its matches and players without an FK error", async () => {
      const left = await asA(async (c) => {
        await c.query("reset role");
        await c.query(`delete from public.profiles where id = $1`, [A]);
        return {
          players: await count(c, `public.players where owner_id = $1`, [A]),
          plays: await count(c, `public.plays where created_by = $1`, [A]),
          others: await count(c, `public.players where owner_id = $1`, [B]),
        };
      });
      expect(left).toEqual({ players: 0, plays: 0, others: 1 });
    });
  },
);
