import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { hamming } from "../../src/features/recognition/dhash";
import { hashCoverBytes } from "../../src/features/recognition/hash-bytes";
import {
  canRunAppTests,
  cleanupCatalogFixtures,
  insertImportedGame,
  STATE_FILE,
  TEST_USERS,
  testUserId,
  withDb,
} from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
test.use({ storageState: STATE_FILE.n });
test.describe.configure({ mode: "serial" });
// OCR loads WebAssembly and language data on first use: allow it.
test.setTimeout(120_000);

// Own reserved id range: 9900 games, 9901 library, 9902 game center, 9903 sheets,
// 9904 plays, 9905 sheet sharing, 9906 players, 9907 statistics.
const PREFIX = "9908";
const GTIN = "9783161484100"; // valid EAN-13

let userN: string;
const games: Record<string, string> = {};

const wipe = async () => {
  await cleanupCatalogFixtures([userN], PREFIX);
  await withDb(async (c) => {
    await c.query(`delete from public.game_barcodes where user_id = $1`, [
      userN,
    ]);
    await c.query(`delete from public.game_image_hashes where owner_id = $1`, [
      userN,
    ]);
  });
};

async function seedGame(n: number, name: string) {
  return withDb((c) =>
    insertImportedGame(c, {
      source: "bgg",
      externalId: `${PREFIX}0${n}`,
      language: "en",
      kind: "base",
      name,
      description: "Fixture",
      yearPublished: 2019,
      minPlayers: 1,
      maxPlayers: 5,
      minPlaytime: 40,
      maxPlaytime: 70,
      minAge: 10,
      coverUrl: null,
      terms: [],
      relations: [],
    }),
  );
}

test.beforeAll(async () => {
  userN = await testUserId(TEST_USERS.n.email);
  await withDb((c) =>
    c.query(
      `insert into public.profiles (id) values ($1) on conflict do nothing`,
      [userN],
    ),
  );
  await wipe();
  games.wingspan = await seedGame(1, "Wingspan");
  games.cover = await seedGame(2, "Cover Game E2E");
});

test.afterAll(wipe);

// --- synthetic pictures ------------------------------------------------------

const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const G = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
const R = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];
const PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

/** The 95 modules (1 = bar) of an EAN-13. */
function ean13Modules(code: string): string {
  const d = [...code].map(Number);
  const parity = PARITY[d[0]];
  let out = "101";
  for (let i = 0; i < 6; i++) out += (parity[i] === "L" ? L : G)[d[i + 1]];
  out += "01010";
  for (let i = 0; i < 6; i++) out += R[d[i + 7]];
  return out + "101";
}

type Kind = "title" | "titleAndBarcode" | "barcode" | "blank" | "noise";

