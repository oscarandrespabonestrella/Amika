import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a";
const B = "test_user_b";
const G1 = "00000000-0000-4000-8000-0000000000f1"; // global
const G2 = "00000000-0000-4000-8000-0000000000f2"; // global
const G_B = "00000000-0000-4000-8000-0000000000f3"; // B's custom game
const S_A = "00000000-0000-4000-8000-0000000000a1"; // A's sheet on G1
const S_B = "00000000-0000-4000-8000-0000000000b1"; // B's sheet on G1
const DEF = JSON.stringify({
  schemaVersion: 1,
  categories: [{ key: "a", label: "A", type: "number", scoring: true }],
});

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2)`, [A, B]);
  await c.query(
    `insert into public.games (id, name, source) values ($1,'Catán','bgg'), ($2,'Zombicide','bgg')`,
    [G1, G2],
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
    `insert into public.scoring_sheet_versions (sheet_id, definition) values ($1,$3),($2,$3)`,
    [S_A, S_B, DEF],
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

const newSheet = (c: Client, game: string, extra = "'private'") =>
  c.query(
    `insert into public.scoring_sheets (game_id, title, locale, visibility)
     values ($1,'T','en',${extra}) returning id`,
    [game],
  );

describe.skipIf(!hasDb)("RLS: scoring sheets", () => {
  it("a user only sees their own sheets and versions", async () => {
    const a = await asA(async (c) => ({
      sheets: (await c.query("select id from public.scoring_sheets")).rows,
      versions: (
        await c.query("select sheet_id from public.scoring_sheet_versions")
      ).rows,
    }));
    expect(a.sheets).toEqual([{ id: S_A }]);
    expect(a.versions).toEqual([{ sheet_id: S_A }]);
    const b = await asB(
      async (c) => (await c.query("select id from public.scoring_sheets")).rows,
    );
    expect(b).toEqual([{ id: S_B }]);
  });

  it("anonymous users have no access", async () => {
    for (const table of ["scoring_sheets", "scoring_sheet_versions"])
      expect(
        await asAnon((c) =>
          pgErrorCode(c.query(`select * from public.${table}`)),
        ),
      ).toBe("42501");
  });

  it("owner_id defaults to the caller and cannot be spoofed", async () => {
    const owner = await asA(
      async (c) =>
        (
          await c.query(
            `insert into public.scoring_sheets (game_id, title, locale)
             values ($1,'Mine','en') returning owner_id`,
            [G2],
          )
        ).rows[0].owner_id,
    );
    expect(owner).toBe(A);
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.scoring_sheets (game_id, owner_id, title, locale)
             values ($1,$2,'X','en')`,
            [G2, B],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("cannot create a sheet for a game the user cannot see", async () => {
    expect(await asA((c) => pgErrorCode(newSheet(c, G_B)))).toBe("42501");
    expect(await asB((c) => pgErrorCode(newSheet(c, G_B)))).toBeNull();
  });

  it("a catalog game's sheet can be made public (Phase 5c); the rules live in rls-sharing.test.ts", async () => {
    // Insert as public, or publish an existing sheet: both are allowed for catalog games.
    expect(
      await asA((c) => pgErrorCode(newSheet(c, G2, "'public'"))),
    ).toBeNull();
    const stamped = await asA(async (c) => {
      await c.query(
        `update public.scoring_sheets set visibility = 'public' where id = $1`,
        [S_A],
      );
      return (
        await c.query(
          `select published_at is not null as stamped from public.scoring_sheets where id = $1`,
          [S_A],
        )
      ).rows[0].stamped;
    });
    expect(stamped).toBe(true);
  });

  it("validates title and locale", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.scoring_sheets (game_id, title, locale) values ($1,'','en')`,
            [G2],
          ),
        ),
      ),
    ).toBe("23514");
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.scoring_sheets (game_id, title, locale) values ($1,'x','EN')`,
            [G2],
          ),
        ),
      ),
    ).toBe("23514");
  });

  it("versions are numbered 1, 2, 3 automatically", async () => {
    const numbers = await asA(async (c) => {
      for (let i = 0; i < 2; i++)
        await c.query(
          `insert into public.scoring_sheet_versions (sheet_id, definition) values ($1,$2)`,
          [S_A, DEF],
        );
      return (
        await c.query(
          `select version from public.scoring_sheet_versions where sheet_id = $1 order by version`,
          [S_A],
        )
      ).rows.map((r) => r.version);
    });
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("a version cannot be updated", async () => {
    const viaRls = await asA(
      async (c) =>
        (
          await c.query(
            `update public.scoring_sheet_versions set definition = $2 where sheet_id = $1`,
            [S_A, DEF],
          )
        ).rowCount,
    );
    expect(viaRls).toBe(0); // no update policy: the row is not even reachable

    const viaPrivileged = await asA(async (c) => {
      await c.query("reset role");
      return pgErrorCode(
        c.query(
          `update public.scoring_sheet_versions set definition = $2 where sheet_id = $1`,
          [S_A, DEF],
        ),
      );
    });
    expect(viaPrivileged).toBe("P0001"); // the trigger blocks even privileged roles
  });

  it("an owner cannot delete a single version (history is immutable); deleting the sheet still removes them", async () => {
    const result = await asA(async (c) => {
      const single = (
        await c.query(
          `delete from public.scoring_sheet_versions where sheet_id = $1`,
          [S_A],
        )
      ).rowCount;
      const sheet = (
        await c.query(`delete from public.scoring_sheets where id = $1`, [S_A])
      ).rowCount;
      await c.query("reset role");
      const left = (
        await c.query(
          `select count(*)::int n from public.scoring_sheet_versions where sheet_id = $1`,
          [S_A],
        )
      ).rows[0].n;
      return { single, sheet, left };
    });
    expect(result).toEqual({ single: 0, sheet: 1, left: 0 });
  });

  it("a user cannot add a version to someone else's sheet", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.scoring_sheet_versions (sheet_id, definition) values ($1,$2)`,
            [S_B, DEF],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("(sheet_id, version) is unique: a concurrent save loses with 23505", async () => {
    const code = await asA(
      (c) =>
        pgErrorCode(
          c.query(
            `insert into public.scoring_sheet_versions (sheet_id, version, definition) values ($1,1,$2)`,
            [S_A, DEF],
          ),
        ),
      async (c) => {
        // Two racing transactions both compute max+1; the unique index decides.
        await c.query(
          `alter table public.scoring_sheet_versions disable trigger scoring_sheet_versions_number`,
        );
      },
    );
    expect(code).toBe("23505");
  });

  it("an explicit version must be the next one: a stale save loses with 23505", async () => {
    const insert = (c: Client, version: number) =>
      pgErrorCode(
        c.query(
          `insert into public.scoring_sheet_versions (sheet_id, version, definition) values ($1,$2,$3)`,
          [S_A, version, DEF],
        ),
      );
    // The fixture sheet has version 1: only 2 is next. A tab that still believes
    // the latest is 1 and saves "2" after someone else saved "2" would send 2 again.
    expect(await asA((c) => insert(c, 5))).toBe("23505");
    expect(await asA((c) => insert(c, 1))).toBe("23505");
    expect(await asA((c) => insert(c, 2))).toBeNull();
    expect(
      await asA(async (c) => {
        expect(await insert(c, 2)).toBeNull();
        await c.query("savepoint s");
        const second = await insert(c, 2); // the stale tab
        await c.query("rollback to savepoint s");
        return second;
      }),
    ).toBe("23505");
  });

  it("the 51st version of a sheet is refused", async () => {
    const result = await asA(
      (c) =>
        pgErrorCode(
          c.query(
            `insert into public.scoring_sheet_versions (sheet_id, definition) values ($1,$2)`,
            [S_A, DEF],
          ),
        ),
      async (c) => {
        await c.query(
          `insert into public.scoring_sheet_versions (sheet_id, definition)
           select $1, $2::jsonb from generate_series(1, 49)`,
          [S_A, DEF],
        ); // + the fixture's version 1 = 50
      },
    );
    expect(result).toBe("P0001");
  });

  it("the 21st private sheet per user and game is refused; other games are unaffected", async () => {
    const result = await asA(
      async (c) => {
        // The failing insert goes last: an error aborts the transaction.
        const otherGame = await pgErrorCode(newSheet(c, G2));
        const sameGame = await pgErrorCode(newSheet(c, G1));
        return { sameGame, otherGame };
      },
      async (c) => {
        await c.query(
          `insert into public.scoring_sheets (game_id, owner_id, title, locale)
           select $1, $2, 'bulk', 'en' from generate_series(1, 19)`,
          [G1, A],
        ); // + the fixture's sheet = 20
      },
    );
    expect(result).toEqual({ sameGame: "P0001", otherGame: null });
  });

  it("the definition must be a JSON object under 50_000 bytes", async () => {
    const insert = (definition: string) =>
      asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.scoring_sheet_versions (sheet_id, definition) values ($1,$2::jsonb)`,
            [S_A, definition],
          ),
        ),
      );
    expect(await insert("[]")).toBe("23514");
    expect(await insert('"text"')).toBe("23514");
    expect(await insert(JSON.stringify({ pad: "x".repeat(50_000) }))).toBe(
      "23514",
    );
    expect(await insert(DEF)).toBeNull();
  });

  it("game_id and owner_id cannot be changed (no column grant: permission denied)", async () => {
    for (const [column, value] of [
      ["game_id", G2],
      ["owner_id", B],
    ])
      expect(
        await asA((c) =>
          pgErrorCode(
            c.query(
              `update public.scoring_sheets set ${column} = $2 where id = $1`,
              [S_A, value],
            ),
          ),
        ),
        column,
      ).toBe("42501");
  });

  it("the owner can rename and delete a sheet (versions go with it); others cannot", async () => {
    const result = await asA(async (c) => {
      const renamed = (
        await c.query(
          `update public.scoring_sheets set title = 'Renamed' where id = $1`,
          [S_A],
        )
      ).rowCount;
      const others = (
        await c.query(`delete from public.scoring_sheets where id = $1`, [S_B])
      ).rowCount;
      const own = (
        await c.query(`delete from public.scoring_sheets where id = $1`, [S_A])
      ).rowCount;
      await c.query("reset role");
      const left = (
        await c.query(
          `select count(*)::int n from public.scoring_sheet_versions where sheet_id = $1`,
          [S_A],
        )
      ).rows[0].n;
      return { renamed, others, own, left };
    });
    expect(result).toEqual({ renamed: 1, others: 0, own: 1, left: 0 });
  });

  it("deleting a game or a profile cascades sheets and versions", async () => {
    const left = await asA(async (c) => {
      await c.query("reset role");
      await c.query(`delete from public.games where id = $1`, [G1]);
      const afterGame = (
        await c.query(`select count(*)::int n from public.scoring_sheets`)
      ).rows[0].n;
      return afterGame;
    });
    expect(left).toBe(0);

    const afterProfile = await asA(async (c) => {
      await c.query("reset role");
      await c.query(`delete from public.profiles where id = $1`, [A]);
      return (
        await c.query(
          `select (select count(*) from public.scoring_sheets where owner_id = $1)::int sheets,
                  (select count(*) from public.scoring_sheet_versions where sheet_id = $2)::int versions`,
          [A, S_A],
        )
      ).rows[0];
    });
    expect(afterProfile).toEqual({ sheets: 0, versions: 0 });
  });

  it("copied_from is set null when the source sheet is deleted", async () => {
    const copied = await asA(async (c) => {
      const { rows } = await c.query(
        `insert into public.scoring_sheets (game_id, title, locale, copied_from)
         values ($1,'Copy','en',$2) returning id`,
        [G1, S_A],
      );
      await c.query("reset role");
      await c.query(`delete from public.scoring_sheets where id = $1`, [S_A]);
      return (
        await c.query(
          `select copied_from from public.scoring_sheets where id = $1`,
          [rows[0].id],
        )
      ).rows[0].copied_from;
    });
    expect(copied).toBeNull();
  });
});
