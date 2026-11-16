import { expect, type Page, test } from "@playwright/test";
import { canRunAppTests, STATE_FILE } from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
test.use({ storageState: STATE_FILE.n });
test.setTimeout(120_000);

type Violation = { directive: string; blocked: string };

/** Collects every CSP violation the page reports (also in report-only mode). */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: Violation[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      w.__csp.push({
        directive: e.violatedDirective,
        blocked: e.blockedURI || e.sample || "inline",
      }),
    );
  });
}
const violations = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __csp: Violation[] }).__csp ?? [],
  );

const ROUTES = [
  "/en",
  "/en/sign-in",
  "/en/games",
  "/en/stats",
  "/en/players",
  "/en/settings",
];

test.describe("security headers", () => {
  for (const route of ROUTES) {
    test(`${route} carries the hardening headers and a CSP`, async ({
      page,
    }) => {
      const response = await page.goto(route);
      const h = response!.headers();
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["permissions-policy"]).toContain("camera=(self)");
      expect(h["permissions-policy"]).toContain("microphone=()");
      // Report-only until CSP_ENFORCE=1 (see docs/SECURITY.md).
      const csp =
        h["content-security-policy"] ??
        h["content-security-policy-report-only"];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("'wasm-unsafe-eval'");
      expect(csp).toContain("worker-src 'self' blob:");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("youtube-nocookie.com");
    });
  }

  test("the self-hosted engines are served with the headers too", async ({
    request,
  }) => {
    const res = await request.get("/tesseract/worker.min.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });
});

test.describe("no CSP violations", () => {
  test("the signed-in app", async ({ page }) => {
    await watchViolations(page);
    for (const route of [
      "/en/home",
      "/en/games",
      "/en/library",
      "/en/stats",
      "/en/players",
      "/en/settings",
    ]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await violations(page), route).toEqual([]);
    }
  });

  test("the sign-in page (Clerk's widgets and bot protection)", async ({
    browser,
  }) => {
    const context = await browser.newContext(); // anonymous
    const page = await context.newPage();
    await watchViolations(page);
    await page.goto("/en/sign-in");
    await expect(
      page.locator("form, [data-clerk-component], .cl-rootBox").first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");
    expect(await violations(page)).toEqual([]);
    await context.close();
  });

  test("WebAssembly OCR and its worker run under the policy", async ({
    page,
  }) => {
    await watchViolations(page);
    await page.goto("/en/games");
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 400;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 900, 400);
      ctx.fillStyle = "#000";
      ctx.font = "bold 170px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("AZUL", 450, 200);
      return canvas.toDataURL("image/png");
    });
    await page
      .getByRole("region", { name: "Identify a game by photo" })
      .locator('input[type="file"]:not([capture])')
      .setInputFiles({
        name: "box.png",
        mimeType: "image/png",
        buffer: Buffer.from(dataUrl.split(",")[1], "base64"),
      });
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0, {
      timeout: 90_000,
    });
    // The text step really ran (not skipped by a blocked worker or WebAssembly).
    await expect(page.getByText("Reading the text took too long")).toHaveCount(
      0,
    );
    expect(await violations(page)).toEqual([]);
  });
});
