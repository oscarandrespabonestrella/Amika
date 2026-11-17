import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  canRunAppTests,
  cleanupCatalogFixtures,
  E2E_EXTERNAL_PREFIX,
  insertImportedGame,
  listUserPhotoPaths,
  STATE_FILE,
  TEST_USERS,
  testUserId,
  withDb,
} from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
test.use({ storageState: STATE_FILE.c });
// Shared fixtures and ordered flows (create -> find -> photo -> delete).
test.describe.configure({ mode: "serial" });

const IMPORTED = {
  source: "bgg",
  externalId: `${E2E_EXTERNAL_PREFIX}01`,
  language: "en",
  kind: "base",
  name: "Catán E2E Game",
  description: "Trade and build.\n\nSecond paragraph with <b>no html</b>.",
  yearPublished: 1995,
  minPlayers: 3,
  maxPlayers: 4,
  minPlaytime: 60,
  maxPlaytime: 120,
  minAge: 10,
  coverUrl: null,
  terms: [
    {
      type: "category",
      externalId: `${E2E_EXTERNAL_PREFIX}11`,
      name: "Economic E2E",
    },
    {
      type: "mechanic",
      externalId: `${E2E_EXTERNAL_PREFIX}12`,
      name: "Dice Rolling E2E",
    },
  ],
  relations: [
    {
      type: "has_expansion",
      externalId: `${E2E_EXTERNAL_PREFIX}02`,
      name: "E2E Seafarers",
    },
  ],
};

const CUSTOM_NAME = `E2E Ñandú ${Date.now()}`;
// 1x1 PNG: enough to exercise decoding, resizing and upload.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** The photo buttons stay disabled until Clerk has loaded the user in the browser. */
const waitForPhotoControls = (page: Page) =>
  expect(page.getByRole("button", { name: "Choose photo" })).toBeEnabled();

let userC: string;
let customGameUrl: string;

test.beforeAll(async () => {
  userC = await testUserId(TEST_USERS.c.email);
  await cleanupCatalogFixtures([userC]);
  await withDb((c) => insertImportedGame(c, IMPORTED));
});

test.afterAll(async () => {
  await cleanupCatalogFixtures([userC]);
});

const search = async (page: Page, text: string) => {
  await page.getByRole("searchbox", { name: "Search games" }).fill(text);
  await page.getByRole("button", { name: "Search", exact: true }).click();
};

test.describe("search the catalog", () => {
  test("finds a game ignoring accents and case", async ({ page }) => {
    await page.goto("/en/games");
    await search(page, "CATAN e2e");
    await expect(page).toHaveURL(/\/en\/games\?q=/);
    await expect(
      page.getByRole("link", { name: /Catán E2E Game/ }),
    ).toBeVisible();
    await expect(page.getByText("1 game", { exact: true })).toBeVisible();
  });

  test("shows an empty state when nothing matches", async ({ page }) => {
    await page.goto("/en/games?q=zzzzqqqq");
    await expect(
      page.getByRole("heading", { name: "No games found" }),
    ).toBeVisible();
  });

  test("filters by number of players and by type", async ({ page }) => {
    const card = page.getByRole("link", { name: /Catán E2E Game/ });

    await page.goto("/en/games?q=catan+e2e&players=4");
    await expect(card).toBeVisible();

    await page.goto("/en/games?q=catan+e2e&players=6");
    await expect(card).toHaveCount(0);

    await page.goto("/en/games?q=catan+e2e&kind=expansion");
    await expect(card).toHaveCount(0);

    await page.goto("/en/games?q=catan+e2e&time=30");
    await expect(card).toHaveCount(0); // starts at 60 min
  });

  test("ignores a malformed filter instead of failing", async ({ page }) => {
    const response = await page.goto(
      "/en/games?q=catan+e2e&players=abc&kind=dlc",
    );
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("link", { name: /Catán E2E Game/ }),
    ).toBeVisible();
  });

  test("treats SQL/LIKE wildcards as plain text", async ({ page }) => {
    await page.goto("/en/games?q=%25");
    await expect(
      page.getByRole("link", { name: /Catán E2E Game/ }),
    ).toHaveCount(0);
  });

  test("BoardGameGeek search explains it is unavailable while the token is pending", async ({
    page,
  }) => {
    test.skip(
      !!process.env.BGG_API_TOKEN,
      "BGG token configured: unavailable state not shown",
    );
    await page.goto("/en/games?q=catan");
    await expect(
      page.getByText("BoardGameGeek search isn't available yet"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Search BoardGameGeek/ }),
    ).toHaveCount(0);
  });
});

