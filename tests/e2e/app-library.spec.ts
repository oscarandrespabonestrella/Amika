import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  canRunAppTests,
  cleanupCatalogFixtures,
  insertImportedGame,
  listUserPhotoPaths,
  STATE_FILE,
  TEST_USERS,
  testUserId,
  withDb,
} from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
test.use({ storageState: STATE_FILE.d });
test.describe.configure({ mode: "serial" });

// Own reserved id range: app-games.spec.ts cleans up "9900…" and must not touch these.
const PREFIX = "9901";
const game = (
  n: number,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  source: "bgg",
  externalId: `${PREFIX}${String(n).padStart(2, "0")}`,
  language: "en",
  kind: "base",
  name,
  description: "Fixture",
  yearPublished: 2000,
  minPlayers: 2,
  maxPlayers: 4,
  minPlaytime: 30,
  maxPlaytime: 60,
  minAge: 8,
  coverUrl: null,
  terms: [],
  relations: [],
  ...extra,
});

const NAMES = {
  catan: "Catán Lib E2E",
  zombi: "Zombicide Lib E2E",
  azul: "Azul Lib E2E",
};
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let userD: string;
let ids: Record<keyof typeof NAMES, string>;

test.beforeAll(async () => {
  userD = await testUserId(TEST_USERS.d.email);
  await cleanupCatalogFixtures([userD], PREFIX);
  await withDb(async (c) => {
    ids = {
      catan: await insertImportedGame(c, game(1, NAMES.catan)),
      zombi: await insertImportedGame(c, game(2, NAMES.zombi)),
      azul: await insertImportedGame(c, game(3, NAMES.azul)),
    };
  });
});

test.afterAll(async () => {
  await cleanupCatalogFixtures([userD], PREFIX);
});

const libraryRows = () =>
  withDb(
    async (c) =>
      (
        await c.query(
          `select g.name, li.status, li.is_favorite, li.rating, li.notes
           from public.library_items li join public.games g on g.id = li.game_id
          where li.user_id = $1 order by g.name`,
          [userD],
        )
      ).rows,
  );

