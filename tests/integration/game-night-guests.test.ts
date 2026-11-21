import { createHash } from "node:crypto";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { asService, hasDb, pgErrorCode, withRole } from "./db";

const A = "test_user_a"; // host
const B = "test_user_b"; // friend, accepted member
const C = "test_user_c"; // stranger
const N1 = "00000000-0000-4000-8000-000000001501";
const N2 = "00000000-0000-4000-8000-000000001502"; // another night of the host
const G1 = "00000000-0000-4000-8000-000000001511";
const G2 = "00000000-0000-4000-8000-000000001512";
const NG1 = "00000000-0000-4000-8000-000000001521";
const NG2 = "00000000-0000-4000-8000-000000001522"; // game of the other night

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const TOKEN = sha("token-1");
const KEY = sha("guest-key-1");
const KEY2 = sha("guest-key-2");

async function fixtures(c: Client) {
  await c.query(
    `insert into public.profiles (id, display_name) values ($1,'Ana'),($2,'Beto'),($3,'Cris')`,
    [A, B, C],
  );
  await c.query(
    `insert into public.friendships (user_a, user_b) values (least($1::text,$2::text), greatest($1::text,$2::text))`,
    [A, B],
  );
  await c.query(
    `insert into public.games (id, name, source, kind, cover_url, min_players, max_players, min_playtime, max_playtime) values
       ($1,'Uno','bgg','base','https://example.com/1.jpg',2,4,20,40),
       ($2,'Dos','bgg','base',null,1,2,10,10)`,
    [G1, G2],
  );
  await c.query(
    `insert into public.game_nights (id, owner_id, title, starts_on) values
       ($1,$3,'Jueves','2099-01-01'),($2,$3,'Otra','2099-02-02')`,
    [N1, N2, A],
  );
  await c.query(
    `insert into public.game_night_games (id, night_id, game_id, added_by, source, name_snapshot, cover_snapshot) values
       ($1,$3,$5,$7,'host','Uno','https://example.com/1.jpg'),
       ($2,$4,$6,$7,'host','Dos',null)`,
    [NG1, NG2, N1, N2, G1, G2, A],
  );
  await c.query(
    `insert into public.game_night_members (night_id, user_id, status) values ($1,$2,'accepted')`,
    [N1, B],
  );
}

const withLink = async (c: Client) => {
  await fixtures(c);
  await c.query(
    `insert into public.game_night_links (night_id, token_hash, expires_at)
     values ($1,$2,'2099-01-03T00:00:00Z')`,
    [N1, TOKEN],
  );
};
const svc = <T>(
  fn: (c: Client) => Promise<T>,
  extra?: (c: Client) => Promise<void>,
) =>
  asService(async (c) => {
    await withLink(c);
    await extra?.(c);
  }, fn);

const join = (c: Client, name = "Lola", key = KEY) =>
  c.query("select public.guest_join_night($1,$2,$3) as id", [TOKEN, name, key]);