test.describe("game page", () => {
  test("shows the imported game's details, safely", async ({ page }) => {
    await page.goto("/en/games?q=catan+e2e");
    await page.getByRole("link", { name: /Catán E2E Game/ }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Catán E2E Game",
    );
    await expect(page.getByText("3–4 players")).toBeVisible();
    await expect(page.getByText("60–120 min")).toBeVisible();
    await expect(page.getByText("10+")).toBeVisible();
    await expect(page.getByText("Economic E2E")).toBeVisible();
    await expect(page.getByText("Dice Rolling E2E")).toBeVisible();

    // Description is plain text: HTML-looking content must not become markup.
    await expect(
      page.getByText("Second paragraph with <b>no html</b>."),
    ).toBeVisible();
    await expect(page.locator("article b")).toHaveCount(0);

    // Expansions are grouped under the game, in their own tab.
    await page.getByRole("tab", { name: /Expansions/ }).click();
    await expect(page.getByText("E2E Seafarers")).toBeVisible();
    await expect(page.getByText("(Not in the catalog yet)")).toBeVisible();
    await page.getByRole("tab", { name: "Overview" }).click();

    const bgg = page.getByRole("link", { name: /View on BoardGameGeek/ });
    await expect(bgg).toHaveAttribute(
      "href",
      `https://boardgamegeek.com/boardgame/${E2E_EXTERNAL_PREFIX}01`,
    );
    await expect(bgg).toHaveAttribute("rel", /noopener/);
    await expect(
      page.getByText("Information provided by BoardGameGeek."),
    ).toBeVisible();
  });

  test("is translated", async ({ page }) => {
    await page.goto("/en/games?q=catan+e2e");
    const href = await page
      .getByRole("link", { name: /Catán E2E Game/ })
      .getAttribute("href");
    await page.goto(`/es${href!.replace(/^\/en/, "")}`);
    await expect(page.getByText("Descripción", { exact: true })).toBeVisible();
    await expect(page.getByText("3–4 jugadores")).toBeVisible();
    await page.goto(`/fr${href!.replace(/^\/en/, "")}`);
    await expect(page.getByText("3–4 joueurs")).toBeVisible();
  });

  test("an unknown or malformed id shows the 404 inside the app", async ({
    page,
  }) => {
    for (const id of ["00000000-0000-4000-8000-00000000dead", "not-a-uuid"]) {
      const response = await page.goto(`/en/games/${id}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Page not found",
      );
      await expect(
        page.locator("nav[aria-label='Main navigation']:visible"),
      ).toHaveCount(1);
    }
  });
});

test.describe("create your own game", () => {
  test("validates in the browser with translated messages", async ({
    page,
  }) => {
    await page.goto("/en/games/new");
    await page.getByRole("button", { name: "Create game" }).click();
    await expect(page.getByText("This field is required.")).toBeVisible();

    await page.getByLabel("Name").fill("X");
    await page.getByLabel("Min. players").fill("5");
    await page.getByLabel("Max. players").fill("2");
    await page.getByLabel("Year published").fill("abc");
    await page.getByRole("button", { name: "Create game" }).click();
    await expect(
      page.getByText("The maximum can't be lower than the minimum."),
    ).toBeVisible();
    await expect(page.getByText("Enter a valid number.")).toBeVisible();
    await expect(page).toHaveURL(/\/en\/games\/new$/);
  });

  test("shows the same validation in Spanish", async ({ page }) => {
    await page.goto("/es/games/new");
    await page.getByRole("button", { name: "Crear juego" }).click();
    await expect(page.getByText("Este campo es obligatorio.")).toBeVisible();
  });

  test("creates a private game and opens it", async ({ page }) => {
    await page.goto("/en/games/new");
    await page.getByLabel("Name").fill(CUSTOM_NAME);
    await page.getByLabel("Type").selectOption("expansion");
    await page.getByLabel("Min. players").fill("2");
    await page.getByLabel("Max. players").fill("4");
    await page.getByLabel("Min. minutes").fill("20");
    await page.getByLabel("Max. minutes").fill("45");
    await page
      .getByLabel("Description (optional)")
      .fill("Mi descripción privada");
    await page.getByRole("button", { name: "Create game" }).click();

    await expect(page).toHaveURL(/\/en\/games\/[0-9a-f-]{36}$/);
    customGameUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      CUSTOM_NAME,
    );
    await expect(page.getByText("My game", { exact: true })).toBeVisible();
    await expect(page.getByText("Expansion", { exact: true })).toBeVisible();
    await expect(page.getByText("Mi descripción privada")).toBeVisible();
    // A custom game has no BoardGameGeek link or attribution.
    await expect(
      page.getByRole("link", { name: /View on BoardGameGeek/ }),
    ).toHaveCount(0);

    const stored = await withDb((c) =>
      c.query("select source, owner_id from public.games where name = $1", [
        CUSTOM_NAME,
      ]),
    );
    expect(stored.rows).toEqual([{ source: "manual", owner_id: userC }]);
  });

  test("the new game is findable by its owner (accent-insensitive)", async ({
    page,
  }) => {
    await page.goto("/en/games");
    // With the BGG top 500 in the catalog a fuzzy two-word query is crowded out of the 30
    // results page; the accent-insensitive lookup uses the unique name without accents.
    await search(
      page,
      CUSTOM_NAME.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    );
    await expect(
      page.getByRole("link", { name: new RegExp(CUSTOM_NAME) }),
    ).toBeVisible();
    await expect(page.getByText("My game", { exact: true })).toBeVisible();
  });
});

test.describe("photos of your own copy", () => {
  test("uploads, shows and deletes a photo", async ({ page }) => {
    await page.goto(customGameUrl);
    await expect(page.getByText("No photos yet.")).toBeVisible();
    await waitForPhotoControls(page);

    await page.getByTestId("photo-input-file").setInputFiles({
      name: "box.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });

    const photo = page.getByRole("img", { name: `Photo 1 of ${CUSTOM_NAME}` });
    // upload = resize + storage + row + signed url + server refresh: allow more than 5 s
    await expect(photo).toBeVisible({ timeout: 20_000 });
    // The signed URL really serves an image.
    await expect
      .poll(() =>
        photo.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);

    // Stored under the owner's folder, re-encoded as JPEG, row created.
    await expect
      .poll(async () => (await listUserPhotoPaths(userC)).length)
      .toBe(1);
    const [path] = await listUserPhotoPaths(userC);
    expect(path.startsWith(`${userC}/`)).toBe(true);
    expect(path.endsWith(".jpg")).toBe(true);
    const rows = await withDb((c) =>
      c.query(
        "select user_id, storage_path from public.game_photos where user_id = $1",
        [userC],
      ),
    );
    expect(rows.rows).toEqual([{ user_id: userC, storage_path: path }]);

    // It survives a reload (fresh signed URL).
    await page.reload();
    await expect(
      page.getByRole("img", { name: `Photo 1 of ${CUSTOM_NAME}` }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete photo" }).click();
    await expect(page.getByText("No photos yet.")).toBeVisible();
    await expect
      .poll(async () => (await listUserPhotoPaths(userC)).length)
      .toBe(0);
    const after = await withDb((c) =>
      c.query("select 1 from public.game_photos where user_id = $1", [userC]),
    );
    expect(after.rowCount).toBe(0);
  });

  test("rejects a file that is not an image", async ({ page }) => {
    await page.goto(customGameUrl);
    await waitForPhotoControls(page);
    await page.getByTestId("photo-input-file").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(
      page.getByRole("alert").filter({ hasText: "isn't a readable image" }),
    ).toBeVisible();
    expect((await listUserPhotoPaths(userC)).length).toBe(0);
  });

  test("stops at 10 photos per game", async ({ page }) => {
    const gameId = customGameUrl.split("/").pop()!;
    await withDb(async (c) => {
      for (let i = 1; i <= 10; i++) {
        await c.query(
          "insert into public.game_photos (user_id, game_id, storage_path) values ($1,$2,$3)",
          [userC, gameId, `${userC}/${gameId}/seed-${i}.jpg`],
        );
      }
    });
    await page.goto(customGameUrl);
    await expect(
      page.getByText("You can keep up to 10 photos per game."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Take photo" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Choose photo" }),
    ).toBeDisabled();
  });
});

test.describe("accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`games, game page and form have no axe violations (${scheme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: STATE_FILE.c,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      for (const path of [
        "/en/games?q=catan+e2e",
        customGameUrl,
        "/en/games/new",
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations, `${path} (${scheme})`).toEqual([]);
      }
      await context.close();
    });
  }
});

test.describe("privacy between users", () => {
  test("another user cannot find or open your custom game, but sees global ones", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: STATE_FILE.b });
    const page = await context.newPage();

    await page.goto("/en/games?q=nandu+e2e");
    await expect(
      page.getByRole("link", { name: new RegExp(CUSTOM_NAME) }),
    ).toHaveCount(0);

    const response = await page.goto(customGameUrl);
    expect(response?.status()).toBe(404);

    await page.goto("/en/games?q=catan+e2e");
    await expect(
      page.getByRole("link", { name: /Catán E2E Game/ }),
    ).toBeVisible();
    await context.close();
  });
});
