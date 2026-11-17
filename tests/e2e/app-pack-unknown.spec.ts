import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { syntheticCover, writeY4m } from "../support/y4m";
import { canRunAppTests, STATE_FILE } from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");

// A picture that matches no cover of the catalog or of the 500-game pack.
const Y4M = join(tmpdir(), "amika-pack-unknown.y4m");
writeY4m(Y4M, syntheticCover(987654));

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

test("a box that is in no reference never gets a high or medium answer", async ({
  page,
}) => {
  await page.goto("/en/games");
  await page
    .getByRole("button", { name: "Download (~86 MB) and enable" })
    .click();
  await expect(
    page.getByRole("button", { name: /Scan with the camera/ }),
  ).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: /Scan with the camera/ }).click();
  await expect(page.getByTestId("live-video")).toBeVisible({ timeout: 30_000 });

  // Let it scan for a while: whatever it says (nothing, or a low guess) is never confident.
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(2_000);
    const level = await page
      .getByTestId("live-answer")
      .getAttribute("data-level", { timeout: 500 })
      .catch(() => null);
    expect(["high", "medium"]).not.toContain(level);
  }
});
