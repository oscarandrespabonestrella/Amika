import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const ADMIN = "test_user_admin";
const A = "test_user_a";
const B = "test_user_b";
const G = "00000000-0000-4000-8000-0000000000e1"; // global game
const G_CUSTOM = "00000000-0000-4000-8000-0000000000e2"; // A's custom game
const URL1 = "https://www.devir.com/rules/catan.pdf";
const URL2 = "https://example.com/rules/other.pdf";

async function fixtures(c: Client) {
  await c.query(`insert into public.profiles (id) values ($1),($2),($3)`, [
    ADMIN,
    A,
    B,
  ]);
  await c.query(
    `insert into public.user_roles (user_id, role) values ($1,'admin')`,
    [ADMIN],
  );
  await c.query(
    `insert into public.games (id, name, source) values ($1,'Global Game','bgg')`,
    [G],
  );
  await c.query(
    `insert into public.games (id, name, source, owner_id) values ($1,'A Custom','manual',$2)`,
    [G_CUSTOM, A],
  );
}

const as =
  (sub: string) =>
  <T>(fn: (c: Client) => Promise<T>) =>
    withRole("authenticated", { sub }, fixtures, fn);
const asAdmin = as(ADMIN);
const asA = as(A);
const asAnon = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("anon", null, fixtures, fn);

const propose = (c: Client, game = G, url = URL1, createdBy?: string) =>
  c.query(
    `insert into public.manual_suggestions (game_id, url, title, source_host, created_by)
     values ($1, $2, 'Catan reglamento', 'www.devir.com', coalesce($3, public.current_user_id()))`,
    [game, url, createdBy ?? null],
  );

describe.skipIf(!hasDb)("manual suggestions: who can propose and see", () => {
  it("a user proposes on a global game, as themselves, always pending", async () => {
    const rows = await asA(async (c) => {
      await propose(c);
      return (
        await c.query(
          "select status, created_by from public.manual_suggestions",
        )
      ).rows;
    });
    expect(rows).toEqual([{ status: "pending", created_by: A }]);
  });

  it("cannot propose on a private custom game, even their own", async () => {
    expect(await asA((c) => pgErrorCode(propose(c, G_CUSTOM)))).toBe("42501");
  });

  it("cannot propose in somebody else's name, nor as already rejected", async () => {
    expect(await asA((c) => pgErrorCode(propose(c, G, URL1, B)))).toBe("42501");
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.manual_suggestions (game_id, url, title, source_host, status)
             values ($1, $2, 't', 'h', 'rejected')`,
            [G, URL1],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("rejects non-https URLs and over-long titles", async () => {
    expect(
      await asA((c) => pgErrorCode(propose(c, G, "http://example.com/a.pdf"))),
    ).toBe("23514");
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.manual_suggestions (game_id, url, title, source_host)
             values ($1, $2, $3, 'h')`,
            [G, URL1, "x".repeat(201)],
          ),
        ),
      ),
    ).toBe("23514");
  });

  it("a proposal is private to its author and to administrators", async () => {
    const seed = async (c: Client) => {
      await c.query(
        `insert into public.manual_suggestions (game_id, url, title, source_host, created_by)
         values ($1, $2, 't', 'h', $3)`,
        [G, URL1, A],
      );
    };
    const visible = (sub: string) =>
      withRole(
        "authenticated",
        { sub },
        async (c) => {
          await fixtures(c);
          await seed(c);
        },
        async (c) =>
          (await c.query("select 1 from public.manual_suggestions")).rowCount,
      );
    expect(await visible(A)).toBe(1);
    expect(await visible(ADMIN)).toBe(1);
    expect(await visible(B)).toBe(0);
  });

  it("the same link cannot be proposed twice for a game", async () => {
    const code = await asA(async (c) => {
      await propose(c);
      return pgErrorCode(propose(c));
    });
    expect(code).toBe("23505");
  });

  it("allows 5 open proposals per user and game, not 6", async () => {
    const code = await asA(async (c) => {
      for (let i = 0; i < 5; i++)
        await propose(c, G, `https://example.com/${i}.pdf`);
      return pgErrorCode(propose(c, G, "https://example.com/6.pdf"));
    });
    expect(code).toBe("P0001");
  });

  it("anonymous visitors read and write nothing", async () => {
    expect(
      await asAnon((c) =>
        pgErrorCode(c.query("select * from public.manual_suggestions")),
      ),
    ).toBe("42501");
    expect(await asAnon((c) => pgErrorCode(propose(c)))).toBe("42501");
  });
});

