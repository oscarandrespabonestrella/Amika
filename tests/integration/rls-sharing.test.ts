import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a"; // author of the shared sheet
const B = "test_user_b";
const C = "test_user_c"; // uses A's sheet
const ADMIN = "test_user_admin";
const G1 = "00000000-0000-4000-8000-0000000000b1"; // catalog game
const G_A = "00000000-0000-4000-8000-0000000000b2"; // A's custom game
const S_A = "00000000-0000-4000-8000-0000000000c1"; // A's sheet on G1 (public in fixtures)
const S_B = "00000000-0000-4000-8000-0000000000c2"; // B's sheet on G1 (private)
const S_C = "00000000-0000-4000-8000-0000000000c3"; // C's sheet on G1 (public)
const S_GA = "00000000-0000-4000-8000-0000000000c4"; // A's sheet on the custom game
const V_A = "00000000-0000-4000-8000-0000000000d1";
const V_B = "00000000-0000-4000-8000-0000000000d2";
const V_C = "00000000-0000-4000-8000-0000000000d3";
const P_C = "00000000-0000-4000-8000-0000000000e1"; // C's match with V_A
const P_A = "00000000-0000-4000-8000-0000000000e2"; // A's match with V_A (own sheet)
const P_B = "00000000-0000-4000-8000-0000000000e3"; // B's match with V_B (own sheet)
const DEF = JSON.stringify({
  schemaVersion: 1,
  categories: [{ key: "m", label: "M", type: "number", scoring: true }],
});

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2),($3),($4)`, [
    A,
    B,
    C,
    ADMIN,
  ]);
  await c.query(
    `insert into public.user_roles (user_id, role) values ($1,'admin')`,
    [ADMIN],
  );
  await c.query(
    `insert into public.games (id, name, source, kind) values ($1,'Catán','bgg','base')`,
    [G1],
  );
  await c.query(
    `insert into public.games (id, name, source, owner_id) values ($1,'A Custom','manual',$2)`,
    [G_A, A],
  );
  await c.query(
    `insert into public.scoring_sheets (id, game_id, owner_id, title, locale) values
       ($1,$5,$6,'A sheet','en'), ($2,$5,$7,'B sheet','en'), ($3,$5,$8,'C sheet','en'), ($4,$9,$6,'A custom sheet','en')`,
    [S_A, S_B, S_C, S_GA, G1, A, B, C, G_A],
  );
  await c.query(
    `insert into public.scoring_sheet_versions (id, sheet_id, definition) values ($1,$4,$7),($2,$5,$7),($3,$6,$7)`,
    [V_A, V_B, V_C, S_A, S_B, S_C, DEF],
  );
  // A's and C's sheets are published (trigger sets published_at).
  await c.query(
    `update public.scoring_sheets set visibility = 'public' where id = any($1)`,
    [[S_A, S_C]],
  );
  await c.query(
    `insert into public.plays (id, created_by, game_id, scoring_version_id) values
       ($1,$4,$7,$8), ($2,$5,$7,$8), ($3,$6,$7,$9)`,
    [P_C, P_A, P_B, C, A, B, G1, V_A, V_B],
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
const asAdmin = as(ADMIN);

const ids = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query<{ id: string }>(sql, params)).rows.map((r) => r.id).sort();
const rankings = (c: Client) =>
  c.query<{
    sheet_id: string;
    version: number;
    is_mine: boolean;
    verified: boolean;
    disabled: boolean;
    up_votes: number;
    flag_votes: number;
    uses: number;
    score: number;
  }>(`select * from public.sheet_rankings($1)`, [G1]);

/** Voters without matches (inserted with the privileged role): for ranking tests. */
async function seedVotes(
  c: Client,
  version: string,
  up: number,
  flags: number,
) {
  const total = up + flags;
  await c.query(
    `insert into public.profiles (id) select 'voter_' || $2 || '_' || g from generate_series(1, $1) g`,
    [total, version.slice(-2)],
  );
  await c.query(
    `insert into public.scoring_votes (version_id, user_id, kind, reason)
     select $1, 'voter_' || $4 || '_' || g,
            case when g <= $2 then 'up' else 'flag' end,
            case when g <= $2 then null else 'wrong' end
       from generate_series(1, $3) g`,
    [version, up, total, version.slice(-2)],
  );
}

describe.skipIf(!hasDb)("publishing", () => {
  it("an owner publishes and unpublishes; published_at is set by the trigger", async () => {
    const result = await asB(async (c) => {
      await c.query(
        `update public.scoring_sheets set visibility = 'public' where id = $1`,
        [S_B],
      );
      const published = (
        await c.query(
          `select visibility, published_at is not null as stamped from public.scoring_sheets where id = $1`,
          [S_B],
        )
      ).rows[0];
      await c.query(
        `update public.scoring_sheets set visibility = 'private' where id = $1`,
        [S_B],
      );
      const back = (
        await c.query(
          `select visibility from public.scoring_sheets where id = $1`,
          [S_B],
        )
      ).rows[0];
      return { published, back };
    });
    expect(result.published).toEqual({ visibility: "public", stamped: true });
    expect(result.back).toEqual({ visibility: "private" });
  });

  it("a custom game's sheet cannot be published (PB001)", async () => {
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `update public.scoring_sheets set visibility = 'public' where id = $1`,
            [S_GA],
          ),
        ),
      ),
    ).toBe("PB001");
  });

  it("the 6th publication within a day is refused (PB002); other users are unaffected", async () => {
    const result = await asB(
      async (c) => {
        const publish = (n: number) =>
          c.query(
            `update public.scoring_sheets set visibility = 'public' where title = $1`,
            [`bulk${n}`],
          );
        for (const n of [1, 2, 3, 4, 5]) await publish(n); // the first five succeed
        return pgErrorCode(publish(6)); // the sixth hits the daily cap
      },
      async (c) => {
        await c.query(
          `insert into public.scoring_sheets (game_id, owner_id, title, locale)
           select $1, $2, 'bulk' || g, 'en' from generate_series(1, 6) g`,
          [G1, B],
        );
      },
    );
    expect(result).toBe("PB002");
  });

  it("users cannot write published_at, verified_*, disabled_* or owner_id (permission denied)", async () => {
    for (const column of [
      "published_at",
      "verified_at",
      "verified_by",
      "disabled_at",
      "disabled_by",
      "owner_id",
      "game_id",
    ])
      expect(
        await asB((c) =>
          pgErrorCode(
            c.query(
              `update public.scoring_sheets set ${column} = ${column} where id = $1`,
              [S_B],
            ),
          ),
        ),
        column,
      ).toBe("42501");
    expect(
      await asB((c) =>
        pgErrorCode(
          c.query(
            `insert into public.scoring_sheets (game_id, title, locale, verified_at) values ($1,'x','en',now())`,
            [G1],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("an unknown visibility is rejected (23514)", async () => {
    expect(
      await asB((c) =>
        pgErrorCode(
          c.query(
            `update public.scoring_sheets set visibility = 'secret' where id = $1`,
            [S_B],
          ),
        ),
      ),
    ).toBe("23514");
  });
});

describe.skipIf(!hasDb)("who can see which sheets", () => {
  it("others see a public enabled sheet and its versions, never a private one", async () => {
    const seen = await asB(async (c) => ({
      sheets: await ids(
        c,
        `select id from public.scoring_sheets where game_id = $1`,
        [G1],
      ),
      versions: await ids(c, `select id from public.scoring_sheet_versions`),
    }));
    expect(seen.sheets).toEqual([S_A, S_B, S_C].sort()); // B's own + the two public ones
    expect(seen.versions).toEqual([V_A, V_B, V_C].sort());
    const cSees = await asC((c) =>
      ids(c, `select id from public.scoring_sheets where game_id = $1`, [G1]),
    );
    expect(cSees).toEqual([S_A, S_C].sort()); // not B's private sheet
  });

  it("a disabled sheet is hidden from others but visible to its owner and to admins", async () => {
    const hide = async (c: Client) => {
      await c.query(
        `update public.scoring_sheets set disabled_at = now() where id = $1`,
        [S_C],
      );
    };
    expect(
      await asB(
        (c) =>
          ids(c, `select id from public.scoring_sheets where id = $1`, [S_C]),
        hide,
      ),
    ).toEqual([]);
    expect(
      await asC(
        (c) =>
          ids(c, `select id from public.scoring_sheets where id = $1`, [S_C]),
        hide,
      ),
    ).toEqual([S_C]);
    expect(
      await asAdmin(
        (c) =>
          ids(c, `select id from public.scoring_sheets where id = $1`, [S_C]),
        hide,
      ),
    ).toEqual([S_C]);
  });

  it("a user keeps read access to a sheet they have a match on after it is unpublished or disabled (Review Focus 2)", async () => {
    for (const change of [
      `update public.scoring_sheets set visibility = 'private' where id = '${S_A}'`,
      `update public.scoring_sheets set disabled_at = now() where id = '${S_A}'`,
    ]) {
      const seen = await asC(
        async (c) => ({
          sheet: await ids(
            c,
            `select id from public.scoring_sheets where id = $1`,
            [S_A],
          ),
          version: await ids(
            c,
            `select id from public.scoring_sheet_versions where id = $1`,
            [V_A],
          ),
          play: await ids(c, `select id from public.plays where id = $1`, [
            P_C,
          ]),
        }),
        async (c) => {
          await c.query(change);
        },
      );
      expect(seen).toEqual({ sheet: [S_A], version: [V_A], play: [P_C] });
      // ...but someone with no match on it no longer sees it.
      expect(
        await asB(
          (c) =>
            ids(c, `select id from public.scoring_sheets where id = $1`, [S_A]),
          async (c) => {
            await c.query(change);
          },
        ),
      ).toEqual([]);
    }
  });

  it("a new match cannot use a disabled or foreign private sheet version", async () => {
    const insert = (version: string) => (c: Client) =>
      pgErrorCode(
        c.query(
          `insert into public.plays (game_id, scoring_version_id) values ($1,$2)`,
          [G1, version],
        ),
      );
    expect(await asB(insert(V_A))).toBeNull(); // public and enabled
    expect(await asB(insert(V_C))).toBeNull();
    expect(
      await asC(insert(V_A), async (c) => {
        await c.query(
          `update public.scoring_sheets set disabled_at = now() where id = $1`,
          [S_A],
        );
      }),
    ).toBe("42501"); // C used it before, but it is disabled now
    expect(await asC(insert(V_B))).toBe("42501"); // B's private sheet
  });
});

describe.skipIf(!hasDb)("votes", () => {
  const vote =
    (
      version: string,
      play: string | null,
      kind: string,
      reason: string | null,
    ) =>
    (c: Client) =>
      pgErrorCode(
        c.query(
          `insert into public.scoring_votes (version_id, play_id, kind, reason) values ($1,$2,$3,$4)`,
          [version, play, kind, reason],
        ),
      );

  it("needs an own match on exactly that version", async () => {
    expect(await asC(vote(V_A, P_C, "up", null))).toBeNull();
    expect(await asB(vote(V_A, P_B, "up", null))).toBe("42501"); // B's match uses V_B
    expect(await asB(vote(V_A, null, "up", null))).toBe("42501"); // no match at all
    expect(await asB(vote(V_A, P_C, "up", null))).toBe("42501"); // someone else's match
  });

  it("not on one's own sheet", async () => {
    expect(await asA(vote(V_A, P_A, "up", null))).toBe("42501");
  });

  it("not by moving an existing vote onto one's own sheet (the UPDATE route)", async () => {
    const P_AC = "00000000-0000-4000-8000-0000000000e9"; // A's match on C's sheet
    const moved = await asA(
      async (c) =>
        (
          await c.query(
            `update public.scoring_votes set version_id = $1, play_id = $2 where version_id = $3`,
            [V_A, P_A, V_C],
          )
        ).rowCount,
      async (c) => {
        // A legitimately votes on C's sheet (privileged fixtures stand in for that vote).
        await c.query(
          `insert into public.plays (id, created_by, game_id, scoring_version_id) values ($1,$2,$3,$4)`,
          [P_AC, A, G1, V_C],
        );
        await c.query(
          `insert into public.scoring_votes (version_id, user_id, play_id, kind) values ($1,$2,$3,'up')`,
          [V_C, A, P_AC],
        );
      },
    ).catch((error: { code?: string }) => error.code);
    expect(moved).toBe("42501");
  });

  it("one vote per user and version, but it can change and be removed", async () => {
    const result = await asC(async (c) => {
      await c.query(
        `insert into public.scoring_votes (version_id, play_id, kind) values ($1,$2,'up')`,
        [V_A, P_C],
      );
      const dup = await pgErrorCode(
        c.query(
          `insert into public.scoring_votes (version_id, play_id, kind) values ($1,$2,'up')`,
          [V_A, P_C],
        ),
      );
      return dup;
    });
    expect(result).toBe("23505");

    const changed = await asC(async (c) => {
      await c.query(
        `insert into public.scoring_votes (version_id, play_id, kind) values ($1,$2,'up')`,
        [V_A, P_C],
      );
      await c.query(
        `update public.scoring_votes set kind = 'flag', reason = 'The coins are rounded wrong' where version_id = $1`,
        [V_A],
      );
      const flag = (
        await c.query(`select kind, reason from public.scoring_votes`)
      ).rows[0];
      const deleted = (
        await c.query(
          `delete from public.scoring_votes where version_id = $1`,
          [V_A],
        )
      ).rowCount;
      return { flag, deleted };
    });
    expect(changed).toEqual({
      flag: { kind: "flag", reason: "The coins are rounded wrong" },
      deleted: 1,
    });
  });

  it("a flag needs a reason, an up vote must not have one (23514)", async () => {
    expect(await asC(vote(V_A, P_C, "flag", null))).toBe("23514");
    expect(await asC(vote(V_A, P_C, "flag", ""))).toBe("23514");
    expect(await asC(vote(V_A, P_C, "flag", "x".repeat(301)))).toBe("23514");
    expect(await asC(vote(V_A, P_C, "up", "nice"))).toBe("23514");
  });

  it("a user never sees other users' votes; an admin sees all", async () => {
    const extra = async (c: Client) => {
      await seedVotes(c, V_A, 2, 1);
      await c.query(
        `insert into public.scoring_votes (version_id, user_id, play_id, kind) values ($1,$2,$3,'up')`,
        [V_A, C, P_C],
      );
    };
    expect(
      await asC(
        (c) => ids(c, `select user_id as id from public.scoring_votes`),
        extra,
      ),
    ).toEqual([C]);
    expect(
      await asB(
        (c) => ids(c, `select user_id as id from public.scoring_votes`),
        extra,
      ),
    ).toEqual([]);
    expect(
      (
        await asAdmin(
          (c) => ids(c, `select user_id as id from public.scoring_votes`),
          extra,
        )
      ).length,
    ).toBe(4);
  });
});

describe.skipIf(!hasDb)("sheet_rankings", () => {
  it("8 up / 2 flags scores 0.490, no votes scores 0", async () => {
    const rows = await asB(
      async (c) => (await rankings(c)).rows,
      async (c) => seedVotes(c, V_A, 8, 2),
    );
    const a = rows.find((r) => r.sheet_id === S_A)!;
    expect(a).toMatchObject({ up_votes: 8, flag_votes: 2 });
    expect(a.score).toBeCloseTo(0.4901, 3);
    expect(rows.find((r) => r.sheet_id === S_C)!.score).toBe(0);
  });

  it("2 votes never beat 40 up / 5 flags; verified goes first even with a worse score (Review Focus 3)", async () => {
    const seed = async (c: Client) => {
      await seedVotes(c, V_C, 2, 0); // C: score ≈ 0.34
      await seedVotes(c, V_A, 40, 5); // A: score ≈ 0.77
    };
    const plain = await asB(
      async (c) => (await rankings(c)).rows.map((r) => r.sheet_id),
      seed,
    );
    expect(plain).toEqual([S_A, S_C, S_B]); // by score; B's own private sheet has no votes
    const withVerified = await asB(
      async (c) => (await rankings(c)).rows.map((r) => r.sheet_id),
      async (c) => {
        await seed(c);
        await c.query(
          `update public.scoring_sheets set verified_at = now() where id = $1`,
          [S_C],
        );
      },
    );
    expect(withVerified[0]).toBe(S_C);
  });

  it("uses break ties; only the latest version's votes count", async () => {
    const tie = await asB(
      async (c) => (await rankings(c)).rows.map((r) => [r.sheet_id, r.uses]),
      async (c) => {
        // C's sheet gets one more distinct user with a match: more uses at equal (zero) score.
        await c.query(
          `insert into public.plays (created_by, game_id, scoring_version_id) values ($1,$2,$3)`,
          [B, G1, V_C],
        );
      },
    );
    expect(tie[0][0]).toBe(S_A); // 2 users (C and A) use V_A
    const afterNewVersion = await asB(
      async (c) => (await rankings(c)).rows.find((r) => r.sheet_id === S_A)!,
      async (c) => {
        await seedVotes(c, V_A, 6, 0);
        await c.query(
          `insert into public.scoring_sheet_versions (sheet_id, definition) values ($1,$2)`,
          [S_A, DEF],
        );
      },
    );
    expect(afterNewVersion).toMatchObject({
      version: 2,
      up_votes: 0,
      flag_votes: 0,
      score: 0,
    });
  });

  it("never returns another user's private or disabled sheets, and has no owner column", async () => {
    const rows = await asC(
      async (c) => (await rankings(c)).rows,
      async (c) => {
        await c.query(
          `update public.scoring_sheets set disabled_at = now() where id = $1`,
          [S_A],
        );
      },
    );
    expect(rows.map((r) => r.sheet_id).sort()).toEqual([S_C]); // not A's (disabled), not B's (private)
    expect(Object.keys(rows[0])).not.toContain("owner_id");
    // The owner still sees their disabled sheet, flagged; an admin sees it too.
    const mine = await asA(
      async (c) => (await rankings(c)).rows.find((r) => r.sheet_id === S_A),
      async (c) => {
        await c.query(
          `update public.scoring_sheets set disabled_at = now() where id = $1`,
          [S_A],
        );
      },
    );
    expect(mine).toMatchObject({ is_mine: true, disabled: true });
    const admin = await asAdmin(
      async (c) => (await rankings(c)).rows.map((r) => r.sheet_id),
      async (c) => {
        await c.query(
          `update public.scoring_sheets set disabled_at = now() where id = $1`,
          [S_A],
        );
      },
    );
    expect(admin).toContain(S_A);
    expect(admin).not.toContain(S_B); // another user's private sheet
  });
});

describe.skipIf(!hasDb)("admin functions", () => {
  it("are forbidden to non-admins (42501)", async () => {
    for (const sql of [
      `select public.admin_set_sheet_verified('${S_A}', true)`,
      `select public.admin_set_sheet_disabled('${S_A}', true)`,
      `select * from public.admin_sheet_flags('${S_A}')`,
    ])
      expect(await asB((c) => pgErrorCode(c.query(sql))), sql).toBe("42501");
  });

  it("verify only a public enabled sheet; disabling clears verified", async () => {
    const result = await asAdmin(async (c) => {
      await c.query(`select public.admin_set_sheet_verified($1, true)`, [S_A]);
      const verified = (
        await c.query(
          `select verified_at is not null v, verified_by by from public.scoring_sheets where id = $1`,
          [S_A],
        )
      ).rows[0];
      await c.query(`select public.admin_set_sheet_disabled($1, true)`, [S_A]);
      const disabled = (
        await c.query(
          `select verified_at is null v, disabled_at is not null d from public.scoring_sheets where id = $1`,
          [S_A],
        )
      ).rows[0];
      await c.query(`select public.admin_set_sheet_disabled($1, false)`, [S_A]);
      await c.query("savepoint s");
      const privateSheet = await pgErrorCode(
        c.query(`select public.admin_set_sheet_verified($1, true)`, [S_B]),
      );
      await c.query("rollback to savepoint s");
      return { verified, disabled, privateSheet };
    });
    expect(result.verified).toEqual({ v: true, by: ADMIN });
    expect(result.disabled).toEqual({ v: true, d: true });
    expect(result.privateSheet).toBe("P0002");
  });

  it("unpublishing clears the verified badge", async () => {
    const cleared = await asA(
      async (c) => {
        await c.query(
          `update public.scoring_sheets set visibility = 'private' where id = $1`,
          [S_A],
        );
        return (
          await c.query(
            `select verified_at from public.scoring_sheets where id = $1`,
            [S_A],
          )
        ).rows[0].verified_at;
      },
      async (c) => {
        await c.query(
          `update public.scoring_sheets set verified_at = now() where id = $1`,
          [S_A],
        );
      },
    );
    expect(cleared).toBeNull();
  });

  it("a new version clears the verified badge (verification applies to what the admin saw)", async () => {
    const result = await asA(
      async (c) => {
        const before = (
          await c.query(
            `select verified_at is not null v from public.scoring_sheets where id = $1`,
            [S_A],
          )
        ).rows[0].v;
        await c.query(
          `insert into public.scoring_sheet_versions (sheet_id, definition) values ($1,$2)`,
          [S_A, DEF],
        );
        const after = (
          await c.query(
            `select verified_at is null v, verified_by is null b from public.scoring_sheets where id = $1`,
            [S_A],
          )
        ).rows[0];
        return { before, after };
      },
      async (c) => {
        await c.query(
          `update public.scoring_sheets set verified_at = now(), verified_by = $2 where id = $1`,
          [S_A, ADMIN],
        );
      },
    );
    expect(result).toEqual({ before: true, after: { v: true, b: true } });
  });

  it("admin_sheet_flags returns the reasons to admins only", async () => {
    const extra = async (c: Client) => {
      await c.query(
        `insert into public.scoring_votes (version_id, user_id, play_id, kind, reason) values ($1,$2,$3,'flag','Total is wrong')`,
        [V_A, C, P_C],
      );
    };
    const rows = await asAdmin(
      async (c) =>
        (
          await c.query(
            `select version, reason from public.admin_sheet_flags($1)`,
            [S_A],
          )
        ).rows,
      extra,
    );
    expect(rows).toEqual([{ version: 1, reason: "Total is wrong" }]);
  });
});

describe.skipIf(!hasDb)("deleting an account", () => {
  it("keeps a public sheet other people used (anonymous) and removes the rest (Review Focus 4)", async () => {
    const result = await asA(async (c) => {
      await c.query("reset role");
      await c.query(
        `insert into public.scoring_votes (version_id, user_id, play_id, kind) values ($1,$2,null,'up')`,
        [V_C, A],
      );
      await c.query(`delete from public.profiles where id = $1`, [A]);
      const one = async (sql: string, p: unknown[] = []) =>
        (await c.query(sql, p)).rows[0];
      return {
        shared: await one(
          `select owner_id, visibility from public.scoring_sheets where id = $1`,
          [S_A],
        ),
        sharedVersion: (
          await one(
            `select count(*)::int n from public.scoring_sheet_versions where sheet_id = $1`,
            [S_A],
          )
        ).n,
        customSheet: (
          await one(
            `select count(*)::int n from public.scoring_sheets where id = $1`,
            [S_GA],
          )
        ).n,
        authorPlays: (
          await one(
            `select count(*)::int n from public.plays where created_by = $1`,
            [A],
          )
        ).n,
        otherPlay: (
          await one(`select count(*)::int n from public.plays where id = $1`, [
            P_C,
          ])
        ).n,
        votes: (
          await one(
            `select count(*)::int n from public.scoring_votes where user_id = $1`,
            [A],
          )
        ).n,
      };
    });
    expect(result).toEqual({
      shared: { owner_id: null, visibility: "public" },
      sharedVersion: 1,
      customSheet: 0,
      authorPlays: 0,
      otherPlay: 1,
      votes: 0,
    });
  });

  it("removes sheets nobody else used, whatever their visibility", async () => {
    const left = await asB(async (c) => {
      await c.query("reset role");
      await c.query(`delete from public.profiles where id = $1`, [B]);
      return (
        await c.query(
          `select count(*)::int n from public.scoring_sheets where id = $1`,
          [S_B],
        )
      ).rows[0].n;
    });
    expect(left).toBe(0);
  });

  it("a sheet that was unpublished but is used by others also survives anonymously", async () => {
    const owner = await asA(async (c) => {
      await c.query("reset role");
      await c.query(
        `update public.scoring_sheets set visibility = 'private' where id = $1`,
        [S_A],
      );
      await c.query(`delete from public.profiles where id = $1`, [A]);
      return (
        await c.query(
          `select owner_id from public.scoring_sheets where id = $1`,
          [S_A],
        )
      ).rows[0].owner_id;
    });
    expect(owner).toBeNull();
  });
});

describe.skipIf(!hasDb)("plays and caps (hardening)", () => {
  it("a match can only update played_on, duration_minutes and notes", async () => {
    const attempt = (column: string, value: string) => (c: Client) =>
      pgErrorCode(
        c.query(`update public.plays set ${column} = ${value} where id = $1`, [
          P_B,
        ]),
      );
    expect(await asB(attempt("game_id", `'${G_A}'`))).toBe("42501");
    expect(await asB(attempt("scoring_version_id", "null"))).toBe("42501");
    expect(await asB(attempt("created_by", `'${A}'`))).toBe("42501");
    expect(await asB(attempt("notes", "'ok'"))).toBeNull();
    expect(await asB(attempt("duration_minutes", "45"))).toBeNull();
  });

  it("the cap triggers take a row lock on the parent (race-free)", async () => {
    const defs = await asB(
      async (c) =>
        (
          await c.query<{ name: string; def: string }>(
            `select p.proname as name, pg_get_functiondef(p.oid) as def
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('enforce_scoring_sheet_cap','number_scoring_sheet_version','enforce_play_caps')`,
          )
        ).rows,
    );
    expect(defs).toHaveLength(3);
    for (const fn of defs)
      expect(fn.def.toLowerCase(), fn.name).toContain("for update");
  });
});