/** Draws a picture in the page's canvas and returns its PNG bytes. */
async function picture(page: Page, kind: Kind): Promise<Buffer> {
  const modules = ean13Modules(GTIN);
  const dataUrl = await page.evaluate(
    ({ kind, modules }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1000;
      canvas.height = kind === "titleAndBarcode" ? 800 : 600;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000";
      if (kind === "title" || kind === "titleAndBarcode") {
        ctx.font = "bold 190px Arial, Helvetica, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("WINGSPAN", 500, 220);
      }
      if (kind === "barcode" || kind === "titleAndBarcode") {
        const unit = 5;
        const width = modules.length * unit;
        const x0 = (canvas.width - width) / 2;
        const top = kind === "barcode" ? 150 : 460;
        for (let i = 0; i < modules.length; i++)
          if (modules[i] === "1") ctx.fillRect(x0 + i * unit, top, unit, 260);
      }
      if (kind === "noise") {
        let seed = 7;
        for (let i = 0; i < 4000; i++) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          const v = seed % 256;
          ctx.fillStyle = `rgb(${v},${(v * 3) % 256},${(v * 7) % 256})`;
          ctx.fillRect(seed % 1000, (seed >> 8) % 600, 12, 12);
        }
      }
      return canvas.toDataURL("image/png");
    },
    { kind, modules },
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** A textured, text-free picture, deterministic (blocks of random tones). */
async function pattern(): Promise<Buffer> {
  const width = 400;
  const height = 360;
  const block = 40;
  const raw = Buffer.alloc(width * height * 3);
  let seed = 99;
  const cols = Math.ceil(width / block);
  const tones = Array.from({ length: cols * Math.ceil(height / block) }, () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return 30 + (seed % 200);
  });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = tones[Math.floor(y / block) * cols + Math.floor(x / block)];
      const i = (y * width + x) * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

// --- page helpers ------------------------------------------------------------

const region = (page: Page) =>
  page.getByRole("region", { name: "Identify a game by photo" });
const fileInput = (page: Page) =>
  region(page).locator('input[type="file"]:not([capture])');
const results = (page: Page) =>
  region(page).getByRole("list", { name: "Matches" });
const candidate = (page: Page, gameId: string) =>
  results(page).locator(`[data-game-id="${gameId}"]`);

async function identify(
  page: Page,
  buffer: Buffer,
  name = "box.png",
  mimeType = "image/png",
) {
  await fileInput(page).setInputFiles({ name, mimeType, buffer });
}

async function waitDone(page: Page) {
  // The status line disappears once the result (or an error) is shown.
  await expect(
    region(page).getByRole("button", { name: "Cancel" }),
  ).toHaveCount(0, { timeout: 90_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/en/games");
  await expect(region(page)).toBeVisible();
});

// --- tests -------------------------------------------------------------------

test.describe("identify by photo", () => {
  test("the title is read, the game is found and nothing but small text leaves the device", async ({
    page,
  }) => {
    // Lazy loading: the engines are not requested before the user starts.
    const early: string[] = [];
    page.on("request", (r) => early.push(r.url()));
    await page.reload();
    await expect(region(page)).toBeVisible();
    expect(early.filter((u) => /\/(tesseract|zxing)\//.test(u))).toEqual([]);

    const png = await picture(page, "title");
    const seen: { url: string; method: string; body: string; type: string }[] =
      [];
    page.on("request", (r) =>
      seen.push({
        url: r.url(),
        method: r.method(),
        body: r.postData() ?? "",
        type: r.headers()["content-type"] ?? "",
      }),
    );

    await identify(page, png);
    await waitDone(page);

    // Privacy: no request carries image bytes or leaves for a CDN.
    for (const r of seen) {
      expect(r.type, r.url).not.toMatch(/multipart|^image\//);
      expect(r.body.length, r.url).toBeLessThan(2000);
      expect(r.body, r.url).not.toContain("data:image");
      expect(r.body, r.url).not.toContain("PNG");
      expect(r.url).not.toMatch(/jsdelivr|unpkg|projectnaptha|cdnjs/);
    }
    // The engines came from our own origin, only now.
    expect(seen.some((r) => r.url.includes("/tesseract/"))).toBe(true);

    const hit = candidate(page, games.wingspan);
    await expect(hit).toBeVisible();
    await expect(hit).toContainText("Title");
    await expect(hit).toContainText("Medium");
    await expect(
      region(page).getByText("The photo stays on your device."),
    ).toBeVisible();
  });

  test("confirming teaches the barcode and keeps the photo's hash; next time the barcode alone finds it", async ({
    page,
  }) => {
    await identify(page, await picture(page, "titleAndBarcode"));
    await waitDone(page);
    await candidate(page, games.wingspan)
      .getByRole("button", { name: "This is it: Wingspan" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/en/games/${games.wingspan}$`));

    const learned = await withDb(async (c) => ({
      barcodes: (
        await c.query(
          `select gtin from public.game_barcodes where user_id = $1`,
          [userN],
        )
      ).rows,
      photos: (
        await c.query<{ hex: string }>(
          `select lpad(to_hex(hash), 16, '0') as hex
             from public.game_image_hashes where owner_id = $1 and game_id = $2`,
          [userN, games.wingspan],
        )
      ).rows,
    }));
    expect(learned.barcodes).toEqual([{ gtin: GTIN }]);
    expect(learned.photos).toHaveLength(1);

    // The barcode alone (no text) now identifies it, with high confidence.
    await page.goto("/en/games");
    await identify(page, await picture(page, "barcode"));
    await waitDone(page);
    const hit = candidate(page, games.wingspan);
    await expect(hit).toContainText("Barcode");
    await expect(hit).toContainText("High");
  });

  test("a picture alone finds a game by its cover hash, never with high confidence; browser and server hashes agree", async ({
    page,
  }) => {
    const png = await pattern();
    const serverHash = await hashCoverBytes(png);
    expect(serverHash).toMatch(/^[0-9a-f]{16}$/);
    await withDb((c) =>
      c.query(`select public.upsert_cover_hash($1,$2)`, [
        games.cover,
        serverHash,
      ]),
    );

    await identify(page, png, "cover.png");
    await waitDone(page);
    const hit = candidate(page, games.cover);
    await expect(hit).toBeVisible();
    await expect(hit).toContainText("Picture");
    await expect(hit).not.toContainText("High");
    await expect(hit).not.toContainText("Medium");

    await hit
      .getByRole("button", { name: "This is it: Cover Game E2E" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/en/games/${games.cover}$`));

    // The hash the BROWSER computed (saved as the user's photo) is within 6 bits of the
    // server's hash of the same image.
    const browserHash = await withDb(async (c) => {
      const { rows } = await c.query<{ hex: string }>(
        `select lpad(to_hex(hash), 16, '0') as hex
           from public.game_image_hashes
          where owner_id = $1 and game_id = $2`,
        [userN, games.cover],
      );
      return rows[0].hex;
    });
    expect(hamming(browserHash, serverHash!)).toBeLessThanOrEqual(6);
  });

  test("a blank picture gives an honest empty state with a way to search by hand", async ({
    page,
  }) => {
    await identify(page, await picture(page, "blank"));
    await waitDone(page);
    await expect(
      region(page).getByRole("heading", { name: "No match found" }),
    ).toBeVisible();
    await expect(results(page)).toHaveCount(0);
    await expect(
      region(page).getByRole("link", { name: "None of these: search by hand" }),
    ).toHaveAttribute("href", /\/en\/games(\?|$)/);
  });

  test("noise is never presented as a confident match", async ({ page }) => {
    await identify(page, await picture(page, "noise"));
    await waitDone(page);
    await expect(region(page)).not.toContainText("High");
    await expect(
      region(page).getByRole("link", { name: "None of these: search by hand" }),
    ).toBeVisible();
  });

  test("bad files get their own message and leave the page usable", async ({
    page,
  }) => {
    const cases: [Buffer, string, string, string][] = [
      [
        Buffer.from("just text"),
        "notes.txt",
        "text/plain",
        "That file is not an image.",
      ],
      [
        Buffer.from("not really a png"),
        "fake.png",
        "image/png",
        "We couldn't read that photo",
      ],
      [
        Buffer.alloc(21 * 1024 * 1024),
        "huge.png",
        "image/png",
        "That photo is too large",
      ],
    ];
    for (const [buffer, name, mimeType, message] of cases) {
      await identify(page, buffer, name, mimeType);
      await expect(region(page).getByRole("alert")).toContainText(message, {
        timeout: 60_000,
      });
      await expect(
        region(page).getByRole("button", { name: "Choose a photo" }),
      ).toBeEnabled();
    }
  });

  test("cancelling stops the work and frees the page", async ({ page }) => {
    await identify(page, await picture(page, "title"));
    await region(page).getByRole("button", { name: "Cancel" }).click();
    await expect(
      region(page).getByRole("button", { name: "Cancel" }),
    ).toHaveCount(0);
    await expect(
      region(page).getByRole("button", { name: "Choose a photo" }),
    ).toBeEnabled();
    await expect(results(page)).toHaveCount(0);
  });

  test("without WebAssembly only the picture is compared, and it says so", async ({
    page,
  }) => {
    const png = await pattern();
    await page.addInitScript(() => {
      Object.defineProperty(window, "WebAssembly", {
        value: undefined,
        configurable: true,
      });
    });
    await page.goto("/en/games");
    await identify(page, png, "cover.png");
    await waitDone(page);
    await expect(region(page)).toContainText(
      "This browser cannot read text from photos",
    );
    await expect(candidate(page, games.cover)).toContainText("Picture");
  });

  test("another user's learned barcodes are invisible to me", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: STATE_FILE.l });
    const page = await context.newPage();
    await page.goto("/en/games");
    await expect(region(page)).toBeVisible();
    await identify(page, await picture(page, "barcode"));
    await waitDone(page);
    await expect(candidate(page, games.wingspan)).toHaveCount(0);
    await expect(
      region(page).getByRole("heading", { name: "No match found" }),
    ).toBeVisible();
    await context.close();
  });
});

test.describe("accessibility, phones and languages", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`idle and results have no axe violations (${scheme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: STATE_FILE.n,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      await page.goto("/en/games");
      await expect(region(page)).toBeVisible();
      const audit = async (label: string) => {
        const r = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(r.violations, `${label} (${scheme})`).toEqual([]);
      };
      await audit("idle");
      await identify(page, await picture(page, "title"));
      await waitDone(page);
      await expect(results(page)).toBeVisible();
      await audit("results");
      await context.close();
    });
  }

  test("fits a 375 px phone: no sideways scroll, big touch targets", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: STATE_FILE.n,
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto("/en/games");
    await expect(region(page)).toBeVisible();
    await identify(page, await picture(page, "title"));
    await waitDone(page);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const buttons: Locator = region(page).getByRole("button");
    for (const b of await buttons.all()) {
      if (!(await b.isVisible())) continue;
      const box = (await b.boundingBox())!;
      expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(44);
    }
    await context.close();
  });

  test("Spanish and French labels", async ({ page }) => {
    await page.goto("/es/games");
    await expect(
      page.getByRole("region", { name: "Identificar un juego por foto" }),
    ).toBeVisible();
    await page.goto("/fr/games");
    await expect(
      page.getByRole("region", { name: "Identifier un jeu par photo" }),
    ).toBeVisible();
  });
});
