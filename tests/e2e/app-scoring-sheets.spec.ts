import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
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
test.use({ storageState: STATE_FILE.g });
test.describe.configure({ mode: "serial" });

// Own reserved id range: other specs use 9900 (games), 9901 (library), 9902 (game center).
const PREFIX = "9903";
const GAME_NAME = "Wonders Sheets E2E";

let userG: string;
let gameId: string;
let sheetUrl: string;
let sheetId: string;

test.beforeAll(async () => {
  userG = await testUserId(TEST_USERS.g.email);
  await cleanupCatalogFixtures([userG], PREFIX);
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
  });
});

test.afterAll(async () => {
  await cleanupCatalogFixtures([userG], PREFIX);
});

type VersionRow = { title: string; version: number; definition: unknown };
const versions = (id?: string) =>
  withDb(async (c) => {
    const { rows } = await c.query<VersionRow>(
      `select s.title, v.version, v.definition
         from public.scoring_sheets s
         join public.scoring_sheet_versions v on v.sheet_id = s.id
        where s.owner_id = $1 and ($2::uuid is null or s.id = $2)
        order by s.created_at, v.version`,
      [userG, id ?? null],
    );
    return rows;
  });

const card = (page: Page, i: number) =>
  page.locator("#categories-title ~ ol > li").nth(i);
const labelInput = (page: Page, i: number) =>
  card(page, i).getByLabel(/^Label/);
const save = (page: Page) =>
  page.getByRole("button", { name: "Save", exact: true });
const preview = (page: Page) => page.getByRole("region", { name: "Try it" });

async function addCategory(page: Page, type: string) {
  await page.getByLabel("Type of the new category").selectOption(type);
  await page.getByRole("button", { name: "Add category" }).click();
}

