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
const games: Record<"main" | "merge" | "unscored" | "empty" | "many", string> =
  {} as never;
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
      section(page).getByText(/Charts show the 5 most frequent players/),
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
      await page.goto(`/en/games/${games.main}`);
      await expect(section(page)).toBeVisible();
      // Open every table so their content is audited too.
      for (const toggle of await section(page).getByText("Show as table").all())
        await toggle.click();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations, scheme).toEqual([]);
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
