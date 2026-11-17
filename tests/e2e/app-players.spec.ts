import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
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
test.use({ storageState: STATE_FILE.l });
test.describe.configure({ mode: "serial" });

// Own reserved id range: 9900 games, 9901 library, 9902 game center, 9903 sheets,
// 9904 plays, 9905 sheet sharing.
const PREFIX = "9906";
const GAME_NAME = "Roster Game E2E";

let userL: string;
let gameId: string;

const wipe = async () => {
  await cleanupCatalogFixtures([userL], PREFIX); // games -> matches -> participants
  await withDb((c) =>
    c.query(`delete from public.players where owner_id = $1`, [userL]),
  );
};

test.beforeAll(async () => {
  userL = await testUserId(TEST_USERS.l.email);
  await withDb((c) =>
    c.query(
      `insert into public.profiles (id) values ($1) on conflict do nothing`,
      [userL],
    ),
  );
  await wipe();
  await withDb(async (c) => {
    gameId = await insertImportedGame(c, {
      source: "bgg",
      externalId: `${PREFIX}01`,
      language: "en",
      kind: "base",
      name: GAME_NAME,
      description: "Fixture",
      yearPublished: 2012,
      minPlayers: 2,
      maxPlayers: 6,
      minPlaytime: 30,
      maxPlaytime: 60,
      minAge: 8,
      coverUrl: null,
      terms: [],
      relations: [],
    });
  });
});

test.afterAll(wipe);

const rosterNames = () =>
  withDb(async (c) =>
    (
      await c.query<{ name: string }>(
        `select name from public.players where owner_id = $1 order by name`,
        [userL],
      )
    ).rows.map((r) => r.name),
  );

const playerList = (page: Page) =>
  page.getByRole("list", { name: "Your players" });
const playerItem = (page: Page, name: string) =>
  playerList(page)
    .getByRole("listitem")
    .filter({ has: page.getByText(name, { exact: true }) });

