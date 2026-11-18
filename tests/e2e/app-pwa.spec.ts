import { expect, test } from "@playwright/test";
import { canRunAppTests, STATE_FILE } from "./helpers";

// Public assets: no session needed.
test.describe("PWA assets", () => {
  test("manifest is valid and its icons exist", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBe("Amika");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      expect((await request.get(icon.src)).status()).toBe(200);
    }
  });

  test("service worker is never cached and the offline page exists", async ({
    request,
  }) => {
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["cache-control"]).toContain("no-cache");
    expect((await request.get("/offline.html")).status()).toBe(200);
  });
});

test.describe("install invitation", () => {
  test.skip(!canRunAppTests, "Clerk keys / database not configured");
  test.use({ storageState: STATE_FILE.o });

  test("is offered in Settings and not shown on the first visit", async ({
    page,
  }) => {
    await page.goto("/en/home");
    await expect(
      page.getByRole("region", { name: "Install Amika" }),
    ).toHaveCount(0);
    await page.goto("/en/settings");
    await expect(
      page.getByRole("heading", { name: "Install the app" }),
    ).toBeVisible();
  });
});
