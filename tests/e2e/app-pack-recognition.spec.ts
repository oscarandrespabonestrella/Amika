import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { PIC_H, PIC_W, syntheticCover, writeY4m } from "../support/y4m";
import { canRunAppTests, STATE_FILE } from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");

// The REAL cover of a game of the top-500 pack (Brass: Birmingham, BGG rank 1), as the
// generator saw it. The user of this spec has NO games, so the camera can only know it
// through the pack. The cover endpoint is stubbed with this same picture (offline).
const COVER = readFileSync(
  join(process.cwd(), "tests", "support", "fixtures", "pack-cover-224517.jpg"),
);
const PACK_ID = "bgg:224517";
const Y4M = join(tmpdir(), "amika-pack-recognition.y4m");

test.beforeAll(async () => {
  // Chromium's fake camera plays this file (read when a page opens the camera).
  const rgb = await sharp(COVER)
    .resize(PIC_W, PIC_H, { fit: "contain", background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer();
  writeY4m(Y4M, rgb);
});

test.use({
  storageState: STATE_FILE.o,
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${Y4M}`,
    ],
  },
});
test.setTimeout(180_000);

/** The pack game's real cover for ITS id, a different picture for any other candidate. */
async function serveCover(page: Page) {
  await page.route("**/api/covers/pack/*", async (route) => {
    const id = route.request().url().split("/").pop()!.split("?")[0];
    const body =
      id === PACK_ID.slice(4)
        ? COVER
        : await sharp(syntheticCover(Number(id) || 1), {
            raw: { width: PIC_W, height: PIC_H, channels: 3 },
          })
            .jpeg({ quality: 90 })
            .toBuffer();
    await route.fulfill({
      contentType: "image/jpeg",
      headers: { "cache-control": "private, max-age=600" },
      body,
    });
  });
}

async function enable(page: Page) {
  await page.goto("/en/games");
  await page
    .getByRole("button", { name: "Download (~86 MB) and enable" })
    .click();
  await expect(
    page.getByRole("button", { name: /Scan with the camera/ }),
  ).toBeVisible({ timeout: 90_000 });
}

test("a game that is only in the pack is recognized, with its BGG rank and an Add button; no image leaves the device", async ({
  page,
}) => {
  await enable(page);
  await serveCover(page);
  const outbound: { type: string; size: number }[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET")
      outbound.push({
        type: r.headers()["content-type"] ?? "",
        size: r.postDataBuffer()?.length ?? 0,
      });
  });
  await page.goto("/en/games");
  await page.getByRole("button", { name: /Scan with the camera/ }).click();

  const answer = page.getByTestId("live-answer");
  await expect(answer).toBeVisible({ timeout: 150_000 });
  await expect(answer).toHaveAttribute("data-game-id", PACK_ID);
  await expect(answer).toContainText("Brass: Birmingham");
  await expect(answer).toContainText("Ranked #1 on BoardGameGeek");
  // Starts as a picture-only guess ("low"); OpenCV loads lazily and verifies the cover.
  await expect(answer).toHaveAttribute("data-level", "high", {
    timeout: 90_000,
  });
  await expect(
    page.getByRole("button", {
      name: "Add Brass: Birmingham to the catalog and open it",
    }),
  ).toBeVisible();
  // "This is it" is for catalog games only.
  await expect(page.getByRole("button", { name: /This is it/ })).toHaveCount(0);

  for (const o of outbound) {
    expect(o.type).not.toMatch(/image|octet-stream|multipart/);
    expect(o.size).toBeLessThan(4_000);
  }
});

test("'Not this one' stops answering that game for the session", async ({
  page,
}) => {
  await enable(page);
  await serveCover(page);
  await page.goto("/en/games");
  await page.getByRole("button", { name: /Scan with the camera/ }).click();
  const answer = page.getByTestId("live-answer");
  await expect(answer).toHaveAttribute("data-game-id", PACK_ID, {
    timeout: 150_000,
  });
  await page.getByRole("button", { name: "Not this one" }).click();
  await page.waitForTimeout(8_000);
  await expect(
    page.locator(`[data-testid="live-answer"][data-game-id="${PACK_ID}"]`),
  ).toHaveCount(0);
});

test("nothing about the pack is requested or loaded before the user enables it", async ({
  page,
}) => {
  const packRequests: string[] = [];
  const scripts: { url: string; body: string }[] = [];
  page.on("request", (r) => {
    if (/\/reference-pack\//.test(r.url())) packRequests.push(r.url());
  });
  page.on("response", async (r) => {
    if (/\/_next\/static\/.*\.js/.test(r.url()))
      scripts.push({ url: r.url(), body: await r.text().catch(() => "") });
  });
  await page.goto("/en/games");
  const card = page.getByTestId("recognition-activation");
  await expect(card).toBeVisible();
  await expect(card).toContainText(
    "1 MB for the pack of the 500 best-ranked games",
  );
  expect(packRequests).toEqual([]);
  expect(scripts.length).toBeGreaterThan(0);
  // The manifest's DATA (game names) lives in a lazy chunk, never in what a visit loads.
  expect(scripts.filter((s) => s.body.includes("Brass: Birmingham"))).toEqual(
    [],
  );
});

test("enabling downloads the pack once (and only then); a reload does not download it again; disabling empties it", async ({
  page,
}) => {
  const packRequests: string[] = [];
  page.on("request", (r) => {
    if (/\/reference-pack\/vectors-[0-9a-f]{8}\.bin/.test(r.url()))
      packRequests.push(r.url());
  });
  await page.goto("/en/games");
  expect(packRequests).toHaveLength(0);
  await page
    .getByRole("button", { name: "Download (~86 MB) and enable" })
    .click();
  await expect(
    page.getByRole("button", { name: /Scan with the camera/ }),
  ).toBeVisible({ timeout: 90_000 });
  expect(packRequests).toHaveLength(1);

  const packRows = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open("amika-recognition", 1);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("refs")) return resolve(0);
            const all = db.transaction("refs").objectStore("refs").getAll();
            all.onsuccess = () =>
              resolve(
                (all.result as { kind: string; key: string }[]).filter(
                  (r) => r.kind === "pack" && r.key !== "__pack_version",
                ).length,
              );
          };
          open.onerror = () => resolve(-1);
        }),
    );
  await expect.poll(packRows).toBe(500);

  await page.reload();
  await expect(
    page.getByRole("button", { name: /Scan with the camera/ }),
  ).toBeVisible();
  expect(packRequests).toHaveLength(1);

  await page.goto("/en/settings");
  await page
    .getByRole("button", { name: /Disable and delete the download/ })
    .click();
  await expect(page.getByTestId("recognition-activation")).toBeVisible();
  await expect.poll(packRows).toBe(0);
});
