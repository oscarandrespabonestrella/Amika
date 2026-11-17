import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// These tests need the real Clerk dev keys (.env.local or CI secrets).
test.skip(
  !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY,
  "Clerk keys not configured",
);

const HEADLINES = {
  en: "Your games. Your plays. Your stats.",
  es: "Tus juegos. Tus partidas. Tus estadísticas.",
  fr: "Vos jeux. Vos parties. Vos statistiques.",
} as const;

test.describe("i18n", () => {
  test("the root path redirects to the default locale (English)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      HEADLINES.en,
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  for (const [locale, headline] of Object.entries(HEADLINES)) {
    test(`/${locale} renders in its language`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        headline,
      );
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    });
  }

  test("an unsupported locale returns 404", async ({ page }) => {
    const response = await page.goto("/de");
    expect(response?.status()).toBe(404);
  });

  test("an unknown page shows the localized 404", async ({ page }) => {
    const response = await page.goto("/es/no-existe");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Página no encontrada",
    );
  });
});

test.describe("access control", () => {
  for (const path of ["home", "settings"]) {
    test(`/en/${path} redirects anonymous users to sign-in`, async ({
      page,
    }) => {
      await page.goto(`/en/${path}`);
      await expect(page).toHaveURL(
        new RegExp(`/en/sign-in\\?redirect_url=%2Fen%2F${path}`),
      );
    });
  }

  test("the redirect keeps the visitor's language", async ({ page }) => {
    await page.goto("/fr/home");
    await expect(page).toHaveURL(/\/fr\/sign-in/);
  });
});

/**
 * Average RGB (0-255) of the body background. Chromium reports oklch() colors
 * as-is, so the color is rasterized on a canvas instead of being parsed.
 */
async function backgroundBrightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const color = getComputedStyle(document.body).backgroundColor;
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return (r + g + b) / 3;
  });
}

test.describe("theme (Adaptive)", () => {
  test("follows a dark system preference without a flash of light theme", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/en", { waitUntil: "commit" });
    // The inline next-themes script must set the class before first paint.
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await backgroundBrightness(page)).toBeLessThan(80);
    await context.close();
  });

  test("is dark by default even when the system prefers light", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/en");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await context.close();
  });

  test("follows a light system preference once the user chose System", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    await context.addInitScript(() =>
      window.localStorage.setItem("theme", "system"),
    );
    const page = await context.newPage();
    await page.goto("/en");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    expect(await backgroundBrightness(page)).toBeGreaterThan(200);
    await context.close();
  });
});

test.describe("responsive and accessible", () => {
  test("no horizontal scroll and comfortable touch targets", async ({
    page,
  }) => {
    await page.goto("/en");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    for (const link of await page
      .getByRole("link", { name: /create account|sign in/i })
      .all()) {
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`landing has no axe violations (${scheme})`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto("/en");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      await context.close();
    });
  }
});
