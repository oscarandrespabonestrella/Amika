import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { Client } from "pg";
import {
  canRunAppTests,
  cleanupCatalogFixtures,
  insertImportedGame,
  STATE_FILE,
  TEST_USERS,
  testUserId,
  withDb,
} from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
test.use({ storageState: STATE_FILE.m });
test.describe.configure({ mode: "serial" });

// Own reserved id range: 9900 games, 9901 library, 9902 game center, 9903 sheets,
// 9904 plays, 9905 sheet sharing, 9906 players.
const PREFIX = "9907";

let userM: string;
const games: Record<string, string> = {};
const players: Record<string, string> = {};

const wipe = async () => {
  await cleanupCatalogFixtures([userM], PREFIX);
  await withDb((c) =>
    c.query(`delete from public.players where owner_id = $1`, [userM]),
  );
};

async function seedGame(c: Client, n: number, name: string) {
  return insertImportedGame(c, {
    source: "bgg",
    externalId: `${PREFIX}0${n}`,
    language: "en",
    kind: "base",
    name,
    description: "Fixture",
    yearPublished: 2012,
    minPlayers: 2,
    maxPlayers: 12,
    minPlaytime: 30,
    maxPlaytime: 60,
    minAge: 8,
    coverUrl: null,
    terms: [],
    relations: [],
  });
}

async function seedPlayer(c: Client, name: string, me = false) {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.players (owner_id, name, linked_user_id) values ($1,$2,$3) returning id`,
    [userM, name, me ? userM : null],
  );
  players[name] = rows[0].id;
}

/** Ranks like the server does: highest first, ties all win, null totals unranked. */
async function seedMatch(
  c: Client,
  gameId: string,
  playedOn: string,
  minutes: number | null,
  entries: [string, number | null][],
) {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.plays (created_by, game_id, played_on, duration_minutes)
     values ($1,$2,$3,$4) returning id`,
    [userM, gameId, playedOn, minutes],
  );
  const totals = entries.map(([, t]) => t);
  for (const [seat, [name, total]] of entries.entries()) {
    const rank =
      total === null
        ? null
        : 1 + totals.filter((o) => o !== null && o > total).length;
    await c.query(
      `insert into public.play_participants (play_id, seat, player_id, total_score, rank, is_winner)
       values ($1,$2,$3,$4,$5,$6)`,
      [rows[0].id, seat, players[name], total, rank, rank === 1],
    );
  }
}

test.beforeAll(async () => {
  userM = await testUserId(TEST_USERS.m.email);
  await withDb((c) =>
    c.query(
      `insert into public.profiles (id) values ($1) on conflict do nothing`,
      [userM],
    ),
  );
  await wipe();
  await withDb(async (c) => {
    games.main = await seedGame(c, 1, "Stats Main E2E");
    games.merge = await seedGame(c, 2, "Stats Merge E2E");
    games.unscored = await seedGame(c, 3, "Stats Unscored E2E");
    games.empty = await seedGame(c, 4, "Stats Empty E2E");
    games.many = await seedGame(c, 5, "Stats Many E2E");
    for (const n of ["Ana", "Bo", "Cy", "Xi", "Yo", "Zed"])
      await seedPlayer(c, n);
    for (const n of ["Ada", "Ben", "Cal", "Dax", "Eve", "Fox", "Gus"])
      await seedPlayer(c, n);

    // main: Ana 4 matches / 3 wins (one a tie) / avg 8.75 / best 12; Bo 4 / 2 / 5.5 / 9; Cy 1 / 0 / 3 / 3.
    await seedMatch(c, games.main, "2026-01-01", 30, [
      ["Ana", 10],
      ["Bo", 4],
    ]);
    await seedMatch(c, games.main, "2026-01-02", 60, [
      ["Ana", 8],
      ["Bo", 8],
      ["Cy", 3],
    ]);
    await seedMatch(c, games.main, "2026-01-03", null, [
      ["Ana", 5],
      ["Bo", 9],
    ]);
    await seedMatch(c, games.main, "2026-01-04", null, [
      ["Ana", 12],
      ["Bo", 1],
    ]);

    // merge: Xi and Zed are the same person written twice; they never played together.
    await seedMatch(c, games.merge, "2026-01-01", null, [
      ["Xi", 10],
      ["Yo", 2],
    ]);
    await seedMatch(c, games.merge, "2026-01-02", null, [
      ["Zed", 9],
      ["Yo", 1],
    ]);

    // unscored: matches without any total.
    await seedMatch(c, games.unscored, "2026-01-01", null, [
      ["Ana", null],
      ["Bo", null],
    ]);

    // many: 7 players, 2 scored matches each.
    const seven = ["Ada", "Ben", "Cal", "Dax", "Eve", "Fox", "Gus"];
    await seedMatch(
      c,
      games.many,
      "2026-02-01",
      null,
      seven.map((n, i) => [n, i + 1] as [string, number]),
    );
    await seedMatch(
      c,
      games.many,
      "2026-02-02",
      null,
      seven.map((n, i) => [n, 7 - i] as [string, number]),
    );
  });
});

