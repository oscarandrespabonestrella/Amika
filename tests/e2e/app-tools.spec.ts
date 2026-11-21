import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { canRunAppTests, STATE_FILE } from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
// Read-only: the tools keep everything in the browser, so user B is safe to share.
test.use({ storageState: STATE_FILE.b });

test("the hub lists every tool by category and links to the statistics", async ({
  page,
}) => {
  await page.goto("/en/tools");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tools");
  for (const category of ["Randomizers", "Timers", "Other tools"]) {
    await expect(
      page.getByRole("heading", { level: 2, name: category }),
    ).toBeVisible();
  }
  for (const [name, path] of [
    ["Dice roller", "dice"],
    ["Finger selector", "finger"],
    ["Spin the wheel", "wheel"],
    ["Countdown", "countdown"],
    ["Team generator", "teams"],
    ["Hidden number", "hidden"],
    ["Coin flip", "coin"],
  ] as const) {
    await expect(
      page.getByRole("main").getByRole("link", { name: new RegExp(name) }),
    ).toHaveAttribute("href", new RegExp(`/tools/${path}$`));
  }
  await page.getByRole("link", { name: /Looking for your stats/ }).click();
  await expect(page).toHaveURL(/\/en\/stats$/);
});

test("an unknown tool is a 404, and every tool has a way back", async ({
  page,
}) => {
  const response = await page.goto("/en/tools/nope");
  expect(response?.status()).toBe(404);

  await page.goto("/en/tools/coin");
  await page.getByRole("link", { name: "Back to tools" }).click();
  await expect(page).toHaveURL(/\/en\/tools$/);
});

test("dice: rolls, shows the total, and remembers the settings", async ({
  page,
}) => {
  await page.goto("/en/tools/dice");
  await page.getByRole("radio", { name: "d20" }).click();
  await page.getByRole("button", { name: "More dice" }).click(); // 2 → 3
  await page.getByRole("button", { name: "Raise modifier" }).click(); // +1
  await page.getByRole("button", { name: "Roll 3d20+1" }).click();
  const status = page.locator("[aria-live=polite]").filter({
    hasText: "3d20+1",
  });
  // Roll animation ≈ 0.6 s; then the total (3 dice 1–20, +1) is on the table.
  await expect(status).toContainText(/\b(?:[4-9]|[1-5]\d|6[0-1])\b/);

  await page.reload();
  await expect(page.getByRole("radio", { name: "d20" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Roll 3d20+1" })).toBeVisible();

  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Reset" }).click();
  await expect(page.getByRole("button", { name: "Roll 2d6" })).toBeVisible();
});

test("dice: a custom die has its own number of sides", async ({ page }) => {
  await page.goto("/en/tools/dice");
  await page.getByRole("radio", { name: "Custom" }).click();
  await page.getByLabel("Sides per die", { exact: true }).fill("30");
  await expect(page.getByRole("button", { name: /^Roll .*d30/ })).toBeVisible();
});

test("coin: flips to heads or tails and keeps a tally", async ({ page }) => {
  await page.goto("/en/tools/coin");
  await page.getByRole("button", { name: "Flip the coin" }).last().click();
  await expect(page.getByText(/^(Heads|Tails)$/).last()).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByText(/Heads [01] · Tails [01]/)).toBeVisible();
});

test("wheel: needs two options, then names a winner who can be removed", async ({
  page,
}) => {
  await page.goto("/en/tools/wheel");
  const spin = page.getByRole("button", { name: "Spin", exact: true });
  await expect(spin).toBeDisabled();

  await page
    .getByPlaceholder("Add an option (or several, separated by commas)")
    .fill("Pizza, Sushi, Tacos");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("list", { name: "Options" })).toContainText(
    "Tacos",
  );
  await expect(spin).toBeEnabled();
  await spin.click();
  await expect(page.getByText("The wheel says")).toBeVisible({
    timeout: 8000,
  });
  await page
    .getByRole("button", { name: /^Remove (Pizza|Sushi|Tacos)$/ })
    .first()
    .click();
  // Two options are left: still enough to spin again.
  await expect(spin).toBeEnabled();
});

test("teams: deals the players into even teams and shares the list", async ({
  page,
}) => {
  await page.goto("/en/tools/teams");
  await page
    .getByPlaceholder("Add a player (or several, separated by commas)")
    .fill("Ana, Bo, Cy, Di, Ed");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Make teams" }).click();

  const teams = page.getByRole("list", { name: "Teams" }).locator("> li");
  await expect(teams).toHaveCount(2);
  const sizes = await teams.evaluateAll((items) =>
    items.map((li) => li.querySelectorAll("ul li").length),
  );
  expect(sizes.sort()).toEqual([2, 3]);

  // The same players are waiting in the hidden-number tool.
  await page.goto("/en/tools/hidden");
  await expect(page.getByRole("list", { name: "Players" })).toContainText("Ed");
});

test("hidden number: each player's number stays hidden until tapped", async ({
  page,
}) => {
  await page.goto("/en/tools/hidden");
  await page.getByRole("button", { name: "Draw 2 numbers" }).click();
  const cards = page.getByRole("list").locator("button[aria-pressed]");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveAttribute("aria-pressed", "false");
  await expect(cards.first()).toContainText("Tap to reveal");
  await cards.first().click();
  await expect(cards.first()).toContainText(/Player 1\s*-?\d+/);
  await expect(cards.first()).not.toContainText("Tap to reveal");
  await page.getByRole("button", { name: "Reveal all" }).click();
  await expect(cards.last()).toContainText(/Player 2\s*-?\d+/);
});

test("hidden number: a range too small for different numbers is explained", async ({
  page,
}) => {
  await page.goto("/en/tools/hidden");
  await page.getByLabel("Highest number", { exact: true }).fill("1");
  await expect(page.getByText(/too small/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Draw/ })).toBeDisabled();
});

test("countdown: counts down, pauses and resets", async ({ page }) => {
  await page.goto("/en/tools/countdown");
  await page.getByRole("button", { name: "0:30" }).click();
  await expect(page.getByRole("timer")).toHaveText("0:30");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("timer")).not.toHaveText("0:30");
  await page.getByRole("button", { name: "Pause" }).click();
  const paused = await page.getByRole("timer").innerText();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("timer")).toHaveText(paused);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("timer")).toHaveText("0:30");
});

test("finger selector: waits for fingers and explains itself", async ({
  page,
}) => {
  await page.goto("/en/tools/finger");
  await expect(
    page.getByText("Everyone, touch and hold the screen"),
  ).toBeVisible();
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(page.getByText(/Lift all fingers to play again/)).toBeVisible();
});

test("the tools pass accessibility checks", async ({ page }) => {
  for (const path of [
    "/en/tools",
    "/en/tools/dice",
    "/en/tools/coin",
    "/en/tools/wheel",
    "/en/tools/countdown",
    "/en/tools/teams",
    "/en/tools/hidden",
    "/en/tools/finger",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, path).toEqual([]);
  }
});

test("a tool works on a 375 px phone without sideways scrolling", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: STATE_FILE.b,
    viewport: { width: 375, height: 812 },
    isMobile: true,
  });
  const page = await context.newPage();
  for (const path of ["/en/tools", "/en/tools/dice", "/en/tools/wheel"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await context.close();
});