/** Logs a manual-totals match for the given [name, total] pairs and returns to the game page. */
async function logMatch(page: Page, entries: [string, string][]) {
  await page.goto(`/en/games/${gameId}/plays/new`);
  for (const [index, [name, total]] of entries.entries()) {
    const n = index + 1;
    if (n > 2) await page.getByRole("button", { name: "Add player" }).click();
    await pickPlayer(page, n, name);
    await page
      .getByLabel(/^Total points – /)
      .nth(index)
      .fill(total);
  }
  await page.getByRole("button", { name: "Save match" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/games/${gameId}$`));
}

test.describe("creating players from matches", () => {
  test("the first match creates players from the typed names", async ({
    page,
  }) => {
    await page.goto("/en/players");
    await expect(
      page.getByRole("heading", { name: "No players yet" }),
    ).toBeVisible();

    await logMatch(page, [
      ["Ana", "10"],
      ["Bo", "5"],
    ]);
    await page.goto("/en/players");
    for (const name of ["Ana", "Bo"])
      await expect(playerItem(page, name).getByText("1 match")).toBeVisible();
    expect(await rosterNames()).toEqual(["Ana", "Bo"]);
  });

  test('typing "ana " or "Aná" reuses Ana: no duplicate player (Review Focus 3)', async ({
    page,
  }) => {
    await logMatch(page, [
      ["ana ", "7"],
      ["Cy", "3"],
    ]);
    await logMatch(page, [
      ["Aná", "9"],
      ["Bo", "2"],
    ]);
    expect(await rosterNames()).toEqual(["Ana", "Bo", "Cy"]);
    await page.goto("/en/players");
    await expect(playerItem(page, "Ana").getByText("3 matches")).toBeVisible();
  });

  test("the same player cannot be chosen twice in one match", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}/plays/new`);
    await pickPlayer(page, 1, "Ana");
    await page
      .getByRole("group", { name: "Player 2" })
      .getByRole("combobox")
      .click();
    // Ana is already used by row 1: not offered, and typing her name offers nothing.
    await expect(
      page.getByRole("option", { name: "Ana", exact: true }),
    ).toHaveCount(0);
    const search = page.getByPlaceholder("Search or add a player…");
    await search.fill("ana ");
    await expect(page.getByText("No players found.")).toBeVisible();
    await expect(page.getByRole("option", { name: /^Add/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("names the browser thinks differ but the database folds together get a clear message", async ({
    page,
  }) => {
    // "Søren" / "Soren": the database folds ø to o, the browser's imitation does not.
    await page.goto(`/en/games/${gameId}/plays/new`);
    await pickPlayer(page, 1, "Søren");
    await pickPlayer(page, 2, "Soren");
    for (const [n, name] of [
      [1, "Søren"],
      [2, "Soren"],
    ] as const)
      await page
        .getByLabel(`Total points – ${name.trim()}`, { exact: true })
        .fill(String(n));
    await page.getByRole("button", { name: "Save match" }).click();
    await expect(
      page.getByText(/The same player appears twice in this match/),
    ).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    // Nothing was saved, and no half-created player is left behind.
    expect(await rosterNames()).not.toContain("Søren");
  });

  test("keyboard only: open, type, Enter; focus returns to the field", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}/plays/new`);
    const first = page
      .getByRole("group", { name: "Player 1" })
      .getByRole("combobox");
    await first.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Dee");
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("group", { name: "Player 1" })
        .getByRole("combobox", { name: /Dee/ }),
    ).toBeVisible();
    await expect(first).toBeFocused();
  });

  test("markup and emoji in names are shown as text and never executed", async ({
    page,
  }) => {
    const hostile = "<img src=x onerror=window.__pwned=1>";
    await logMatch(page, [
      [hostile, "4"],
      ["🐦 Zoë", "1"],
    ]);
    await page.goto("/en/players");
    await expect(page.getByText(hostile, { exact: true })).toBeVisible();
    await expect(page.getByText("🐦 Zoë", { exact: true })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
  });
});

test.describe("managing the roster", () => {
  test("renaming updates every match; renaming to an existing name shows the message", async ({
    page,
  }) => {
    await page.goto("/en/players");
    const ana = playerItem(page, "Ana");
    await ana.getByRole("button", { name: "Rename" }).click();
    await ana.getByLabel("New name for Ana").fill("Anita");
    await ana.getByRole("button", { name: "Save" }).click();
    await expect(playerItem(page, "Anita")).toBeVisible();

    await page.goto(`/en/games/${gameId}`);
    await page.getByRole("tab", { name: /^Matches/ }).click();
    await expect(
      page.getByRole("region", { name: "Matches" }).getByText("Anita").first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Matches" })
        .getByText("Ana", { exact: true }),
    ).toHaveCount(0);

    await page.goto("/en/players");
    const bo = playerItem(page, "Bo");
    await bo.getByRole("button", { name: "Rename" }).click();
    await bo.getByLabel("New name for Bo").fill("anita");
    await bo.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText(
        "You already have a player with that name. Merge them instead.",
      ),
    ).toBeVisible();
  });

  test("merging moves the matches; players who played together cannot be merged", async ({
    page,
  }) => {
    await page.goto("/en/players");
    // Cy and Bo never shared a match: Cy merges into Bo.
    const cy = playerItem(page, "Cy");
    await cy.getByRole("button", { name: "Merge into…" }).click();
    await cy.getByLabel("Merge Cy into").selectOption({ label: "Bo" });
    await cy.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(playerList(page).getByText("Cy", { exact: true })).toHaveCount(
      0,
    );
    await expect(playerItem(page, "Bo").getByText("3 matches")).toBeVisible();
    expect(await rosterNames()).not.toContain("Cy");

    // Anita and Bo played together in the first match.
    const anita = playerItem(page, "Anita");
    await anita.getByRole("button", { name: "Merge into…" }).click();
    await anita.getByLabel("Merge Anita into").selectOption({ label: "Bo" });
    await anita.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(
      page.getByText(/took part in the same match, so they can't be merged/),
    ).toBeVisible();
    await expect(playerItem(page, "Anita")).toBeVisible();
  });

  test("a player with matches cannot be deleted; an unused one can", async ({
    page,
  }) => {
    await withDb((c) =>
      c.query(
        `insert into public.players (owner_id, name) values ($1,'Unused')`,
        [userL],
      ),
    );
    await page.goto("/en/players");
    await expect(
      playerItem(page, "Anita").getByText(
        "Has matches: merge them into another player instead.",
      ),
    ).toBeVisible();
    await expect(
      playerItem(page, "Anita").getByRole("button", { name: "Delete" }),
    ).toHaveCount(0);

    const unused = playerItem(page, "Unused");
    await unused.getByRole("button", { name: "Delete" }).click();
    await expect(unused.getByText("Delete Unused?")).toBeVisible();
    await unused.getByRole("button", { name: "Keep" }).click();
    await expect(unused).toBeVisible();
    await unused.getByRole("button", { name: "Delete" }).click();
    await unused.getByRole("button", { name: "Yes, delete" }).click();
    await expect(
      playerList(page).getByText("Unused", { exact: true }),
    ).toHaveCount(0);
  });

  test('"This is me" can be set, moved to another player and cleared', async ({
    page,
  }) => {
    await page.goto("/en/players");
    await playerItem(page, "Anita")
      .getByRole("button", { name: "This is me" })
      .click();
    await expect(
      playerItem(page, "Anita").getByText("Me", { exact: true }),
    ).toBeVisible();

    await playerItem(page, "Bo")
      .getByRole("button", { name: "This is me" })
      .click();
    await expect(
      playerItem(page, "Bo").getByText("Me", { exact: true }),
    ).toBeVisible();
    await expect(
      playerItem(page, "Anita").getByText("Me", { exact: true }),
    ).toHaveCount(0);
    const linked = await withDb((c) =>
      c.query(
        `select name from public.players where owner_id = $1 and linked_user_id = $1`,
        [userL],
      ),
    );
    expect(linked.rows).toEqual([{ name: "Bo" }]);

    await playerItem(page, "Bo")
      .getByRole("button", { name: "Not me" })
      .click();
    await expect(
      playerItem(page, "Bo").getByText("Me", { exact: true }),
    ).toHaveCount(0);
  });

  test("a saved match shows its stored players, and a merged player shows as the survivor", async ({
    page,
  }) => {
    const second = await withDb(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `select id from public.plays where created_by = $1 order by created_at limit 1 offset 1`,
            [userL],
          )
        ).rows[0].id,
    );
    await page.goto(`/en/games/${gameId}/plays/${second}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Match" }),
    ).toBeVisible();
    // The second match was "ana " + Cy; Ana was renamed Anita and Cy merged into Bo.
    await expect(
      page
        .getByRole("group", { name: "Player 1" })
        .getByRole("combobox", { name: /Anita/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "Player 2" })
        .getByRole("combobox", { name: /Bo/ }),
    ).toBeVisible();
  });
});

