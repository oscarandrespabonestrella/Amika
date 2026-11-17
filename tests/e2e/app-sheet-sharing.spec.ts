import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SEVEN_WONDERS } from "../../src/features/scoring/engine/fixtures";
import {
  canRunAppTests,
  cleanupCatalogFixtures,
  insertImportedGame,
  pickPlayer,
  STATE_FILE,
  TEST_USERS,
  testUserId,
  withDb,
} from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
test.describe.configure({ mode: "serial" });

// Own reserved id range: 9900 games, 9901 library, 9902 game center, 9903 sheets, 9904 plays.
const PREFIX = "9905";
const GAME_NAME = "Sharing Wonders E2E";
const CUSTOM_NAME = "Sharing Custom E2E";
const FAKE = "e2e5c_"; // profile id prefix for seeded fake users (cleaned up)

const S1 = "Wonders sheet (author)";
const CUSTOM_SHEET = "Custom game sheet";
const ALPHA = "Alpha sheet";
const BETA = "Beta sheet";
const GAMMA = "Gamma sheet";
const HIDDEN = "Hidden disabled sheet";
const SECRET = "Secret private sheet";

let userI: string;
let userJ: string;
let userK: string;
let gameId: string;
let customGameId: string;
const sheetIds: Record<string, string> = {};
const versionIds: Record<string, string> = {};

async function seedSheet(
  c: import("pg").Client,
  owner: string,
  game: string,
  title: string,
) {
  const sheet = await c.query<{ id: string }>(
    `insert into public.scoring_sheets (game_id, owner_id, title, locale)
     values ($1,$2,$3,'en') returning id`,
    [game, owner, title],
  );
  const version = await c.query<{ id: string }>(
    `insert into public.scoring_sheet_versions (sheet_id, definition)
     values ($1,$2::jsonb) returning id`,
    [sheet.rows[0].id, JSON.stringify(SEVEN_WONDERS)],
  );
  sheetIds[title] = sheet.rows[0].id;
  versionIds[title] = version.rows[0].id;
}

async function seedVotes(
  c: import("pg").Client,
  title: string,
  up: number,
  flags: number,
) {
  await c.query(
    `insert into public.profiles (id)
     select $1 || 'voter_' || g from generate_series(1, $2) g
     on conflict do nothing`,
    [FAKE, Math.max(up + flags, 1)],
  );
  await c.query(
    `insert into public.scoring_votes (version_id, user_id, kind, reason)
     select $1, $2 || 'voter_' || g,
            case when g <= $3 then 'up' else 'flag' end,
            case when g <= $3 then null else 'Total is wrong ' || g end
       from generate_series(1, $4) g`,
    [versionIds[title], FAKE, up, up + flags],
  );
}

const wipeFakes = (c: import("pg").Client) =>
  c.query(`delete from public.profiles where id like $1`, [`${FAKE}%`]);

