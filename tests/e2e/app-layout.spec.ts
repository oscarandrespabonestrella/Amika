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

test("navigation marks the current page and reaches settings", async ({
  page,
}) => {
  await page.goto("/en/home");
  const nav = page.locator("nav[aria-label='Main navigation']:visible");
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/en\/settings$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
});

test("the empty state and settings pass accessibility checks", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  for (const path of ["/en/home", "/en/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, path).toEqual([]);
  }
});