test.describe("links, isolation, translations", () => {
  test("My players is reachable from Settings and from the match form", async ({
    page,
  }) => {
    await page.goto("/en/settings");
    await page.getByRole("link", { name: "Open My players" }).click();
    await expect(page).toHaveURL(/\/en\/players$/);
    await page.goto(`/en/games/${gameId}/plays/new`);
    await page.getByRole("link", { name: "Manage players" }).click();
    await expect(page).toHaveURL(/\/en\/players$/);
  });

  test("another user has their own, empty roster", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE_FILE.b });
    const page = await context.newPage();
    await page.goto("/en/players");
    await expect(page.getByText("Anita")).toHaveCount(0);
    await context.close();
  });

  test("the page and the picker are translated (es, fr)", async ({ page }) => {
    await page.goto("/es/players");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Mis jugadores",
    );
    await page.goto("/fr/players");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Mes joueurs",
    );
    await page.goto(`/es/games/${gameId}/plays/new`);
    await page
      .getByRole("group", { name: "Jugador 1" })
      .getByRole("combobox")
      .click();
    await expect(
      page.getByPlaceholder("Busca o añade un jugador…"),
    ).toBeVisible();
  });
});

test.describe("accessibility and mobile", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`My players and the open picker have no axe violations (${scheme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: STATE_FILE.l,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      const check = async (label: string) => {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations, `${label} (${scheme})`).toEqual([]);
      };

      await page.goto("/en/players");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await check("/players");

      await page.goto(`/en/games/${gameId}/plays/new`);
      await page
        .getByRole("group", { name: "Player 1" })
        .getByRole("combobox")
        .click();
      await expect(
        page.getByPlaceholder("Search or add a player…"),
      ).toBeVisible();
      await check("picker open");
      await page.keyboard.press("Escape");
      await context.close();
    });
  }

  test("the page fits a phone: no sideways scroll and controls at least 44 px", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: STATE_FILE.l,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/en/players");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const rename = page.getByRole("button", { name: "Rename" }).first();
    expect((await rename.boundingBox())!.height).toBeGreaterThanOrEqual(43);

    await page.goto(`/en/games/${gameId}/plays/new`);
    const combobox = page
      .getByRole("group", { name: "Player 1" })
      .getByRole("combobox");
    expect((await combobox.boundingBox())!.height).toBeGreaterThanOrEqual(43);
    await combobox.click();
    const search = page.getByPlaceholder("Search or add a player…");
    // Layout height: the popover is still zooming in (scaled) when it opens.
    expect(
      await search.evaluate((el) => (el as HTMLElement).offsetHeight),
    ).toBeGreaterThanOrEqual(44);
    await context.close();
  });
});
