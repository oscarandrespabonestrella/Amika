import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { hasDb, pgErrorCode, withRole } from "./db";

const ADMIN = "test_user_admin";
const A = "test_user_a";
const B = "test_user_b";
const G = "00000000-0000-4000-8000-0000000000d1"; // global game
const G_CUSTOM = "00000000-0000-4000-8000-0000000000d2"; // A's custom game
const FAQ_PUBLISHED = "00000000-0000-4000-8000-0000000000f1";
const FAQ_A_PENDING = "00000000-0000-4000-8000-0000000000f2";

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
  await c.query(
    `insert into public.faq_entries (id, game_id, status, created_by) values ($1,$3,'published',$4), ($2,$3,'pending',$5)`,
    [FAQ_PUBLISHED, FAQ_A_PENDING, G, ADMIN, A],
  );
  await c.query(
    `insert into public.faq_translations (faq_id, locale, question, answer) values ($1,'en','Q pub','A pub'), ($2,'en','Q pend','A pend')`,
    [FAQ_PUBLISHED, FAQ_A_PENDING],
  );
  await c.query(
    `insert into public.game_resources (game_id, kind, locale, title, url) values ($1,'rules','en','Official rules','https://example.com/rules.pdf')`,
    [G],
  );
  await c.query(
    `insert into public.rules_content (game_id, locale, body) values ($1,'en','Summary')`,
    [G],
  );
  await c.query(
    `insert into public.game_images (game_id, url, attribution) values ($1,'https://example.com/i.jpg','Photo: Someone')`,
    [G],
  );
}

const as =
  (sub: string) =>
  <T>(fn: (c: Client) => Promise<T>) =>
    withRole("authenticated", { sub }, fixtures, fn);
const asAdmin = as(ADMIN);
const asA = as(A);
const asB = as(B);
const asAnon = <T>(fn: (c: Client) => Promise<T>) =>
  withRole("anon", null, fixtures, fn);

const count = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query(sql, params)).rowCount;

describe.skipIf(!hasDb)("Game Center: reading", () => {
  it("any signed-in user reads resources, rules summary and gallery of visible games", async () => {
    expect(
      await asB((c) => count(c, "select 1 from public.game_resources")),
    ).toBe(1);
    expect(
      await asB((c) => count(c, "select 1 from public.rules_content")),
    ).toBe(1);
    expect(await asB((c) => count(c, "select 1 from public.game_images"))).toBe(
      1,
    );
  });

  it("anonymous visitors read nothing", async () => {
    for (const table of [
      "game_resources",
      "rules_content",
      "game_images",
      "faq_entries",
      "faq_translations",
    ]) {
      expect(
        await asAnon((c) =>
          pgErrorCode(c.query(`select * from public.${table}`)),
        ),
        table,
      ).toBe("42501");
    }
  });

  it("published FAQ is public; a pending suggestion is private to its author and admins", async () => {
    const ids = async (as: typeof asA) =>
      as(async (c) =>
        (await c.query("select id from public.faq_entries")).rows
          .map((r) => r.id)
          .sort(),
      );
    expect(await ids(asB)).toEqual([FAQ_PUBLISHED]);
    expect(await ids(asA)).toEqual([FAQ_PUBLISHED, FAQ_A_PENDING].sort());
    expect(await ids(asAdmin)).toEqual([FAQ_PUBLISHED, FAQ_A_PENDING].sort());
  });

  it("FAQ translations follow the visibility of their entry", async () => {
    const q = (as: typeof asA) =>
      as(async (c) =>
        (
          await c.query(
            "select question from public.faq_translations order by question",
          )
        ).rows.map((r) => r.question),
      );
    expect(await q(asB)).toEqual(["Q pub"]);
    expect(await q(asA)).toEqual(["Q pend", "Q pub"]);
  });
});