test.describe("an empty game", () => {
  test("shows 'no sheets yet' and links to the editor", async ({ page }) => {
    await page.goto(`/en/games/${gameId}`);
    await page.getByRole("tab", { name: /^Sheets/ }).click();
    await expect(page.getByText("No sheets yet")).toBeVisible();
    await page.getByRole("link", { name: "Open score sheets" }).click();
    await expect(page).toHaveURL(new RegExp(`/en/games/${gameId}/sheets$`));
    await expect(
      page.getByRole("heading", { name: "No score sheets yet" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "New sheet" }).click();
    await expect(page).toHaveURL(/\/sheets\/new$/);
  });
});

test.describe("building a 7 Wonders sheet", () => {
  test("number, 1 point per N and sets; the preview totals 30", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}/sheets/new`);
    await expect(save(page)).toBeDisabled();
    await page.getByLabel("Sheet name").fill("7 Wonders (test)");

    await addCategory(page, "number");
    await labelInput(page, 0).fill("Military");
    await addCategory(page, "per_n");
    await labelInput(page, 1).fill("Coins");
    await card(page, 1).getByLabel("Every N").fill("3");
    await addCategory(page, "set_bonus");
    await labelInput(page, 2).fill("Science");

    const science = card(page, 2);
    await science.getByRole("button", { name: "Add counter" }).click();
    const counters = science.getByLabel("Counter name");
    await counters.nth(0).fill("Tablets");
    await counters.nth(1).fill("Compass");
    await counters.nth(2).fill("Gears");
    await science.getByLabel("Points per complete set").fill("7");

    const p = preview(page);
    await p.getByLabel("Military", { exact: true }).fill("6");
    await p.getByLabel("Coins", { exact: true }).fill("10");
    await p.getByLabel("Tablets", { exact: true }).fill("3");
    await p.getByLabel("Compass", { exact: true }).fill("2");
    await p.getByLabel("Gears", { exact: true }).fill("1");
    // 6 military + floor(10 / 3) coins + (9 + 4 + 1 + 7 × 1) science
    await expect(p.getByTestId("preview-total")).toHaveText("30");
  });

  test("typing a label key by key keeps the focus on the field", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}/sheets/new`);
    await addCategory(page, "per_n");
    const input = labelInput(page, 0);
    await input.fill("");
    await input.click();
    // Real keystrokes: each one changes the label (and, for a new category, its key).
    await input.pressSequentially("Military points");
    await expect(input).toHaveValue("Military points");
    await expect(input).toBeFocused();

    // Other fields of the same card keep what was typed in them, too.
    const every = card(page, 0).getByLabel("Every N");
    await every.fill("5");
    await input.pressSequentially(" extra");
    await expect(every).toHaveValue("5");
  });

  test("a bad entry is flagged and does not break the total", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}/sheets/new`);
    await addCategory(page, "number");
    await labelInput(page, 0).fill("Military");
    const p = preview(page);
    await p.getByLabel("Military", { exact: true }).fill("1.5");
    await expect(p.getByText("Enter a whole number.")).toBeVisible();
    await expect(p.getByTestId("preview-total")).toHaveText("0");
  });

  test("shows problems and keeps Save disabled until fixed", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}/sheets/new`);
    await page.getByLabel("Sheet name").fill("Problems");
    await addCategory(page, "number");
    await labelInput(page, 0).fill("");
    await expect(
      card(page, 0).getByText("This field is required."),
    ).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await labelInput(page, 0).fill("Fixed");
    await expect(save(page)).toBeEnabled();

    await card(page, 0).getByLabel("Counts toward the total").uncheck();
    await expect(
      page.getByText("At least one category must count toward the total."),
    ).toBeVisible();
    await expect(save(page)).toBeDisabled();
  });

  test("calculated categories need two existing categories", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}/sheets/new`);
    await expect(
      page.getByRole("option", { name: "Calculated" }),
    ).toBeDisabled();
    await addCategory(page, "number");
    await addCategory(page, "number");
    await expect(
      page.getByRole("option", { name: "Calculated" }),
    ).toBeEnabled();
  });
});

test.describe("saving and versions", () => {
  test("saving creates version 1 and opens the sheet", async ({ page }) => {
    await page.goto(`/en/games/${gameId}/sheets/new`);
    await page.getByLabel("Sheet name").fill("7 Wonders (test)");
    await addCategory(page, "number");
    await labelInput(page, 0).fill("Military");
    await addCategory(page, "per_n");
    await labelInput(page, 1).fill("Coins");
    await card(page, 1).getByLabel("Every N").fill("3");
    await save(page).click();

    await expect(page).toHaveURL(/\/sheets\/[0-9a-f-]{36}$/);
    sheetUrl = new URL(page.url()).pathname;
    sheetId = sheetUrl.split("/").pop()!;
    await expect(
      page.getByRole("heading", { level: 1, name: "Edit score sheet" }),
    ).toBeVisible();

    const rows = await versions(sheetId);
    expect(rows.map((r) => [r.title, r.version])).toEqual([
      ["7 Wonders (test)", 1],
    ]);
    expect(rows[0].definition).toMatchObject({
      schemaVersion: 1,
      categories: [
        { key: "military", label: "Military", type: "number" },
        { key: "coins", label: "Coins", type: "per_n", n: 3, pointsPer: 1 },
      ],
    });
    await expect(save(page)).toBeDisabled(); // nothing changed yet
  });

  test("editing and saving creates version 2 and keeps version 1 and the keys", async ({
    page,
  }) => {
    await page.goto(sheetUrl);
    await labelInput(page, 0).fill("Military points");
    await save(page).click();
    await expect(page.getByText("Saved as version 2.")).toBeVisible();
    await expect(save(page)).toBeDisabled();

    const rows = await versions(sheetId);
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows[0].definition).toMatchObject({
      categories: [{ key: "military", label: "Military" }, {}],
    });
    // The label changed but the saved key did not.
    expect(rows[1].definition).toMatchObject({
      categories: [{ key: "military", label: "Military points" }, {}],
    });
  });

  test("renaming alone does not create a version", async ({ page }) => {
    await page.goto(sheetUrl);
    await page.getByLabel("Sheet name").fill("7 Wonders (renamed)");
    await save(page).click();
    await expect(save(page)).toBeDisabled();
    const rows = await versions(sheetId);
    expect(rows.map((r) => [r.title, r.version])).toEqual([
      ["7 Wonders (renamed)", 1],
      ["7 Wonders (renamed)", 2],
    ]);
  });

  test("two tabs: the stale one gets a conflict and can reload", async ({
    context,
  }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto(sheetUrl);
    await second.goto(sheetUrl);
    await expect(labelInput(second, 0)).toBeVisible();

    await labelInput(first, 0).fill("Military (tab one)");
    await save(first).click();
    await expect(first.getByText("Saved as version 3.")).toBeVisible();

    await labelInput(second, 1).fill("Coins (tab two)");
    await save(second).click();
    await expect(
      second.getByText("The sheet changed somewhere else. Reload to continue."),
    ).toBeVisible();
    expect((await versions(sheetId)).map((r) => r.version)).toEqual([1, 2, 3]);

    await second
      .getByRole("button", { name: "Reload the latest version" })
      .click();
    await expect(labelInput(second, 0)).toHaveValue("Military (tab one)");
    await first.close();
    await second.close();
  });
});

test.describe("hostile text", () => {
  test("a label with markup is shown as text and never executed", async ({
    page,
  }) => {
    const hostile = "<img src=x onerror=window.__pwned=1>";
    await page.goto(`/en/games/${gameId}/sheets/new`);
    await page.getByLabel("Sheet name").fill("Hostile");
    await addCategory(page, "number");
    await labelInput(page, 0).fill(hostile);
    await expect(preview(page).getByText(hostile).first()).toBeVisible();
    await save(page).click();
    await expect(page).toHaveURL(/\/sheets\/[0-9a-f-]{36}$/);

    await expect(labelInput(page, 0)).toHaveValue(hostile);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
  });

  test("a 10 000-character label is capped or refused", async ({ page }) => {
    await page.goto(`/en/games/${gameId}/sheets/new`);
    await page.getByLabel("Sheet name").fill("Long");
    await addCategory(page, "number");
    await labelInput(page, 0).fill("y".repeat(10_000));
    const length = (await labelInput(page, 0).inputValue()).length;
    if (length > 60) await expect(save(page)).toBeDisabled();
    else expect(length).toBeLessThanOrEqual(60);
  });

  test("padding spaces are trimmed on save", async ({ page }) => {
    await page.goto(`/en/games/${gameId}/sheets/new`);
    await page.getByLabel("Sheet name").fill("   Padded   ");
    await addCategory(page, "number");
    await labelInput(page, 0).fill("  Birds  ");
    await save(page).click();
    await expect(page).toHaveURL(/\/sheets\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    const rows = await versions(id);
    expect(rows[0].title).toBe("Padded");
    expect(rows[0].definition).toMatchObject({
      categories: [{ label: "Birds" }],
    });
  });
});

test.describe("copy and delete", () => {
  test("copying makes an independent sheet", async ({ page }) => {
    await page.goto(`/en/games/${gameId}/sheets`);
    const item = page
      .getByRole("listitem")
      .filter({ hasText: "7 Wonders (renamed)" });
    await item.getByRole("button", { name: "Copy" }).click();
    await expect(page).toHaveURL(/\/sheets\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Sheet name")).toHaveValue(
      "7 Wonders (renamed) (copy)",
    );

    const copyId = new URL(page.url()).pathname.split("/").pop()!;
    const copied = await withDb((c) =>
      c.query<{ copied_from: string }>(
        "select copied_from from public.scoring_sheets where id = $1",
        [copyId],
      ),
    );
    expect(copied.rows[0].copied_from).toBe(sheetId);
    const rows = await versions(copyId);
    expect(rows.map((r) => r.version)).toEqual([1]);
    expect(rows[0].definition).toMatchObject({
      categories: [{ label: "Military (tab one)" }, {}],
    });
  });

  test("deleting asks for confirmation and can be cancelled", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}/sheets`);
    const item = page
      .getByRole("listitem")
      .filter({ hasText: "7 Wonders (renamed) (copy)" });
    await item.getByRole("button", { name: "Delete" }).click();
    await expect(
      item.getByText("Delete this sheet and all its versions?"),
    ).toBeVisible();
    await item.getByRole("button", { name: "Keep it" }).click();
    await expect(item.getByRole("button", { name: "Copy" })).toBeVisible();

    await item.getByRole("button", { name: "Delete" }).click();
    await item.getByRole("button", { name: "Yes, delete" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "(copy)" }),
    ).toHaveCount(0);
    const left = await withDb((c) =>
      c.query(
        "select 1 from public.scoring_sheets where owner_id = $1 and title like '%(copy)'",
        [userG],
      ),
    );
    expect(left.rowCount).toBe(0);
  });
});