describe.skipIf(!hasDb)("manual suggestions: review", () => {
  const seed = async (c: Client) => {
    await fixtures(c);
    await c.query(
      `insert into public.manual_suggestions (id, game_id, url, title, source_host, created_by, locale, publisher, is_official)
       values ('00000000-0000-4000-8000-0000000000e9', $1, $2, 'Catan reglamento', 'www.devir.com', $3, 'es', 'Devir', true)`,
      [G, URL1, A],
    );
  };
  const S = "00000000-0000-4000-8000-0000000000e9";
  const run = <T>(sub: string, fn: (c: Client) => Promise<T>) =>
    withRole("authenticated", { sub }, seed, fn);

  it("an administrator publishes: the link lands in the Game Center and the proposal is gone", async () => {
    const result = await run(ADMIN, async (c) => {
      const published = await c.query(
        "select public.publish_manual_suggestion($1) as id",
        [S],
      );
      return {
        id: published.rows[0].id,
        resources: (
          await c.query(
            `select kind, locale, title, url, is_official, publisher, verified_at is not null as verified
             from public.game_resources where game_id = $1`,
            [G],
          )
        ).rows,
        left: (await c.query("select 1 from public.manual_suggestions"))
          .rowCount,
      };
    });
    expect(result.id).not.toBeNull();
    expect(result.resources).toEqual([
      {
        kind: "rules",
        locale: "es",
        title: "Catan reglamento",
        url: URL1,
        is_official: true,
        publisher: "Devir",
        verified: true,
      },
    ]);
    expect(result.left).toBe(0);
  });

  it("publishing is idempotent: an already published link is not duplicated", async () => {
    const result = await run(ADMIN, async (c) => {
      await c.query(
        `insert into public.game_resources (game_id, kind, title, url) values ($1,'rules','Hand typed',$2)`,
        [G, URL1],
      );
      const published = await c.query(
        "select public.publish_manual_suggestion($1) as id",
        [S],
      );
      return {
        id: published.rows[0].id,
        count: (
          await c.query(
            "select 1 from public.game_resources where game_id = $1 and kind = 'rules'",
            [G],
          )
        ).rowCount,
        left: (await c.query("select 1 from public.manual_suggestions"))
          .rowCount,
      };
    });
    expect(result).toEqual({ id: null, count: 1, left: 0 });
  });

  it("publishing something that is not pending does nothing", async () => {
    const id = await run(ADMIN, async (c) => {
      await c.query("update public.manual_suggestions set status = 'rejected'");
      return (
        await c.query("select public.publish_manual_suggestion($1) as id", [S])
      ).rows[0].id;
    });
    expect(id).toBeNull();
  });

  it("a regular user cannot publish, not even their own proposal", async () => {
    expect(
      await run(A, (c) =>
        pgErrorCode(
          c.query("select public.publish_manual_suggestion($1)", [S]),
        ),
      ),
    ).toBe("42501");
  });

  it("only an administrator rejects", async () => {
    expect(
      await run(ADMIN, async (c) => {
        await c.query(
          "update public.manual_suggestions set status = 'rejected'",
        );
        return (await c.query("select status from public.manual_suggestions"))
          .rows[0].status;
      }),
    ).toBe("rejected");
    // RLS filters the row away from the author's UPDATE: nothing changes
    expect(
      await run(A, async (c) => {
        const r = await c.query(
          "update public.manual_suggestions set status = 'rejected'",
        );
        return r.rowCount;
      }),
    ).toBe(0);
  });

  it("a rejected link stays and blocks proposing it again", async () => {
    // the administrator's rejection is simulated with the privileged role, then A tries again
    const code = await run(A, async (c) => {
      await c.query("reset role");
      await c.query("update public.manual_suggestions set status = 'rejected'");
      await c.query("set local role authenticated");
      return pgErrorCode(propose(c));
    });
    expect(code).toBe("23505");
  });

  it("the author withdraws a pending proposal; another user cannot; a rejected one stays", async () => {
    expect(
      await run(
        A,
        async (c) =>
          (await c.query("delete from public.manual_suggestions")).rowCount,
      ),
    ).toBe(1);
    expect(
      await run(
        B,
        async (c) =>
          (await c.query("delete from public.manual_suggestions")).rowCount,
      ),
    ).toBe(0);
    expect(
      await run(A, async (c) => {
        // only the admin can reject, so do it as the privileged fixture role first
        await c.query("reset role");
        await c.query(
          "update public.manual_suggestions set status = 'rejected'",
        );
        await c.query("set local role authenticated");
        return (await c.query("delete from public.manual_suggestions"))
          .rowCount;
      }),
    ).toBe(0);
  });
});

describe.skipIf(!hasDb)("game_resources: no duplicate rules links", () => {
  it("rejects the same rules URL twice for a game, allows it for another game", async () => {
    const insert = (c: Client, game: string) =>
      c.query(
        `insert into public.game_resources (game_id, kind, title, url) values ($1,'rules','T',$2)`,
        [game, URL1],
      );
    const result = await asAdmin(async (c) => {
      await insert(c, G);
      return pgErrorCode(insert(c, G));
    });
    expect(result).toBe("23505");
  });

  it("does not restrict other kinds of link", async () => {
    const ok = await asAdmin(async (c) => {
      for (let i = 0; i < 2; i++)
        await c.query(
          `insert into public.game_resources (game_id, kind, title, url) values ($1,'link','T',$2)`,
          [G, URL2],
        );
      return true;
    });
    expect(ok).toBe(true);
  });
});

describe.skipIf(!hasDb)(
  "manual_requests: usage log is service-role only",
  () => {
    it("authenticated users cannot read or write it", async () => {
      expect(
        await asA((c) =>
          pgErrorCode(c.query("select * from public.manual_requests")),
        ),
      ).toBe("42501");
      expect(
        await asA((c) =>
          pgErrorCode(
            c.query(
              "insert into public.manual_requests (user_id, kind) values ($1,'search')",
              [A],
            ),
          ),
        ),
      ).toBe("42501");
    });
  },
);