test.beforeAll(async () => {
  userI = await testUserId(TEST_USERS.i.email);
  userJ = await testUserId(TEST_USERS.j.email);
  userK = await testUserId(TEST_USERS.k.email);
  await withDb(wipeFakes);
  await cleanupCatalogFixtures([userI, userJ, userK], PREFIX);
  await withDb(async (c) => {
    gameId = await insertImportedGame(c, {
      source: "bgg",
      externalId: `${PREFIX}01`,
      language: "en",
      kind: "base",
      name: GAME_NAME,
      description: "Fixture",
      yearPublished: 2010,
      minPlayers: 2,
      maxPlayers: 7,
      minPlaytime: 30,
      maxPlaytime: 30,
      minAge: 10,
      coverUrl: null,
      terms: [],
      relations: [],
    });
    const custom = await c.query<{ id: string }>(
      `insert into public.games (name, source, owner_id) values ($1,'manual',$2) returning id`,
      [CUSTOM_NAME, userI],
    );
    customGameId = custom.rows[0].id;

    for (const id of [userI, userJ, userK])
      await c.query(
        `insert into public.profiles (id) values ($1) on conflict do nothing`,
        [id],
      );
    await c.query(
      `insert into public.user_roles (user_id, role) values ($1,'admin') on conflict do nothing`,
      [userK],
    );
    await c.query(`insert into public.profiles (id) values ($1),($2)`, [
      `${FAKE}owner_a`,
      `${FAKE}owner_b`,
    ]);

    // The author's own sheets (private for now).
    await seedSheet(c, userI, gameId, S1);
    await seedSheet(c, userI, customGameId, CUSTOM_SHEET);
    await seedSheet(c, userI, gameId, SECRET);
    // Community sheets written by fake authors, published through the real trigger.
    await seedSheet(c, `${FAKE}owner_a`, gameId, ALPHA);
    await seedSheet(c, `${FAKE}owner_a`, gameId, BETA);
    await seedSheet(c, `${FAKE}owner_b`, gameId, GAMMA);
    await seedSheet(c, `${FAKE}owner_b`, gameId, HIDDEN);
    await c.query(
      `update public.scoring_sheets set visibility = 'public' where id = any($1)`,
      [[ALPHA, BETA, GAMMA, HIDDEN].map((t) => sheetIds[t])],
    );
    await c.query(
      `update public.scoring_sheets set disabled_at = now() where id = $1`,
      [sheetIds[HIDDEN]],
    );
    // 40 accurate + 5 reports for Alpha, 2 accurate for Beta, nothing for Gamma.
    await seedVotes(c, ALPHA, 40, 5);
    await seedVotes(c, BETA, 2, 0);
  });
});

test.afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`delete from public.user_roles where user_id = $1`, [userK]);
    await wipeFakes(c);
  });
  await cleanupCatalogFixtures([userI, userJ, userK], PREFIX);
});

const sheetsUrl = (game = gameId, locale = "en") =>
  `/${locale}/games/${game}/sheets`;
const sheetUrl = (title: string) => `${sheetsUrl()}/${sheetIds[title]}`;
const communityTitles = async (page: Page) => {
  const items = page
    .getByRole("list", { name: "Community sheets" })
    .getByRole("listitem");
  const out: string[] = [];
  for (let i = 0; i < (await items.count()); i++)
    out.push(await items.nth(i).locator("a").first().innerText());
  return out;
};