test.describe("privacy and translations", () => {
  test("another user cannot see or open the sheet", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE_FILE.b });
    const page = await context.newPage();
    await page.goto(`/en/games/${gameId}/sheets`);
    await expect(
      page.getByRole("heading", { name: "No score sheets yet" }),
    ).toBeVisible();
    const response = await page.goto(sheetUrl);
    expect(response?.status()).toBe(404);
    await context.close();
  });

  test("a sheet opened under another game is a 404", async ({ page }) => {
    const response = await page.goto(
      `/en/games/00000000-0000-4000-8000-000000000000/sheets/${sheetId}`,
    );
    expect(response?.status()).toBe(404);
  });

  test("the list and the editor are translated (es, fr)", async ({ page }) => {
    await page.goto(`/es/games/${gameId}/sheets`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Hojas de puntuación",
    );
    await page.goto(`/es/games/${gameId}/sheets/new`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Nueva hoja de puntuación",
    );
    await page.goto(`/fr/games/${gameId}/sheets`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Feuilles de score",
    );
    await page.goto(`/fr/games/${gameId}/sheets/new`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Nouvelle feuille de score",
    );
  });
});

test.describe("accessibility and mobile", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`list, new and edit pages have no axe violations (${scheme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: STATE_FILE.g,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      for (const path of [
        `/en/games/${gameId}`,
        `/en/games/${gameId}/sheets`,
        `/en/games/${gameId}/sheets/new`,
        sheetUrl,
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (path.endsWith("/new")) {
          await addCategory(page, "number");
          await addCategory(page, "set_bonus");
          await addCategory(page, "derived");
        }
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations, `${path} (${scheme})`).toEqual([]);
      }
      await context.close();
    });
  }

  test("the editor fits a phone: no sideways scroll and big touch targets", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: STATE_FILE.g,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(sheetUrl);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const control of [
      page.getByRole("button", { name: "Add category" }),
      page.getByRole("button", { name: /^Move .* down$/ }).first(),
      page.getByLabel("Sheet name"),
    ]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await context.close();
  });
});