describe.skipIf(!hasDb)("Game Center: content writes are admin-only", () => {
  const insertResource = (c: Client, game = G) =>
    pgErrorCode(
      c.query(
        `insert into public.game_resources (game_id, kind, title, url) values ($1,'link','Site','https://example.com')`,
        [game],
      ),
    );

  it("a regular user cannot add, change or delete resources, rules or images", async () => {
    expect(await asA((c) => insertResource(c))).toBe("42501");
    expect(
      await asA(async (c) => ({
        upd: (await c.query(`update public.game_resources set title = 'x'`))
          .rowCount,
        del: (await c.query(`delete from public.game_resources`)).rowCount,
        rules: (await c.query(`update public.rules_content set body = 'x'`))
          .rowCount,
        img: (await c.query(`delete from public.game_images`)).rowCount,
      })),
    ).toEqual({ upd: 0, del: 0, rules: 0, img: 0 });
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.rules_content (game_id, locale, body) values ($1,'es','x')`,
            [G],
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.game_images (game_id, url, attribution) values ($1,'https://e.com/a.jpg','x')`,
            [G],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("an admin can write content for a global game", async () => {
    expect(await asAdmin((c) => insertResource(c))).toBeNull();
    expect(
      await asAdmin((c) =>
        pgErrorCode(
          c.query(
            `insert into public.rules_content (game_id, locale, body) values ($1,'es','Resumen')`,
            [G],
          ),
        ),
      ),
    ).toBeNull();
    expect(
      await asAdmin((c) =>
        pgErrorCode(
          c.query(
            `insert into public.game_images (game_id, url, attribution) values ($1,'https://e.com/a.jpg','Photo: X')`,
            [G],
          ),
        ),
      ),
    ).toBeNull();
  });

  it("not even an admin can attach content to a user's private custom game", async () => {
    // The admin cannot see A's custom game at all, so the insert is refused.
    expect(await asAdmin((c) => insertResource(c, G_CUSTOM))).toBe("42501");
  });

  it("the shape rules hold: a video is only a YouTube id, others only an https URL", async () => {
    const insert = (sql: string, params: unknown[]) =>
      asAdmin((c) => pgErrorCode(c.query(sql, params)));
    const base =
      "insert into public.game_resources (game_id, kind, title, url, youtube_id) values ($1,$2,'T',$3,$4)";
    expect(await insert(base, [G, "video", null, "dQw4w9WgXcQ"])).toBeNull();
    expect(
      await insert(base, [G, "video", "https://youtube.com/x", "dQw4w9WgXcQ"]),
    ).toBe("23514"); // url on a video
    expect(await insert(base, [G, "video", null, null])).toBe("23514"); // no id
    expect(await insert(base, [G, "video", null, "short"])).toBe("23514"); // bad id
    expect(await insert(base, [G, "video", null, "dQw4w9WgXc<"])).toBe("23514"); // bad char
    expect(
      await insert(base, [G, "rules", "http://insecure.example.com", null]),
    ).toBe("23514"); // not https
    expect(await insert(base, [G, "rules", "javascript:alert(1)", null])).toBe(
      "23514",
    );
    expect(await insert(base, [G, "rules", null, null])).toBe("23514"); // no url
    expect(
      await insert(base, [G, "rules", "https://example.com/r", "dQw4w9WgXcQ"]),
    ).toBe("23514"); // id on a non-video
    expect(await insert(base, [G, "other", "https://example.com", null])).toBe(
      "23514",
    ); // unknown kind
  });

  it("an image needs https and an attribution", async () => {
    const insert = (url: string, attribution: string) =>
      asAdmin((c) =>
        pgErrorCode(
          c.query(
            `insert into public.game_images (game_id, url, attribution) values ($1,$2,$3)`,
            [G, url, attribution],
          ),
        ),
      );
    expect(await insert("http://e.com/a.jpg", "x")).toBe("23514");
    expect(await insert("https://e.com/a.jpg", "")).toBe("23514");
  });
});

describe.skipIf(!hasDb)("Game Center: FAQ suggestions", () => {
  const suggest =
    (status = "pending", game = G) =>
    (c: Client) =>
      pgErrorCode(
        c.query(
          `insert into public.faq_entries (game_id, status) values ($1,$2)`,
          [game, status],
        ),
      );

  it("a user can suggest, always as pending and as themselves", async () => {
    expect(await asB(suggest("pending"))).toBeNull();
    const owner = await asB(async (c) => {
      await c.query(`insert into public.faq_entries (game_id) values ($1)`, [
        G,
      ]);
      return (
        await c.query(
          // Only B's rows: fixtures also contain the admin's and A's entries.
          `select created_by, status from public.faq_entries where created_by = $1 limit 1`,
          [B],
        )
      ).rows[0];
    });
    expect(owner).toEqual({ created_by: B, status: "pending" });
  });

  it("a user cannot publish their own suggestion on insert or by updating it", async () => {
    expect(await asB(suggest("published"))).toBe("42501");
    expect(await asB(suggest("rejected"))).toBe("42501");
    expect(
      await asA((c) =>
        pgErrorCode(
          c.query(
            `update public.faq_entries set status = 'published' where id = $1`,
            [FAQ_A_PENDING],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("a user cannot impersonate another author", async () => {
    expect(
      await asB((c) =>
        pgErrorCode(
          c.query(
            `insert into public.faq_entries (game_id, created_by) values ($1,$2)`,
            [G, A],
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("suggestions are only for global games", async () => {
    expect(await asA(suggest("pending", G_CUSTOM))).toBe("42501");
  });

  it("the author can edit and withdraw a pending suggestion; others cannot touch it", async () => {
    const author = await asA(async (c) => ({
      edit: (
        await c.query(
          `update public.faq_translations set question = 'Edited' where faq_id = $1`,
          [FAQ_A_PENDING],
        )
      ).rowCount,
      del: (
        await c.query(`delete from public.faq_entries where id = $1`, [
          FAQ_A_PENDING,
        ])
      ).rowCount,
    }));
    expect(author).toEqual({ edit: 1, del: 1 });

    const other = await asB(async (c) => ({
      edit: (
        await c.query(
          `update public.faq_translations set question = 'Hack' where faq_id = $1`,
          [FAQ_A_PENDING],
        )
      ).rowCount,
      del: (
        await c.query(`delete from public.faq_entries where id = $1`, [
          FAQ_A_PENDING,
        ])
      ).rowCount,
    }));
    expect(other).toEqual({ edit: 0, del: 0 });
  });

  it("once published, the author can no longer change it", async () => {
    const result = await withRole(
      "authenticated",
      { sub: A },
      async (c) => {
        await fixtures(c);
        await c.query(
          `update public.faq_entries set status = 'published' where id = $1`,
          [FAQ_A_PENDING],
        );
      },
      async (c) => ({
        edit: (
          await c.query(
            `update public.faq_translations set question = 'Late edit' where faq_id = $1`,
            [FAQ_A_PENDING],
          )
        ).rowCount,
        del: (
          await c.query(`delete from public.faq_entries where id = $1`, [
            FAQ_A_PENDING,
          ])
        ).rowCount,
      }),
    );
    expect(result).toEqual({ edit: 0, del: 0 });
  });

  it("an admin reviews: approves, rejects and deletes", async () => {
    const result = await asAdmin(async (c) => ({
      approve: (
        await c.query(
          `update public.faq_entries set status = 'published', reviewed_by = $2, reviewed_at = now() where id = $1`,
          [FAQ_A_PENDING, ADMIN],
        )
      ).rowCount,
      reject: (
        await c.query(
          `update public.faq_entries set status = 'rejected' where id = $1`,
          [FAQ_PUBLISHED],
        )
      ).rowCount,
      del: (
        await c.query(`delete from public.faq_entries where id = $1`, [
          FAQ_PUBLISHED,
        ])
      ).rowCount,
    }));
    expect(result).toEqual({ approve: 1, reject: 1, del: 1 });
  });

  it("an approved suggestion becomes visible to everyone", async () => {
    const visible = await withRole(
      "authenticated",
      { sub: B },
      async (c) => {
        await fixtures(c);
        await c.query(
          `update public.faq_entries set status = 'published' where id = $1`,
          [FAQ_A_PENDING],
        );
      },
      async (c) =>
        (await c.query("select id from public.faq_entries")).rows
          .map((r) => r.id)
          .sort(),
    );
    expect(visible).toEqual([FAQ_PUBLISHED, FAQ_A_PENDING].sort());
  });

  it("limits a user to 5 pending suggestions per game; admins are not limited", async () => {
    const code = await asB(async (c) => {
      for (let i = 0; i < 5; i++)
        await c.query(`insert into public.faq_entries (game_id) values ($1)`, [
          G,
        ]);
      return pgErrorCode(
        c.query(`insert into public.faq_entries (game_id) values ($1)`, [G]),
      );
    });
    expect(code).toBe("P0001");

    const adminOk = await asAdmin(async (c) => {
      for (let i = 0; i < 7; i++)
        await c.query(`insert into public.faq_entries (game_id) values ($1)`, [
          G,
        ]);
      return true;
    });
    expect(adminOk).toBe(true);
  });

  it("validates question and answer lengths", async () => {
    const insert = (question: string, answer: string) =>
      asA((c) =>
        pgErrorCode(
          c.query(
            `insert into public.faq_translations (faq_id, locale, question, answer) values ($1,'es',$2,$3)`,
            [FAQ_A_PENDING, question, answer],
          ),
        ),
      );
    expect(await insert("", "a")).toBe("23514");
    expect(await insert("q", "")).toBe("23514");
    expect(await insert("x".repeat(301), "a")).toBe("23514");
    expect(await insert("q", "x".repeat(3001))).toBe("23514");
    expect(await insert("¿Cómo se gana?", "Con más puntos.")).toBeNull();
  });

  it("deleting the game removes all its Game Center content", async () => {
    const left = await withRole(
      "authenticated",
      { sub: A },
      fixtures,
      async (c) => {
        await c.query("reset role");
        await c.query(`delete from public.games where id = $1`, [G]);
        return (
          await c.query(
            `select
        (select count(*) from public.game_resources where game_id = $1)::int as res,
        (select count(*) from public.faq_entries where game_id = $1)::int as faq,
        (select count(*) from public.faq_translations)::int as tr`,
            [G],
          )
        ).rows[0];
      },
    );
    expect(left).toEqual({ res: 0, faq: 0, tr: 0 });
  });
});