async function asUser<T>(
  browser: import("@playwright/test").Browser,
  user: keyof typeof STATE_FILE,
  fn: (page: Page) => Promise<T>,
  options: {
    colorScheme?: "light" | "dark";
    viewport?: { width: number; height: number };
  } = {},
) {
  const context = await browser.newContext({
    storageState: STATE_FILE[user],
    ...options,
  });
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

test.describe("publishing", () => {
  test("the owner publishes a sheet and it shows as Public", async ({
    browser,
  }) => {
    await asUser(browser, "i", async (page) => {
      await page.goto(sheetsUrl());
      const item = page.getByRole("listitem").filter({ hasText: S1 });
      await expect(item.getByText("Private", { exact: true })).toBeVisible();
      await item.getByRole("button", { name: "Publish" }).click();
      await expect(
        item.getByText(/Publish this sheet for everyone\?/),
      ).toBeVisible();
      await item.getByRole("button", { name: "Yes, publish" }).click();
      await expect(item.getByText("Public", { exact: true })).toBeVisible();
    });
    const row = await withDb((c) =>
      c.query(
        `select visibility, published_at is not null as stamped from public.scoring_sheets where id = $1`,
        [sheetIds[S1]],
      ),
    );
    expect(row.rows[0]).toEqual({ visibility: "public", stamped: true });
  });

  test("a custom game's sheet cannot be published", async ({ browser }) => {
    await asUser(browser, "i", async (page) => {
      await page.goto(sheetsUrl(customGameId));
      const item = page.getByRole("listitem").filter({ hasText: CUSTOM_SHEET });
      await expect(
        item.getByText("Sheets for your own games stay private."),
      ).toBeVisible();
      await expect(item.getByRole("button", { name: "Publish" })).toHaveCount(
        0,
      );
    });
  });
});

test.describe("browsing community sheets", () => {
  test("another user sees the sheet read-only, with no author", async ({
    browser,
  }) => {
    await asUser(browser, "j", async (page) => {
      await page.goto(sheetsUrl());
      await expect(
        page.getByRole("heading", { name: "Community sheets" }),
      ).toBeVisible();
      expect(await communityTitles(page)).toContain(S1);

      await page
        .getByRole("listitem")
        .filter({ hasText: S1 })
        .getByRole("link", { name: "View" })
        .click();
      await expect(
        page.getByRole("heading", { level: 1, name: S1 }),
      ).toBeVisible();
      await expect(
        page.getByText("This sheet was shared by the community."),
      ).toBeVisible();
      await expect(page.getByLabel("Sheet name")).toHaveCount(0); // no editor
      await expect(
        page.getByText("Military", { exact: true }).first(),
      ).toBeVisible();
    });
  });

  test("copying a community sheet makes an independent private sheet", async ({
    browser,
  }) => {
    await asUser(browser, "j", async (page) => {
      await page.goto(sheetUrl(S1));
      await page.getByRole("button", { name: "Copy" }).click();
      await expect(page).toHaveURL(/\/sheets\/[0-9a-f-]{36}$/);
      await expect(page.getByLabel("Sheet name")).toHaveValue(`${S1} (copy)`);
    });
    const copy = await withDb((c) =>
      c.query(
        `select copied_from, visibility, owner_id from public.scoring_sheets where owner_id = $1`,
        [userJ],
      ),
    );
    expect(copy.rows).toEqual([
      { copied_from: sheetIds[S1], visibility: "private", owner_id: userJ },
    ]);
  });

  test("the list is ranked: 2 votes never beat 45; ties keep their order", async ({
    browser,
  }) => {
    await asUser(browser, "j", async (page) => {
      await page.goto(sheetsUrl());
      const titles = await communityTitles(page);
      // Alpha 40/5 (≈0.77) > Beta 2/0 (≈0.34) > unvoted sheets in creation order.
      expect(titles.slice(0, 4)).toEqual([ALPHA, BETA, S1, GAMMA]);
      expect(titles).not.toContain(HIDDEN); // disabled
      expect(titles).not.toContain(SECRET); // private
      const alpha = page.getByRole("listitem").filter({ hasText: ALPHA });
      await expect(alpha.getByText("40 accurate")).toBeVisible();
      await expect(alpha.getByText("5 reported")).toBeVisible();
    });
  });

  test("nothing leaks: no author, no private or disabled sheets, no report reasons in the HTML", async ({
    browser,
  }) => {
    await asUser(browser, "j", async (page) => {
      for (const url of [sheetsUrl(), sheetUrl(ALPHA)]) {
        const html = await (await page.request.get(url)).text();
        expect(html, url).not.toContain(userI);
        expect(html, url).not.toContain(TEST_USERS.i.firstName);
        expect(html, url).not.toContain(`${FAKE}owner`);
        expect(html, url).not.toContain(SECRET);
        expect(html, url).not.toContain(HIDDEN);
        expect(html, url).not.toContain("Total is wrong");
      }
      // A private or disabled sheet of somebody else is a 404, not a hint.
      for (const title of [SECRET, HIDDEN])
        expect((await page.goto(sheetUrl(title)))?.status(), title).toBe(404);
    });
  });
});

test.describe("moderation", () => {
  test("an administrator sees the reports; a regular user never does", async ({
    browser,
  }) => {
    await asUser(browser, "k", async (page) => {
      await page.goto(sheetUrl(ALPHA));
      const moderation = page.getByRole("region", { name: "Moderation" });
      await expect(moderation).toBeVisible();
      await expect(
        moderation.getByText("Version 1: Total is wrong 41"),
      ).toBeVisible();
    });
    await asUser(browser, "j", async (page) => {
      await page.goto(sheetUrl(ALPHA));
      await expect(
        page.getByRole("region", { name: "Moderation" }),
      ).toHaveCount(0);
    });
  });

  test("verifying puts a sheet first, whatever its score", async ({
    browser,
  }) => {
    await asUser(browser, "k", async (page) => {
      await page.goto(sheetUrl(GAMMA));
      const moderation = page.getByRole("region", { name: "Moderation" });
      await moderation
        .getByRole("button", { name: "Mark as verified" })
        .click();
      await expect(
        moderation.getByRole("button", { name: "Remove verified" }),
      ).toBeVisible();
    });
    await asUser(browser, "j", async (page) => {
      await page.goto(sheetsUrl());
      expect((await communityTitles(page))[0]).toBe(GAMMA);
      await expect(
        page
          .getByRole("listitem")
          .filter({ hasText: GAMMA })
          .getByText("Verified", { exact: true }),
      ).toBeVisible();
    });
  });

  test("an administrator can open their own match that used a community sheet", async ({
    browser,
  }) => {
    // The administrator policy lets them read EVERY vote; the page must still find only
    // their own (Alpha has 45 votes from other people).
    const playId = await withDb(async (c) => {
      const play = await c.query<{ id: string }>(
        `insert into public.plays (created_by, game_id, scoring_version_id)
         values ($1,$2,$3) returning id`,
        [userK, gameId, versionIds[ALPHA]],
      );
      const kay = await c.query<{ id: string }>(
        `insert into public.players (owner_id, name) values ($1,'Kay') returning id`,
        [userK],
      );
      await c.query(
        `insert into public.play_participants (play_id, seat, player_id, total_score, rank, is_winner)
         values ($1,0,$2,null,null,false)`,
        [play.rows[0].id, kay.rows[0].id],
      );
      return play.rows[0].id;
    });
    await asUser(browser, "k", async (page) => {
      const response = await page.goto(`/en/games/${gameId}/plays/${playId}`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { level: 1, name: "Match" }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "How accurate was this sheet?" }),
      ).toBeVisible();
    });
    await withDb((c) =>
      c.query(`delete from public.plays where id = $1`, [playId]),
    );
  });

  test("a regular user cannot call the admin functions", async () => {
    const result = await withDb(async (c) => {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userJ, role: "authenticated" }),
      ]);
      try {
        await c.query(`select public.admin_set_sheet_verified($1, true)`, [
          sheetIds[BETA],
        ]);
        return "allowed";
      } catch (error) {
        return (error as { code?: string }).code;
      } finally {
        await c.query("rollback");
      }
    });
    expect(result).toBe("42501");
  });
});

