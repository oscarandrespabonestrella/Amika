import { test, type Page } from "@playwright/test";
import { canRunAppTests, STATE_FILE } from "../e2e/helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
test.describe.configure({ mode: "serial" });

// Dark is the app default now: pin the stored theme to the project (light/dark).
test.beforeEach(async ({ context }, info) => {
  await context.addInitScript(
    (theme) => window.localStorage.setItem("theme", theme),
    info.project.name.replace("mobile-", ""),
  );
});

const userKey = (process.env.SHOT_USER ?? "b") as keyof typeof STATE_FILE;

async function shot(page: Page, name: string, theme: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400); // let transitions settle
  const dir = `screenshots/mobile/${theme}`;
  await page.screenshot({ path: `${dir}/${name}.png` });
  await page.screenshot({ path: `${dir}/full/${name}.png`, fullPage: true });
}

test.describe("public", () => {
  test("landing and sign-in", async ({ page }, info) => {
    const theme = info.project.name.replace("mobile-", "");
    await page.goto("/en");
    await shot(page, "01-landing", theme);
    await page.goto("/en/sign-in");
    await shot(page, "02-sign-in", theme);
  });
});

test.describe("signed in", () => {
  test.use({ storageState: STATE_FILE[userKey] });

  const pages: [string, string][] = [
    ["10-home", "/en/home"],
    ["20-log", "/en/log"],
    ["11-library", "/en/library"],
    ["12-games", "/en/games"],
    ["13-stats", "/en/stats"],
    ["14-players", "/en/players"],
    ["15-friends", "/en/friends"],
    ["16-played-elsewhere", "/en/plays/elsewhere"],
    ["17-settings", "/en/settings"],
    ["18-new-game", "/en/games/new"],
  ];

  for (const [name, url] of pages) {
    test(name, async ({ page }, info) => {
      await page.goto(url);
      await shot(page, name, info.project.name.replace("mobile-", ""));
    });
  }

  test("game screens", async ({ page }, info) => {
    const theme = info.project.name.replace("mobile-", "");
    await page.goto(`/en/games?q=${encodeURIComponent(process.env.SHOT_GAME ?? "catan")}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot(page, "19-games-search", theme);
    const hrefs = await page
      .locator("a[href*='/games/']")
      .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname));
    const game = hrefs.find((h) => /^\/en\/games\/(?!new$)[^/]+$/.test(h));
    test.skip(!game, "This user has no games");

    await page.goto(game!);
    await shot(page, "20-game", theme);
    await page.goto(`${game}/plays/new`);
    await shot(page, "21-new-play", theme);
    await page.goto(`${game}/sheets`);
    await shot(page, "22-sheets", theme);

    await page.goto(game!);
    const play = (
      await page
        .locator("a[href*='/plays/']")
        .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname))
    ).find((h) => /\/plays\/(?!new$)[^/]+$/.test(h));
    if (play) {
      await page.goto(play);
      await shot(page, "23-play", theme);
    }
  });
});
