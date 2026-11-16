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
    const res = await request.get("/opencv/opencv.js");
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

  test("the on-device model (worker and ONNX WebAssembly) runs under the policy", async ({
    page,
  }) => {
    await watchViolations(page);
    await page.goto("/en/games");
    // Opt in: loads the embedding worker and the ONNX WebAssembly runtime.
    await page
      .getByRole("button", { name: "Download (~85 MB) and enable" })
      .click();
    await expect(
      page.getByRole("button", { name: /Scan with the camera/ }),
    ).toBeVisible({ timeout: 90_000 });
    expect(await violations(page)).toEqual([]);
  });

  test("OpenCV loads, and its only CSP need is eval (known: resolve before CSP_ENFORCE=1)", async ({
    page,
  }) => {
    await watchViolations(page);
    await page.goto("/en/games");
    // OpenCV is a big script that instantiates WebAssembly: load it the way the app does.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "/opencv/opencv.js";
          script.onerror = () => reject(new Error("opencv.js blocked"));
          script.onload = () => {
            const cv = (window as unknown as { cv: unknown }).cv as
              | Promise<unknown>
              | { Mat?: unknown; onRuntimeInitialized?: () => void };
            if (cv instanceof Promise) void cv.then(() => resolve());
            else if (cv?.Mat) resolve();
            else cv.onRuntimeInitialized = () => resolve();
          };
          document.head.appendChild(script);
        }),
    );
    // opencv.js (Emscripten embind) builds its bindings with eval. The policy is Report-Only
    // today, so it works; enforcing it needs 'unsafe-eval' on this page or OpenCV moved into
    // a worker that carries its own CSP (docs/SECURITY.md section 17). Nothing else may be reported.
    const reported = await violations(page);
    expect(reported.length).toBeGreaterThan(0);
    expect(
      reported.filter(
        (v) => !(v.directive === "script-src" && v.blocked === "eval"),
      ),
    ).toEqual([]);
  });
});