test.describe("using community sheets in a match", () => {
  const fill = async (
    page: Page,
    n: number,
    name: string,
    military: string,
  ) => {
    await pickPlayer(page, n, name);
    const input = page.getByLabel(`Military – ${name}`, { exact: true });
    const militaryTab = page.getByRole("tab", { name: "Military" });
    if (!(await input.isVisible())) await militaryTab.click();
    await input.fill(military);
  };

  test("the picker groups my sheets and community sheets and preselects the verified one", async ({
    browser,
  }) => {
    await asUser(browser, "j", async (page) => {
      await page.goto(`/en/games/${gameId}/plays/new`);
      const groups = page.locator("#play-sheet optgroup");
      await expect(groups).toHaveCount(2);
      await expect(groups.nth(0)).toHaveAttribute("label", "My sheets");
      await expect(groups.nth(1)).toHaveAttribute("label", "Community sheets");
      // j has used no sheet yet: the verified community sheet is the default.
      await expect(page.locator("#play-sheet option:checked")).toHaveText(
        `${GAMMA} (verified)`,
      );
      await expect(
        page.locator("#play-sheet option", { hasText: HIDDEN }),
      ).toHaveCount(0);
      await expect(
        page.locator("#play-sheet option", { hasText: SECRET }),
      ).toHaveCount(0);
    });
  });

  test("a match with a community sheet leads to the vote prompt; one vote that can change and go", async ({
    browser,
  }) => {
    await asUser(browser, "j", async (page) => {
      await page.goto(`/en/games/${gameId}/plays/new`);
      await page.getByLabel("Score sheet").selectOption({ label: ALPHA });
      await fill(page, 1, "Ana", "6");
      await fill(page, 2, "Bo", "3");
      await page.getByRole("button", { name: "Save match" }).click();
      await expect(page).toHaveURL(/\/plays\/[0-9a-f-]{36}#vote$/);

      const vote = page.getByRole("region", {
        name: "How accurate was this sheet?",
      });
      await expect(vote).toBeVisible();
      await vote.getByRole("button", { name: "Accurate" }).click();
      await expect(vote.getByText("Thanks, your vote is saved.")).toBeVisible();
      await expect(vote.getByText("Your vote: accurate.")).toBeVisible();

      // Change it to a report: the reason is required.
      await vote.getByRole("button", { name: "Change my vote" }).click();
      await vote.getByRole("button", { name: "Report a wrong total" }).click();
      await expect(
        vote.getByRole("button", { name: "Send report" }),
      ).toBeDisabled();
      await vote
        .getByLabel("What was wrong?")
        .fill("Coins were rounded the wrong way");
      await vote.getByRole("button", { name: "Send report" }).click();
      await expect(
        vote.getByText("Your report: Coins were rounded the wrong way"),
      ).toBeVisible();

      const rows = await withDb((c) =>
        c.query(
          `select kind, reason from public.scoring_votes where user_id = $1`,
          [userJ],
        ),
      );
      expect(rows.rows).toEqual([
        { kind: "flag", reason: "Coins were rounded the wrong way" },
      ]);

      await vote.getByRole("button", { name: "Remove my vote" }).click();
      await expect(vote.getByText("Your vote was removed.")).toBeVisible();
      const after = await withDb((c) =>
        c.query(`select 1 from public.scoring_votes where user_id = $1`, [
          userJ,
        ]),
      );
      expect(after.rowCount).toBe(0);
    });
  });

  test("the sheet used last becomes the default next time", async ({
    browser,
  }) => {
    await asUser(browser, "j", async (page) => {
      await page.goto(`/en/games/${gameId}/plays/new`);
      await expect(page.locator("#play-sheet option:checked")).toHaveText(
        ALPHA,
      );
    });
  });

  test("the author cannot vote on their own sheet", async ({ browser }) => {
    await asUser(browser, "i", async (page) => {
      await page.goto(`/en/games/${gameId}/plays/new`);
      await page.getByLabel("Score sheet").selectOption({ label: S1 });
      await fill(page, 1, "Cy", "4");
      await fill(page, 2, "Di", "2");
      await page.getByRole("button", { name: "Save match" }).click();
      // Their own sheet: back to the game page, no vote prompt anywhere.
      await expect(page).toHaveURL(new RegExp(`/en/games/${gameId}$`));
      await page.getByRole("tab", { name: /^Matches/ }).click();
      await page.getByRole("link", { name: /Cy/ }).first().click();
      await expect(
        page.getByRole("heading", { level: 1, name: "Match" }),
      ).toBeVisible();
      await expect(page.getByText("How accurate was this sheet?")).toHaveCount(
        0,
      );
    });
  });

  test("disabling a sheet hides it from others but their matches keep working", async ({
    browser,
  }) => {
    const playPath = await withDb(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `select id from public.plays where created_by = $1 order by created_at limit 1`,
        [userJ],
      );
      return `/en/games/${gameId}/plays/${rows[0].id}`;
    });
    await asUser(browser, "k", async (page) => {
      await page.goto(sheetUrl(ALPHA));
      const moderation = page.getByRole("region", { name: "Moderation" });
      await moderation.getByRole("button", { name: "Disable sheet" }).click();
      await expect(
        moderation.getByRole("button", { name: "Enable sheet" }),
      ).toBeVisible();
    });
    await asUser(browser, "j", async (page) => {
      // Having used a disabled sheet is no way around the moderation: it can still be
      // read (the match needs it) but it cannot be copied and republished.
      await page.goto(sheetUrl(ALPHA));
      await expect(page.getByText(/This sheet is disabled/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(0);

      await page.goto(sheetsUrl());
      expect(await communityTitles(page)).not.toContain(ALPHA);

      await page.goto(`/en/games/${gameId}/plays/new`);
      await expect(
        page.locator("#play-sheet option", { hasText: ALPHA }),
      ).toHaveCount(0);

      // The match that used it still opens, with its sheet and scores.
      await page.goto(playPath);
      await expect(
        page.getByRole("heading", { level: 1, name: "Match" }),
      ).toBeVisible();
      await expect(page.getByLabel("Score sheet")).toBeDisabled();
      await expect(page.locator("#play-sheet option")).toHaveText(ALPHA);
      await page.getByRole("tab", { name: "Military" }).click();
      await expect(page.getByLabel(/^Military – /).first()).toHaveValue("6");
    });
    await asUser(browser, "k", async (page) => {
      await page.goto(sheetUrl(ALPHA));
      await page
        .getByRole("region", { name: "Moderation" })
        .getByRole("button", { name: "Enable sheet" })
        .click();
      await expect(
        page.getByRole("button", { name: "Disable sheet" }),
      ).toBeVisible();
    });
  });

  test("unpublishing keeps other people's matches working; a used sheet cannot be deleted", async ({
    browser,
  }) => {
    // Judy logs a match on Ivan's sheet (through the database: the UI is covered above).
    const playId = await withDb(async (c) => {
      const play = await c.query<{ id: string }>(
        `insert into public.plays (created_by, game_id, scoring_version_id)
         values ($1,$2,$3) returning id`,
        [userJ, gameId, versionIds[S1]],
      );
      const zed = await c.query<{ id: string }>(
        `insert into public.players (owner_id, name) values ($1,'Zed') returning id`,
        [userJ],
      );
      const person = await c.query<{ id: string }>(
        `insert into public.play_participants (play_id, seat, player_id, total_score, rank, is_winner)
         values ($1,0,$2,5,1,true) returning id`,
        [play.rows[0].id, zed.rows[0].id],
      );
      await c.query(
        `insert into public.play_scores (participant_id, category_key, value) values ($1,'military','5'::jsonb)`,
        [person.rows[0].id],
      );
      return play.rows[0].id;
    });

    await asUser(browser, "i", async (page) => {
      await page.goto(sheetsUrl());
      const item = page.getByRole("listitem").filter({ hasText: S1 });
      await item.getByRole("button", { name: "Unpublish" }).click();
      await item.getByRole("button", { name: "Yes, unpublish" }).click();
      await expect(item.getByText("Private", { exact: true })).toBeVisible();

      // It is in use by somebody else's match: deleting it is refused.
      await item.getByRole("button", { name: "Delete" }).click();
      await item.getByRole("button", { name: "Yes, delete" }).click();
      await expect(
        page.getByText("This sheet has matches, so it can't be deleted."),
      ).toBeVisible();
    });

    await asUser(browser, "j", async (page) => {
      await page.goto(sheetsUrl());
      expect(await communityTitles(page)).not.toContain(S1); // gone from the community list
      await page.goto(`/en/games/${gameId}/plays/new`);
      await expect(
        page
          .locator("#play-sheet option", { hasText: `${S1}` })
          .filter({ hasNotText: "(copy)" }),
      ).toHaveCount(0);

      // ...but Judy's own match still opens and shows the sheet.
      await page.goto(`/en/games/${gameId}/plays/${playId}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Match" }),
      ).toBeVisible();
      await expect(page.locator("#play-sheet option")).toHaveText(S1);
      await page.getByRole("tab", { name: "Military" }).click();
      await expect(page.getByLabel(/^Military – /).first()).toHaveValue("5");
    });
  });

  test("the daily publication limit is explained", async ({ browser }) => {
    // Five other sheets already published today by Ivan. They are seeded with triggers
    // bypassed for this session only (the trigger would count his earlier publication
    // and refuse the fifth); the sixth publication, through the app, must be refused.
    await withDb(async (c) => {
      await c.query("begin");
      await c.query("set local session_replication_role = replica");
      for (let n = 1; n <= 5; n++) {
        const sheet = await c.query<{ id: string }>(
          `insert into public.scoring_sheets (game_id, owner_id, title, locale, visibility, published_at)
           values ($1,$2,$3,'en','public', now()) returning id`,
          [gameId, userI, `Limit ${n}`],
        );
        await c.query(
          `insert into public.scoring_sheet_versions (sheet_id, version, definition) values ($1,1,$2::jsonb)`,
          [sheet.rows[0].id, JSON.stringify(SEVEN_WONDERS)],
        );
      }
      await c.query("commit");
    });
    await asUser(browser, "i", async (page) => {
      await page.goto(sheetsUrl());
      const item = page.getByRole("listitem").filter({ hasText: S1 });
      await item.getByRole("button", { name: "Publish" }).click();
      await item.getByRole("button", { name: "Yes, publish" }).click();
      await expect(
        page.getByText(
          "You can publish up to 5 sheets a day. Try again tomorrow.",
        ),
      ).toBeVisible();
    });
    await withDb((c) =>
      c.query(
        `delete from public.scoring_sheets where title like 'Limit %' and owner_id = $1`,
        [userI],
      ),
    );
  });
});

test.describe("deleting an account", () => {
  test("a sheet other people used survives, anonymous; their matches stay intact", async ({
    browser,
  }) => {
    const before = await withDb((c) =>
      c.query<{ id: string }>(
        `select id from public.plays where created_by = $1`,
        [userJ],
      ),
    );
    expect(before.rowCount).toBeGreaterThan(0);

    const result = await withDb(async (c) => {
      await c.query(`delete from public.profiles where id = $1`, [userI]);
      const one = async (sql: string, p: unknown[] = []) =>
        (await c.query(sql, p)).rows[0];
      return {
        shared: await one(
          `select owner_id from public.scoring_sheets where id = $1`,
          [sheetIds[S1]],
        ),
        versions: (
          await one(
            `select count(*)::int n from public.scoring_sheet_versions where sheet_id = $1`,
            [sheetIds[S1]],
          )
        ).n,
        secret: (
          await one(
            `select count(*)::int n from public.scoring_sheets where id = $1`,
            [sheetIds[SECRET]],
          )
        ).n,
        custom: (
          await one(
            `select count(*)::int n from public.scoring_sheets where id = $1`,
            [sheetIds[CUSTOM_SHEET]],
          )
        ).n,
        judyPlays: (
          await one(
            `select count(*)::int n from public.plays where created_by = $1`,
            [userJ],
          )
        ).n,
      };
    });
    expect(result).toEqual({
      shared: { owner_id: null },
      versions: 1,
      secret: 0,
      custom: 0,
      judyPlays: before.rowCount,
    });

    await asUser(browser, "j", async (page) => {
      const playId = before.rows[before.rows.length - 1].id;
      const response = await page.goto(`/en/games/${gameId}/plays/${playId}`);
      expect(response?.status()).toBe(200);
    });
  });
});

test.describe("translations, accessibility and mobile", () => {
  test("the community section is translated (es, fr)", async ({ browser }) => {
    await asUser(browser, "j", async (page) => {
      await page.goto(sheetsUrl(gameId, "es"));
      await expect(
        page.getByRole("heading", { name: "Hojas de la comunidad" }),
      ).toBeVisible();
      await page.goto(sheetsUrl(gameId, "fr"));
      await expect(
        page.getByRole("heading", { name: "Feuilles de la communauté" }),
      ).toBeVisible();
    });
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`sheets page, a community sheet, the vote prompt and moderation have no axe violations (${scheme})`, async ({
      browser,
    }) => {
      const check = async (page: Page, path: string) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations, `${path} (${scheme})`).toEqual([]);
      };
      const playPath = await withDb(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `select p.id from public.plays p join public.scoring_sheet_versions v on v.id = p.scoring_version_id
            where p.created_by = $1 and v.id = $2 limit 1`,
          [userJ, versionIds[ALPHA]],
        );
        return `/en/games/${gameId}/plays/${rows[0].id}`;
      });
      await asUser(
        browser,
        "j",
        async (page) => {
          await check(page, sheetsUrl());
          await check(page, sheetUrl(BETA));
          await check(page, playPath);
        },
        { colorScheme: scheme },
      );
      await asUser(browser, "k", (page) => check(page, sheetUrl(ALPHA)), {
        colorScheme: scheme,
      });
    });
  }

  test("the community pages fit a phone: no sideways scroll, controls at least 44 px", async ({
    browser,
  }) => {
    await asUser(
      browser,
      "j",
      async (page) => {
        for (const path of [sheetsUrl(), sheetUrl(BETA)]) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          );
          expect(overflow, path).toBeLessThanOrEqual(0);
        }
        const copy = page.getByRole("button", { name: "Copy" });
        expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(43);
      },
      { viewport: { width: 390, height: 844 } },
    );
  });
});