/** The panel buttons stay disabled until Clerk is ready; actions need the session. */
const openGame = async (page: Page, id: string) => {
  await page.goto(`/en/games/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
};

test.describe("an empty library", () => {
  test("explains how to start and links to the games", async ({ page }) => {
    await page.goto("/en/library");
    await expect(
      page.getByRole("heading", { name: "Your library is empty" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse games" }).first(),
    ).toBeVisible();
  });

  test("the home page shows the empty shelf", async ({ page }) => {
    await page.goto("/en/home");
    await expect(
      page.getByRole("heading", { name: "Your shelf is empty" }),
    ).toBeVisible();
  });
});

test.describe("adding games", () => {
  test("only 'owned' and 'previously owned' are offered (no wishlist)", async ({
    page,
  }) => {
    await openGame(page, ids.catan);
    await expect(page.getByRole("button", { name: "I own it" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "I used to own it" }),
    ).toBeVisible();
    await expect(page.getByText(/wishlist|want|deseo/i)).toHaveCount(0);
  });

  test("adds a game as owned", async ({ page }) => {
    await openGame(page, ids.catan);
    await page.getByRole("button", { name: "I own it" }).click();
    await expect(
      page.getByRole("heading", { name: "In my library" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Own it", pressed: true }),
    ).toBeVisible();
    expect(await libraryRows()).toEqual([
      {
        name: NAMES.catan,
        status: "owned",
        is_favorite: false,
        rating: null,
        notes: null,
      },
    ]);
  });

  test("adds another as previously owned", async ({ page }) => {
    await openGame(page, ids.zombi);
    await page.getByRole("button", { name: "I used to own it" }).click();
    await expect(
      page.getByRole("button", { name: "Used to own", pressed: true }),
    ).toBeVisible();
    expect((await libraryRows()).map((r) => [r.name, r.status])).toEqual([
      [NAMES.catan, "owned"],
      [NAMES.zombi, "previously_owned"],
    ]);
  });

  test("changes the status of a game already in the library", async ({
    page,
  }) => {
    await openGame(page, ids.zombi);
    await page.getByRole("button", { name: "Own it" }).click();
    await expect(
      page.getByRole("button", { name: "Own it", pressed: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await libraryRows()).find((r) => r.name === NAMES.zombi)?.status,
      )
      .toBe("owned");

    await page.getByRole("button", { name: "Used to own" }).click();
    await expect
      .poll(
        async () =>
          (await libraryRows()).find((r) => r.name === NAMES.zombi)?.status,
      )
      .toBe("previously_owned");
  });
});

test.describe("favorite, rating and notes", () => {
  test("marks a favorite, rates and writes private notes", async ({ page }) => {
    await openGame(page, ids.catan);

    await page.getByRole("button", { name: "Favorite" }).click();
    await expect(
      page.getByRole("button", { name: "Favorite", pressed: true }),
    ).toBeVisible();

    await page.getByLabel("My rating").selectOption("9");
    await expect(page.getByLabel("My rating")).toHaveValue("9");

    await page.getByLabel("My notes").fill("  Lent to Sam in June  ");
    await page.getByRole("button", { name: "Save notes" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    const row = (await libraryRows()).find((r) => r.name === NAMES.catan);
    expect(row).toMatchObject({
      is_favorite: true,
      rating: 9,
      notes: "Lent to Sam in June",
    });

    // Everything persists across a reload.
    await page.reload();
    await expect(page.getByLabel("My rating")).toHaveValue("9");
    await expect(page.getByLabel("My notes")).toHaveValue(
      "Lent to Sam in June",
    );
    await expect(
      page.getByRole("button", { name: "Favorite", pressed: true }),
    ).toBeVisible();
  });

  test("can clear the rating and the notes", async ({ page }) => {
    await openGame(page, ids.catan);
    await page.getByLabel("My rating").selectOption("");
    await page.getByLabel("My notes").fill("");
    await page.getByRole("button", { name: "Save notes" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const row = (await libraryRows()).find((r) => r.name === NAMES.catan);
    expect(row).toMatchObject({ rating: null, notes: null });
  });

  test("the save button is disabled when the notes did not change", async ({
    page,
  }) => {
    await openGame(page, ids.catan);
    await expect(
      page.getByRole("button", { name: "Save notes" }),
    ).toBeDisabled();
  });

  test("sets the rating the list tests rely on (the favorite stays marked)", async ({
    page,
  }) => {
    await openGame(page, ids.catan);
    await expect(
      page.getByRole("button", { name: "Favorite", pressed: true }),
    ).toBeVisible();
    await page.getByLabel("My rating").selectOption("8");
    await expect
      .poll(
        async () =>
          (await libraryRows()).find((r) => r.name === NAMES.catan)?.rating,
      )
      .toBe(8);
  });
});

test.describe("the library page", () => {
  test("lists the library with status, favorite and rating chips", async ({
    page,
  }) => {
    await page.goto("/en/library");
    await expect(page.getByText("2 games", { exact: true })).toBeVisible();
    const catan = page.getByRole("link", { name: new RegExp(NAMES.catan) });
    await expect(catan).toContainText("Owned");
    await expect(catan).toContainText("Favorite");
    await expect(catan).toContainText("8/10");
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.zombi) }),
    ).toContainText("Previously owned");
    // A game that was never added is not listed.
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.azul) }),
    ).toHaveCount(0);
  });

  test("filters by status and by favorites", async ({ page }) => {
    await page.goto("/en/library");
    await page.getByRole("link", { name: "Owned", exact: true }).click();
    await expect(page).toHaveURL(/status=owned/);
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.catan) }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.zombi) }),
    ).toHaveCount(0);

    await page
      .getByRole("link", { name: "Previously owned", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.zombi) }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.catan) }),
    ).toHaveCount(0);

    await page.goto("/en/library");
    await page.getByRole("link", { name: "Favorites" }).click();
    await expect(page).toHaveURL(/favorites=1/);
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.catan) }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.zombi) }),
    ).toHaveCount(0);
  });

  test("searches by name ignoring accents, keeping the filters", async ({
    page,
  }) => {
    await page.goto("/en/library?status=owned");
    await page
      .getByRole("searchbox", { name: "Search my library" })
      .fill("catan lib");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/status=owned/);
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.catan) }),
    ).toBeVisible();
  });

  test("shows 'no match' when the filters exclude everything", async ({
    page,
  }) => {
    await page.goto("/en/library?q=nothingmatchesthis");
    await expect(
      page.getByRole("heading", { name: "No games match" }),
    ).toBeVisible();
  });

  test("ignores malformed filters (wishlist is not a status)", async ({
    page,
  }) => {
    const response = await page.goto(
      "/en/library?status=wishlist&favorites=maybe",
    );
    expect(response?.status()).toBe(200);
    await expect(page.getByText("2 games", { exact: true })).toBeVisible();
  });

  test("the home page summarizes the library", async ({ page }) => {
    await page.goto("/en/home");
    await expect(page.getByText("2 games in your library.")).toBeVisible();
    await page.getByRole("link", { name: "Open library" }).click();
    await expect(page).toHaveURL(/\/en\/library$/);
  });

  test("is translated", async ({ page }) => {
    await page.goto("/es/library");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Mi biblioteca",
    );
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.catan) }),
    ).toContainText("Lo tengo");
    await page.goto("/fr/library");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Ma bibliothèque",
    );
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.catan) }),
    ).toContainText("Je l'ai");
  });
});

test.describe("removing", () => {
  test("asks for confirmation and can be cancelled", async ({ page }) => {
    await openGame(page, ids.zombi);
    await page.getByRole("button", { name: "Remove from library" }).click();
    await expect(
      page.getByText("Remove it? Your rating and notes will be lost."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(
      page.getByRole("button", { name: "Remove from library" }),
    ).toBeVisible();
    expect((await libraryRows()).map((r) => r.name)).toContain(NAMES.zombi);
  });

  test("removes a game from the library (the game itself stays in the catalog)", async ({
    page,
  }) => {
    await openGame(page, ids.zombi);
    await page.getByRole("button", { name: "Remove from library" }).click();
    await page.getByRole("button", { name: "Yes, remove" }).click();
    await expect(
      page.getByRole("heading", { name: "Add to my library" }),
    ).toBeVisible();
    expect((await libraryRows()).map((r) => r.name)).toEqual([NAMES.catan]);
    const stillThere = await withDb((c) =>
      c.query("select 1 from public.games where id = $1", [ids.zombi]),
    );
    expect(stillThere.rowCount).toBe(1);
  });
});

test.describe("your own games: edit and delete", () => {
  let customUrl: string;
  const CUSTOM = `E2E Lib Propio ${Date.now()}`;

  test("create, then edit it", async ({ page }) => {
    await page.goto("/en/games/new");
    await page.getByLabel("Name").fill(CUSTOM);
    await page.getByLabel("Min. players").fill("2");
    await page.getByLabel("Description (optional)").fill("Primera versión");
    await page.getByRole("button", { name: "Create game" }).click();
    await expect(page).toHaveURL(/\/en\/games\/[0-9a-f-]{36}$/);
    customUrl = new URL(page.url()).pathname;

    await page.getByRole("link", { name: "Edit game" }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Edit game",
    );
    await expect(page.getByLabel("Name")).toHaveValue(CUSTOM);
    await expect(page.getByLabel("Description (optional)")).toHaveValue(
      "Primera versión",
    );

    await page.getByLabel("Name").fill(`${CUSTOM} v2`);
    await page.getByLabel("Max. players").fill("5");
    await page.getByLabel("Description (optional)").fill("Segunda versión");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(new RegExp(`${customUrl}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `${CUSTOM} v2`,
    );
    await expect(page.getByText("Segunda versión")).toBeVisible();
    await expect(page.getByText("2–5 players")).toBeVisible();
  });

  test("editing validates like creating", async ({ page }) => {
    await page.goto(`${customUrl}/edit`);
    await page.getByLabel("Name").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("This field is required.")).toBeVisible();
  });

  test("clearing the description removes it", async ({ page }) => {
    await page.goto(`${customUrl}/edit`);
    await page.getByLabel("Description (optional)").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("No description yet.")).toBeVisible();
  });

  test("only your own custom games can be edited: imported ones give 404", async ({
    page,
  }) => {
    const response = await page.goto(`/en/games/${ids.azul}/edit`);
    expect(response?.status()).toBe(404);
  });

  test("deleting removes the game, its library entry and its photos", async ({
    page,
  }) => {
    await page.goto(customUrl);
    await page.getByRole("button", { name: "I own it" }).click();
    await expect(
      page.getByRole("heading", { name: "In my library" }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Choose photo" }),
    ).toBeEnabled();
    await page
      .getByTestId("photo-input-file")
      .setInputFiles({ name: "b.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(page.getByRole("img", { name: /Photo 1 of/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(async () => (await listUserPhotoPaths(userD)).length)
      .toBe(1);

    await page.getByRole("button", { name: "Delete game" }).click();
    await expect(
      page.getByText(/Its photos and library entry will be deleted too/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page).toHaveURL(/\/en\/games$/);

    const left = await withDb((c) =>
      c.query(
        `select (select count(*) from public.games where owner_id = $1)::int as games,
                (select count(*) from public.library_items li join public.games g on g.id = li.game_id
                  where li.user_id = $1 and g.source = 'manual')::int as library,
                (select count(*) from public.game_photos where user_id = $1)::int as photos`,
        [userD],
      ),
    );
    expect(left.rows[0]).toEqual({ games: 0, library: 0, photos: 0 });
    await expect
      .poll(async () => (await listUserPhotoPaths(userD)).length)
      .toBe(0);

    const gone = await page.goto(customUrl);
    expect(gone?.status()).toBe(404);
  });
});

test.describe("privacy and accessibility", () => {
  test("another user's library is separate", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE_FILE.b });
    const page = await context.newPage();
    await page.goto("/en/library");
    await expect(
      page.getByRole("link", { name: new RegExp(NAMES.catan) }),
    ).toHaveCount(0);
    await context.close();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`library and game panel have no axe violations (${scheme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: STATE_FILE.d,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      for (const path of [
        "/en/library",
        `/en/games/${ids.catan}`,
        `/en/games/${ids.azul}`,
        "/en/home",
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
