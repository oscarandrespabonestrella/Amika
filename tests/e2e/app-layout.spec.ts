import { expect, test } from "@playwright/test";
import { canRunAppTests, STATE_FILE } from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
// Read-only checks with user B; user A is mutated by app-session.spec.ts.
test.use({ storageState: STATE_FILE.b });

test("shows exactly one navigation, placed for the viewport", async ({
  page,
  isMobile,
}) => {
  await page.goto("/en/home");
  const nav = page.locator("nav[aria-label='Main navigation']:visible");
  await expect(nav).toHaveCount(1);

  const box = (await nav.boundingBox())!;
  const viewport = page.viewportSize()!;
  if (isMobile) {
    expect(box.y + box.height).toBeGreaterThan(viewport.height - 4); // bottom bar
    expect(box.width).toBeGreaterThan(viewport.width * 0.9);
  } else {
    expect(box.x).toBeLessThan(260); // left sidebar
  }
});

test("navigation marks the current page and reaches settings from the account menu", async ({
  page,
}) => {
  await page.goto("/en/home");
  const nav = page.locator("nav[aria-label='Main navigation']:visible");
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await nav.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(/\/en\/friends$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Friends");
  await expect(nav.getByRole("link", { name: "People" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Settings lives in the avatar menu (Clerk UserButton), visible variant only.
  await page
    .locator(
      "button.cl-userButtonTrigger:visible, button[aria-label='Open user menu']:visible",
    )
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/en\/settings$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
});

test("the centre Log action opens the game picker for a new match", async ({
  page,
}) => {
  await page.goto("/en/home");
  const nav = page.locator("nav[aria-label='Main navigation']:visible");
  await nav.getByRole("link", { name: "Log a match" }).click();
  await expect(page).toHaveURL(/\/en\/log$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Log a match",
  );
  const first = page.locator("main ul a").first();
  if (await first.count()) {
    await first.click();
    await expect(page).toHaveURL(/\/en\/games\/[^/]+\/plays\/new$/);
  } else {
    await expect(page.getByRole("link", { name: "Add games" })).toBeVisible();
  }
});

test("the library navigation item stays active on the games catalog it adds from", async ({
  page,
}) => {
  await page.goto("/en/games/new");
  const nav = page.locator("nav[aria-label='Main navigation']:visible");
  await expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the empty state and settings pass accessibility checks", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  for (const path of ["/en/home", "/en/settings", "/en/games"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, path).toEqual([]);
  }
});

test("the five-item bottom bar fits a 375 px phone in every language", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: STATE_FILE.b,
    viewport: { width: 375, height: 812 },
    isMobile: true,
  });
  const page = await context.newPage();
  for (const [locale, stats] of [
    ["en", "Statistics"],
    ["es", "Estadísticas"],
    ["fr", "Statistiques"],
  ] as const) {
    await page.goto(`/${locale}/home`);
    const links = page.locator("nav[aria-label]:visible a");
    await expect(links).toHaveCount(5);
    await expect(
      page.locator("nav:visible").getByRole("link", { name: stats }),
    ).toBeVisible();
    for (const link of await links.all()) {
      const box = (await link.boundingBox())!;
      expect(box.x, locale).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, locale).toBeLessThanOrEqual(375.5);
      // The label is not clipped by its own cell.
      const clipped = await link.evaluate((a) => a.scrollWidth > a.clientWidth);
      expect(clipped, `${locale}: ${await link.innerText()}`).toBe(false);
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, locale).toBeLessThanOrEqual(0);
  }
  await context.close();
});