test.afterAll(wipe);

const section = (page: Page) =>
  page.getByRole("region", { name: "Statistics" });
const byPlayer = (page: Page) =>
  section(page).getByRole("table", { name: "Statistics by player" });
const row = (table: Locator, name: string) =>
  table.getByRole("row").filter({
    has: table.page().getByRole("rowheader", { name, exact: true }),
  });
const cells = async (r: Locator) =>
  (await r.getByRole("cell").allInnerTexts()).map((t) =>
    t.replace(/[  ]/g, " ").trim(),
  );

test.describe("statistics of a game", () => {
  test("shows the exact numbers per player", async ({ page }) => {
    await page.goto(`/en/games/${games.main}`);
    await expect(section(page)).toBeVisible();
    const table = byPlayer(page);
    // matches, wins, win rate, average, best
    expect(await cells(row(table, "Ana"))).toEqual([
      "4",
      "3",
      "75%",
      "8.75",
      "12",
    ]);
    expect(await cells(row(table, "Bo"))).toEqual([
      "4",
      "2",
      "50%",
      "5.5",
      "9",
    ]);
    expect(await cells(row(table, "Cy"))).toEqual(["1", "0", "0%", "3", "3"]);
    // Ordered by wins: Ana, Bo, Cy.
    await expect(table.getByRole("rowheader")).toHaveText(["Ana", "Bo", "Cy"]);
  });

  test("tiles: matches, average duration of the recorded ones, last played", async ({
    page,
  }) => {
    await page.goto(`/en/games/${games.main}`);
    const s = section(page);
    const tiles = s.locator("dl > div");
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(0)).toHaveText(/^Matches\s*4$/);
    await expect(tiles.nth(1)).toHaveText(/^Average duration\s*45 min$/);
    await expect(tiles.nth(2)).toHaveText(/^Last played\s*Jan 4, 2026$/);
  });

  test("renders both charts, each with a table equivalent", async ({
    page,
  }) => {
    await page.goto(`/en/games/${games.main}`);
    const wins = section(page)
      .getByRole("figure")
      .filter({ hasText: "Wins by player" });
    const evolution = section(page)
      .getByRole("figure")
      .filter({ hasText: "Score in each match" });
    await expect(wins.locator("svg").first()).toBeVisible();
    await expect(evolution.locator("svg").first()).toBeVisible();
    // The table behind "Show as table" carries the same numbers.
    await evolution.getByText("Show as table").click();
    const table = evolution.getByRole("table", { name: "Score in each match" });
    await expect(table.getByRole("columnheader")).toHaveText([
      "Match",
      "Date",
      "Ana",
      "Bo",
      "Cy",
    ]);
    await expect(table.getByRole("row")).toHaveCount(5); // header + 4 matches
    await expect(table.getByRole("row").nth(2)).toContainText("8"); // match 2
    expect(await cells(table.getByRole("row").nth(2))).toEqual([
      "Jan 2, 2026",
      "8",
      "8",
      "3",
    ]);
    // Cy only played match 2: a gap ("–"), never a zero, in the other matches.
    expect(await cells(table.getByRole("row").nth(1))).toEqual([
      "Jan 1, 2026",
      "10",
      "4",
      "–",
    ]);
  });

  test("the table opens from the keyboard", async ({ page }) => {
    await page.goto(`/en/games/${games.main}`);
    const wins = section(page)
      .getByRole("figure")
      .filter({ hasText: "Wins by player" });
    await wins.getByText("Show as table").focus();
    await page.keyboard.press("Enter");
    await expect(wins.getByRole("table")).toBeVisible();
  });

  test("a merged player's numbers add up under one row", async ({ page }) => {
    await page.goto(`/en/games/${games.merge}`);
    await expect(byPlayer(page).getByRole("rowheader")).toHaveText([
      "Xi",
      "Zed",
      "Yo",
    ]);
    // Merge Zed into Xi the way merge_players does: move the matches, drop the player.
    await withDb(async (c) => {
      await c.query(
        `update public.play_participants set player_id = $1 where player_id = $2`,
        [players.Xi, players.Zed],
      );
      await c.query(`delete from public.players where id = $1`, [players.Zed]);
    });
    await page.reload();
    const table = byPlayer(page);
    await expect(table.getByRole("rowheader")).toHaveText(["Xi", "Yo"]);
    expect(await cells(row(table, "Xi"))).toEqual([
      "2",
      "2",
      "100%",
      "9.5",
      "10",
    ]);
    expect(await cells(row(table, "Yo"))).toEqual(["2", "0", "0%", "1.5", "2"]);
  });

  test("matches without any score: a table of dashes, no charts, no NaN", async ({
    page,
  }) => {
    await page.goto(`/en/games/${games.unscored}`);
    expect(await cells(row(byPlayer(page), "Ana"))).toEqual([
      "1",
      "0",
      "–",
      "–",
      "–",
    ]);
    await expect(section(page).getByRole("figure")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      /NaN|undefined|Infinity/,
    );
  });

  test("category breakdown: average POINTS per category for the most used sheet version", async ({
    page,
  }) => {
    const def = {
      schemaVersion: 1,
      categories: [
        { key: "wonders", label: "Wonders", type: "number" },
        { key: "coins", label: "Coins", type: "per_n", n: 3, pointsPer: 1 },
      ],
    };
    await withDb(async (c) => {
      games.sheet = await seedGame(c, 8, "Stats Sheet E2E");
      const sheet = await c.query<{ id: string }>(
        `insert into public.scoring_sheets (game_id, owner_id, title, locale)
         values ($1,$2,'Breakdown sheet','en') returning id`,
        [games.sheet, userM],
      );
      const v1 = (
        await c.query<{ id: string }>(
          `insert into public.scoring_sheet_versions (sheet_id, definition)
           values ($1,$2::jsonb) returning id`,
          [sheet.rows[0].id, JSON.stringify(def)],
        )
      ).rows[0].id;
      const v2 = (
        await c.query<{ id: string }>(
          `insert into public.scoring_sheet_versions (sheet_id, definition)
           values ($1,$2::jsonb) returning id`,
          [sheet.rows[0].id, JSON.stringify(def)],
        )
      ).rows[0].id;
      const match = async (
        version: string,
        day: string,
        people: [string, number, Record<string, number>][],
      ) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into public.plays (created_by, game_id, played_on, scoring_version_id)
           values ($1,$2,$3,$4) returning id`,
          [userM, games.sheet, day, version],
        );
        for (const [seat, [name, total, values]] of people.entries()) {
          const pp = await c.query<{ id: string }>(
            `insert into public.play_participants (play_id, seat, player_id, total_score, rank, is_winner)
             values ($1,$2,$3,$4,1,false) returning id`,
            [rows[0].id, seat, players[name], total],
          );
          for (const [key, value] of Object.entries(values))
            await c.query(
              `insert into public.play_scores (participant_id, category_key, value) values ($1,$2,$3::jsonb)`,
              [pp.rows[0].id, key, JSON.stringify(value)],
            );
        }
      };
      await match(v1, "2026-04-01", [
        ["Ana", 12, { wonders: 10, coins: 6 }],
        ["Bo", 5, { wonders: 4, coins: 3 }],
      ]);
      await match(v1, "2026-04-02", [
        ["Ana", 9, { wonders: 6, coins: 9 }],
        ["Bo", 8, { wonders: 8, coins: 0 }],
      ]);
      await match(v1, "2026-04-03", [["Ana", 5, { wonders: 5 }]]);
      await match(v2, "2026-04-04", [["Ana", 99, { wonders: 99 }]]);
    });
    await page.goto(`/en/games/${games.sheet}`);
    const block = section(page).getByRole("region", {
      name: "Average points by category",
    });
    await expect(block).toContainText("Breakdown sheet");
    await expect(block).toContainText("3 matches");
    await expect(block).toContainText("1 match used another version");
    const table = block.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText([
      "Player",
      "Wonders",
      "Coins",
    ]);
    // Points, not typed values: coins 6 / 9 / (missing) -> 2 / 3 / 0 points -> 1.7.
    expect(await cells(row(table, "Ana"))).toEqual(["7", "1.7"]);
    expect(await cells(row(table, "Bo"))).toEqual(["6", "0.5"]);
  });

  test("manual-totals games show no category breakdown", async ({ page }) => {
    await page.goto(`/en/games/${games.main}`);
    await expect(section(page)).toBeVisible();
    await expect(
      section(page).getByRole("region", { name: "Average points by category" }),
    ).toHaveCount(0);
  });

  test("a game without matches has no statistics section", async ({ page }) => {
    await page.goto(`/en/games/${games.empty}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
  });

  test("7 players: the chart draws the 5 most frequent, the table lists all 7", async ({
    page,
  }) => {
    await page.goto(`/en/games/${games.many}`);
    await expect(byPlayer(page).getByRole("rowheader")).toHaveCount(7);
    await expect(
      section(page).getByText(
        /The score chart shows the 5 most frequent players/,
      ),
    ).toBeVisible();
    const evolution = section(page)
      .getByRole("figure")
      .filter({ hasText: "Score in each match" });
    await evolution.getByText("Show as table").click();
    await expect(
      evolution.getByRole("table").getByRole("columnheader"),
    ).toHaveText(["Match", "Date", "Ada", "Ben", "Cal", "Dax", "Eve"]);
  });

  test("Spanish and French read numbers and dates in their locale", async ({
    page,
  }) => {
    await page.goto(`/es/games/${games.main}`);
    const es = page
      .getByRole("region", { name: "Estadísticas" })
      .getByRole("table");
    expect(await cells(row(es, "Ana"))).toEqual([
      "4",
      "3",
      "75 %",
      "8,75",
      "12",
    ]);
    await expect(es).toBeVisible();
    await page.goto(`/fr/games/${games.main}`);
    const fr = page
      .getByRole("region", { name: "Statistiques" })
      .getByRole("table");
    await expect(fr).toContainText("8,75");
  });

  test("never shows another user's matches", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE_FILE.l });
    const page = await context.newPage();
    await page.goto(`/en/games/${games.main}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    await context.close();
  });
});

test.describe("accessibility and phones", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`game page with statistics has no axe violations (${scheme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: STATE_FILE.m,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      // The main game (charts) and the sheet game (category table too).
      for (const id of [games.main, games.sheet]) {
        await page.goto(`/en/games/${id}`);
        await expect(section(page)).toBeVisible();
        // Open every table so their content is audited too.
        for (const toggle of await section(page)
          .getByText("Show as table")
          .all())
          await toggle.click();
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations, `${scheme} ${id}`).toEqual([]);
      }
      await context.close();
    });
  }

  test("fits a 375 px phone: no sideways scroll, charts keep a readable size", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: STATE_FILE.m,
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto(`/en/games/${games.many}`);
    await expect(section(page)).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // The per-player table fits without its own sideways scroll.
    const tableScroll = await byPlayer(page).evaluate(
      (t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth,
    );
    expect(tableScroll).toBeLessThanOrEqual(0);
    const chart = section(page)
      .getByRole("figure")
      .filter({ hasText: "Score in each match" })
      .locator("svg")
      .first();
    const box = await chart.boundingBox();
    expect(box!.width).toBeGreaterThan(250);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Personal statistics (/stats): needs the "me" player.

const statsPage = (page: Page) => page.getByRole("main");
const meTiles = (page: Page) => statsPage(page).locator("dl > div");

async function markMe(name: string) {
  await withDb(async (c) => {
    await c.query(
      `update public.players set linked_user_id = null where owner_id = $1`,
      [userM],
    );
    await c.query(
      `update public.players set linked_user_id = $2 where id = $1`,
      [players[name], userM],
    );
  });
}

test.describe("personal statistics", () => {
  test("without a 'me' player it explains and links to My players", async ({
    page,
  }) => {
    await page.goto("/en/stats");
    await expect(
      page.getByRole("heading", { level: 1, name: "Statistics" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Choose which player is you" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open My players" }),
    ).toHaveAttribute("href", "/en/players");
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/NaN|undefined/);
  });

  test("with a 'me' player but no matches: an empty state, no zeros table", async ({
    page,
  }) => {
    await withDb(async (c) => {
      await seedPlayer(c, "Mia");
    });
    await markMe("Mia");
    await page.goto("/en/stats");
    await expect(
      page.getByRole("heading", { name: "No matches with you yet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse games" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("shows my record, most played games and head-to-head with exact numbers", async ({
    page,
  }) => {
    await withDb(async (c) => {
      games.me1 = await seedGame(c, 6, "Stats Me E2E");
      games.me2 = await seedGame(c, 7, "Stats Me Two E2E");
      await seedPlayer(c, "Dee");
      await seedMatch(c, games.me1, "2026-03-01", null, [
        ["Mia", 10],
        ["Ana", 4],
      ]);
      await seedMatch(c, games.me1, "2026-03-02", null, [
        ["Mia", 8],
        ["Ana", 8],
        ["Bo", 3],
      ]);
      await seedMatch(c, games.me1, "2026-03-03", null, [
        ["Mia", 5],
        ["Ana", 9],
      ]);
      await seedMatch(c, games.me1, "2026-03-04", null, [
        ["Mia", null],
        ["Ana", null],
      ]);
      await seedMatch(c, games.me1, "2026-03-05", null, [
        ["Dee", 5],
        ["Bo", 1],
      ]);
      await seedMatch(c, games.me2, "2026-03-06", null, [
        ["Mia", 3],
        ["Bo", 3],
      ]);
    });
    await page.goto("/en/stats");

    const tiles = meTiles(page);
    await expect(tiles).toHaveCount(4);
    await expect(tiles.nth(0)).toHaveText(/^Matches\s*5$/);
    await expect(tiles.nth(1)).toHaveText(/^Wins\s*3$/);
    await expect(tiles.nth(2)).toHaveText(/^Win rate\s*75%$/);
    await expect(tiles.nth(3)).toHaveText(/^Games played\s*2$/);

    const top = page.getByRole("list", { name: "Most played games" });
    await expect(top.getByRole("listitem")).toHaveCount(2);
    await expect(top.getByRole("listitem").nth(0)).toContainText(
      "Stats Me E2E",
    );
    await expect(top.getByRole("listitem").nth(0)).toContainText("4 matches");
    await expect(top.getByRole("listitem").nth(0)).toContainText("2 wins");
    await expect(top.getByRole("listitem").nth(1)).toContainText(
      "Stats Me Two E2E",
    );
    await expect(top.getByRole("listitem").nth(1)).toContainText("1 match");
    await expect(
      top.getByRole("link", { name: "Stats Me E2E" }),
    ).toHaveAttribute("href", `/en/games/${games.me1}`);

    // Rival, matches together, my wins, their wins, ties. Cy and Dee never shared a
    // ranked match with me, so they are absent. Match 4 has no scores, so it says nothing.
    const h2h = page.getByRole("table", { name: "Head-to-head" });
    await expect(h2h.getByRole("rowheader")).toHaveText(["Ana", "Bo"]);
    expect(await cells(row(h2h, "Ana"))).toEqual(["3", "1", "1", "1"]);
    expect(await cells(row(h2h, "Bo"))).toEqual(["2", "1", "0", "1"]);
  });

  test("the Statistics item is in the navigation and marks the current page", async ({
    page,
  }) => {
    await page.goto("/en/home");
    const nav = page.locator("nav[aria-label='Main navigation']:visible");
    await nav.getByRole("link", { name: "Statistics" }).click();
    await expect(page).toHaveURL(/\/en\/stats$/);
    await expect(nav.getByRole("link", { name: "Statistics" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("Spanish and French labels and number formats", async ({ page }) => {
    await page.goto("/es/stats");
    await expect(
      page.getByRole("heading", { level: 1, name: "Estadísticas" }),
    ).toBeVisible();
    await expect(meTiles(page).nth(2)).toHaveText(/75\s%/);
    await page.goto("/fr/stats");
    await expect(
      page.getByRole("heading", { level: 1, name: "Statistiques" }),
    ).toBeVisible();
  });

  test("another user never sees these numbers", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE_FILE.l });
    const page = await context.newPage();
    await page.goto("/en/stats");
    // User l's own "me" state belongs to app-players.spec.ts (it changes while that spec
    // runs), so only assert that the page renders and that none of OUR data is on it.
    await expect(
      page.getByRole("heading", { level: 1, name: "Statistics" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Mia");
    await expect(page.locator("body")).not.toContainText("Stats Me E2E");
    await context.close();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the page has no axe violations (${scheme})`, async ({ browser }) => {
      const context = await browser.newContext({
        storageState: STATE_FILE.m,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      await page.goto("/en/stats");
      await expect(meTiles(page)).toHaveCount(4);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations, scheme).toEqual([]);
      await context.close();
    });
  }
});