describe.skipIf(!hasDb)("game night guests", () => {
  for (const role of ["authenticated", "anon"] as const) {
    it(`guest functions not callable by ${role}`, async () => {
      const calls = [
        ["select public.guest_night_state($1)", [TOKEN]],
        ["select public.guest_join_night($1,'x',$2)", [TOKEN, KEY]],
        ["select public.guest_toggle_vote($1,$2,$3)", [TOKEN, KEY, NG1]],
        ["select public.guest_rename($1,$2,'x')", [TOKEN, KEY]],
        ["select * from public.log_night_request($1,$2)", [TOKEN, KEY]],
      ] as const;
      for (const [sql, params] of calls) {
        const code = await withRole(
          role,
          role === "anon" ? null : { sub: A },
          withLink,
          (c) => pgErrorCode(c.query(sql, [...params])),
        );
        expect(code, sql).toBe("42501");
      }
    });
  }

  it("link tables are closed to authenticated", async () => {
    const code = await withRole("authenticated", { sub: A }, withLink, (c) =>
      pgErrorCode(c.query("select * from public.game_night_links")),
    );
    expect(code).toBe("42501");
  });

  it("host creates a link: expires two days after starts_on, replaces the old one", async () => {
    await withRole("authenticated", { sub: A }, fixtures, async (c) => {
      const first = await c.query(
        "select public.create_night_link($1,$2) as e",
        [N1, sha("a")],
      );
      expect(new Date(first.rows[0].e).toISOString()).toBe(
        "2099-01-03T00:00:00.000Z",
      );
      await c.query("select public.create_night_link($1,$2)", [N1, sha("b")]);
      await c.query("reset role");
      let { rows } = await c.query(
        `select count(*) filter (where revoked_at is null)::int as live, count(*)::int as total
           from public.game_night_links`,
      );
      expect(rows[0]).toEqual({ live: 1, total: 2 });
      await c.query("set local role authenticated");
      await c.query("select public.revoke_night_link($1)", [N1]);
      await c.query("reset role");
      ({ rows } = await c.query(
        `select count(*) filter (where revoked_at is null)::int as live from public.game_night_links`,
      ));
      expect(rows[0].live).toBe(0);
    });
  });

  it("only the host creates or revokes the link", async () => {
    await withRole("authenticated", { sub: B }, fixtures, async (c) => {
      expect(
        await pgErrorCode(
          c.query("select public.create_night_link($1,$2)", [N1, sha("x")]),
        ),
      ).toBe("42501");
    });
    await withRole("authenticated", { sub: C }, withLink, async (c) => {
      expect(
        await pgErrorCode(c.query("select public.revoke_night_link($1)", [N1])),
      ).toBe("42501");
    });
  });

  it("state hides other nights", async () => {
    await svc(async (c) => {
      const { rows } = await c.query(
        "select public.guest_night_state($1) as s",
        [TOKEN],
      );
      const s = rows[0].s;
      expect(s.night).toEqual({
        title: "Jueves",
        startsOn: "2099-01-01",
        hostName: "Ana",
        status: "open",
      });
      expect(s.guest).toBeNull();
      expect(s.games).toHaveLength(1);
      expect(s.games[0]).toEqual({
        id: NG1,
        name: "Uno",
        cover: "https://example.com/1.jpg",
        minPlayers: 2,
        maxPlayers: 4,
        minPlaytime: 20,
        maxPlaytime: 40,
        votes: 0,
        voters: [],
        mine: false,
      });
      expect(JSON.stringify(s)).not.toContain(A);
      expect(JSON.stringify(s)).not.toContain("Otra");
    });
  });

  it("expired link", async () => {
    await svc(
      async (c) => {
        expect(
          await pgErrorCode(
            c.query("select public.guest_night_state($1)", [TOKEN]),
          ),
        ).toBe("GN005");
      },
      async (c) => {
        await c.query(
          `update public.game_night_links set expires_at = now() - interval '1 second'`,
        );
      },
    );
  });

  it("revoked link and unknown link", async () => {
    await svc(
      async (c) => {
        expect(
          await pgErrorCode(
            c.query("select public.guest_night_state($1)", [TOKEN]),
          ),
        ).toBe("GN005");
      },
      async (c) => {
        await c.query(`update public.game_night_links set revoked_at = now()`);
      },
    );
    await svc(async (c) => {
      expect(
        await pgErrorCode(
          c.query("select public.guest_night_state($1)", [sha("nope")]),
        ),
      ).toBe("GN005");
    });
  });

  it("join + toggle + state shows mine, friends and guests are named", async () => {
    await svc(async (c) => {
      await join(c);
      await c.query(
        `insert into public.game_night_votes (night_game_id, user_id, created_at)
         values ($1,$2, now() - interval '1 minute')`,
        [NG1, B],
      );
      const on = await c.query(
        "select public.guest_toggle_vote($1,$2,$3) as v",
        [TOKEN, KEY, NG1],
      );
      expect(on.rows[0].v).toBe(true);
      const s = (
        await c.query("select public.guest_night_state($1,$2) as s", [
          TOKEN,
          KEY,
        ])
      ).rows[0].s;
      expect(s.guest).toEqual({ name: "Lola" });
      expect(s.games[0]).toMatchObject({
        votes: 2,
        voters: ["Beto", "Lola"],
        mine: true,
      });
      const other = (
        await c.query("select public.guest_night_state($1,$2) as s", [
          TOKEN,
          KEY2,
        ])
      ).rows[0].s;
      expect(other.guest).toBeNull();
      expect(other.games[0].mine).toBe(false);

      const off = await c.query(
        "select public.guest_toggle_vote($1,$2,$3) as v",
        [TOKEN, KEY, NG1],
      );
      expect(off.rows[0].v).toBe(false);

      // rejoining with the same key keeps one guest
      const id1 = (await join(c, "Lola")).rows[0].id;
      const id2 = (await join(c, "Lola Ruiz")).rows[0].id;
      expect(id2).toBe(id1);
      await c.query("select public.guest_rename($1,$2,'  Lolita ')", [
        TOKEN,
        KEY,
      ]);
      const r = (
        await c.query("select public.guest_night_state($1,$2) as s", [
          TOKEN,
          KEY,
        ])
      ).rows[0].s;
      expect(r.guest).toEqual({ name: "Lolita" });
    });
  });

  it("a guest cannot vote a game of another night, nor without joining", async () => {
    await svc(async (c) => {
      await join(c);
      expect(
        await pgErrorCode(
          c.query("select public.guest_toggle_vote($1,$2,$3)", [
            TOKEN,
            KEY,
            NG2,
          ]),
        ),
      ).toBe("P0002");
    });
    await svc(async (c) => {
      expect(
        await pgErrorCode(
          c.query("select public.guest_toggle_vote($1,$2,$3)", [
            TOKEN,
            KEY,
            NG1,
          ]),
        ),
      ).toBe("P0002");
    });
  });

  it("closed night: state readable, writes GN002", async () => {
    await svc(
      async (c) => {
        const s = (
          await c.query("select public.guest_night_state($1) as s", [TOKEN])
        ).rows[0].s;
        expect(s.night.status).toBe("closed");
        expect(await pgErrorCode(join(c))).toBe("GN002");
      },
      async (c) => {
        await c.query(
          `update public.game_nights set status = 'closed' where id = '${N1}'`,
        );
      },
    );
    await svc(
      async (c) => {
        expect(
          await pgErrorCode(
            c.query("select public.guest_toggle_vote($1,$2,$3)", [
              TOKEN,
              KEY,
              NG1,
            ]),
          ),
        ).toBe("GN002");
      },
      async (c) => {
        await join(c);
        await c.query(
          `update public.game_nights set status = 'closed' where id = '${N1}'`,
        );
      },
    );
    await svc(
      async (c) => {
        expect(
          await pgErrorCode(
            c.query("select public.guest_rename($1,$2,'x')", [TOKEN, KEY]),
          ),
        ).toBe("GN002");
      },
      async (c) => {
        await join(c);
        await c.query(
          `update public.game_nights set status = 'closed' where id = '${N1}'`,
        );
      },
    );
  });

  it("thirty-first guest", async () => {
    await svc(async (c) => {
      for (let i = 0; i < 30; i++) await join(c, `G${i}`, sha(`k${i}`));
      expect(await pgErrorCode(join(c, "Extra", sha("k-extra")))).toBe("GN004");
    });
  });

  it("name trimmed, empty rejected", async () => {
    await svc(async (c) => {
      await join(c, "  Lola  ");
      const s = (
        await c.query("select public.guest_night_state($1,$2) as s", [
          TOKEN,
          KEY,
        ])
      ).rows[0].s;
      expect(s.guest.name).toBe("Lola");
    });
    await svc(async (c) => {
      expect(await pgErrorCode(join(c, "   "))).toBe("23514");
    });
    await svc(async (c) => {
      expect(await pgErrorCode(join(c, "x".repeat(41)))).toBe("23514");
    });
    await svc(async (c) => {
      await join(c);
      expect(
        await pgErrorCode(
          c.query("select public.guest_rename($1,$2,' ')", [TOKEN, KEY]),
        ),
      ).toBe("23514");
    });
  });

  it("request log counts", async () => {
    await svc(async (c) => {
      await join(c);
      await join(c, "Otro", KEY2);
      const log = async (key: string) =>
        (
          await c.query("select * from public.log_night_request($1,$2)", [
            TOKEN,
            key,
          ])
        ).rows[0];
      expect(await log(KEY)).toEqual({ last_minute: 1, last_hour: 1 });
      expect(await log(KEY)).toEqual({ last_minute: 2, last_hour: 2 });
      expect(await log(KEY2)).toEqual({ last_minute: 1, last_hour: 3 });
      await c.query(
        `update public.game_night_requests set created_at = now() - interval '5 minutes'
          where id = (select min(id) from public.game_night_requests)`,
      );
      expect(await log(KEY)).toEqual({ last_minute: 2, last_hour: 4 });
    });
  });

  it("friend sees guest names in night_votes", async () => {
    await withRole(
      "authenticated",
      { sub: B },
      async (c) => {
        await withLink(c);
        await join(c);
        await c.query("select public.guest_toggle_vote($1,$2,$3)", [
          TOKEN,
          KEY,
          NG1,
        ]);
      },
      async (c) => {
        const { rows } = await c.query("select * from public.night_votes($1)", [
          N1,
        ]);
        expect(rows).toEqual([
          { night_game_id: NG1, voter_name: "Lola", is_guest: true },
        ]);
      },
    );
  });
});
