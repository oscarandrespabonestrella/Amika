import AxeBuilder from "@axe-core/playwright";
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
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
test.describe.configure({ mode: "serial" });

// Own reserved id range (9913): see app-groups (9912), app-shared-plays (9911).
// The administrator is user h, NOT e: app-game-center grants and removes admin on e while it
// runs in parallel, and two specs toggling the same role race each other.
const PREFIX = "9913";
const GAME_NAME = "Manuals E2E";
const PROPOSED_URL = "https://example.com/e2e/proposed-rules.pdf";
const PUBLISHED_URL = "https://example.com/e2e/published-rules.pdf";
const PLAIN_URL = "https://example.com/e2e/rules-page";

let adminId: string;
let userId: string;
let gameId: string;
let publishedResourceId: string;

const contexts: BrowserContext[] = [];
async function open(browser: Browser, user: "h" | "f"): Promise<Page> {
  const context = await browser.newContext({ storageState: STATE_FILE[user] });
  contexts.push(context);
  return context.newPage();
}

const gamePage = (page: Page) => page.goto(`/en/games/${gameId}`);

test.beforeAll(async () => {
  adminId = await testUserId(TEST_USERS.h.email);
  userId = await testUserId(TEST_USERS.f.email);
  await cleanupCatalogFixtures([], PREFIX);
  await withDb(async (c) => {
    gameId = await insertImportedGame(c, {
      source: "bgg",
      externalId: `${PREFIX}01`,
      language: "en",
      kind: "base",
      name: GAME_NAME,
      description: "Fixture",
      yearPublished: 2021,
      minPlayers: 2,
      maxPlayers: 4,
      minPlaytime: 30,
      maxPlaytime: 60,
      minAge: 8,
      coverUrl: null,
      terms: [],
      relations: [],
    });
    await c.query(
      `insert into public.profiles (id) values ($1),($2) on conflict do nothing`,
      [adminId, userId],
    );
    // The administrator role is granted to this test user only for the run.
    await c.query(
      `insert into public.user_roles (user_id, role) values ($1,'admin') on conflict do nothing`,
      [adminId],
    );
    await c.query(
      `insert into public.manual_suggestions (game_id, url, title, source_host, locale, publisher, is_official, created_by)
       values ($1, $2, 'Proposed rulebook', 'example.com', 'es', 'Devir', true, $3)`,
      [gameId, PROPOSED_URL, userId],
    );
    const published = await c.query(
      `insert into public.game_resources (game_id, kind, locale, title, url, is_official, publisher, verified_at)
       values ($1,'rules','en','Published rulebook',$2,true,'Devir', now()) returning id`,
      [gameId, PUBLISHED_URL],
    );
    publishedResourceId = published.rows[0].id;
    await c.query(
      `insert into public.game_resources (game_id, kind, locale, title, url)
       values ($1,'rules','en','Plain rules page',$2)`,
      [gameId, PLAIN_URL],
    );
  });
});

test.afterAll(async () => {
  await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
  await withDb((c) =>
    c.query(`delete from public.user_roles where user_id = $1`, [adminId]),
  );
  await cleanupCatalogFixtures([], PREFIX);
});

test.describe("search dialog", () => {
  test("opens, explains itself and ends in a clear state", async ({
    browser,
  }) => {
    const page = await open(browser, "f");
    await gamePage(page);
    await page.getByRole("button", { name: "Search manual" }).click();

    const dialog = page.getByRole("dialog", {
      name: `Rulebooks for ${GAME_NAME}`,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Only the link to the original site/),
    ).toBeVisible();

    // Without a Brave key (the test server blanks it) the answer is "not set up"; with one,
    // the search runs for real and either finds PDFs or says nothing was found.
    await expect(
      dialog
        .getByText(
          /not set up on this server|No manuals found|Open PDF|Something went wrong/,
        )
        .first(),
    ).toBeVisible({ timeout: 30_000 });

    const results = await new AxeBuilder({ page }).include("dialog").analyze();
    expect(results.violations).toEqual([]);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe("rules list", () => {
  test("a verified PDF can be downloaded or saved; a plain page cannot", async ({
    browser,
  }) => {
    const page = await open(browser, "f");
    await gamePage(page);
    const rules = page.locator("#rules");

    const published = rules.locator("li", { hasText: "Published rulebook" });
    await expect(published.getByText("Devir")).toBeVisible();
    await expect(
      published.getByRole("link", { name: "Download" }),
    ).toHaveAttribute(
      "href",
      `/api/manuals/file?resource=${publishedResourceId}`,
    );
    await expect(
      published.getByRole("button", { name: "Save for offline" }),
    ).toBeVisible();

    const plain = rules.locator("li", { hasText: "Plain rules page" });
    await expect(plain).toBeVisible();
    await expect(plain.getByRole("link", { name: "Download" })).toHaveCount(0);
  });

  test("the download endpoint refuses anonymous callers and unknown ids", async ({
    request,
  }) => {
    expect(
      (
        await request.get(`/api/manuals/file?resource=${publishedResourceId}`)
      ).status(),
    ).toBe(401);
  });

  test("the download endpoint is not an open proxy", async ({ browser }) => {
    const page = await open(browser, "f");
    await gamePage(page);
    const status = (query: string) =>
      page.evaluate(
        async (q) => (await fetch(`/api/manuals/file${q}`)).status,
        query,
      );
    // no selector, a malformed id, a forged token, and a raw URL (not a supported selector)
    expect(await status("")).toBe(400);
    expect(await status("?resource=not-a-uuid")).toBe(400);
    expect(await status("?token=forged.token")).toBe(404);
    expect(
      await status(`?url=${encodeURIComponent("http://169.254.169.254/")}`),
    ).toBe(400);
    // a well-formed id that does not exist is the same as one the user cannot see
    expect(await status("?resource=00000000-0000-4000-8000-000000000000")).toBe(
      404,
    );
  });
});

test.describe("proposals", () => {
  test("the author sees their pending proposal; others do not", async ({
    browser,
  }) => {
    const author = await open(browser, "f");
    await gamePage(author);
    const mine = author.getByRole("heading", { name: "Proposed manuals" });
    await expect(mine).toBeVisible();
    const box = mine.locator("xpath=..");
    await expect(box.getByText("Proposed rulebook")).toBeVisible();
    await expect(box.getByText("Pending")).toBeVisible();
    await expect(box.getByRole("button", { name: "Withdraw" })).toBeVisible();
    // an author cannot publish
    await expect(box.getByRole("button", { name: "Publish" })).toHaveCount(0);
  });

  test("an administrator publishes it into the rules and the queue empties", async ({
    browser,
  }) => {
    const admin = await open(browser, "h");
    await gamePage(admin);
    const queue = admin
      .getByRole("heading", { name: "Manuals to review" })
      .locator("xpath=..");
    await expect(queue.getByText("Proposed rulebook")).toBeVisible();

    await queue.getByRole("button", { name: "Publish" }).click();
    await expect(
      admin.getByRole("heading", { name: "Manuals to review" }),
    ).toHaveCount(0);
    const link = admin
      .locator("#rules")
      .getByRole("link", { name: /Proposed rulebook/ });
    await expect(link).toHaveAttribute("href", PROPOSED_URL);
    await expect(link).toHaveAttribute("rel", /noopener/);
  });
});

test.describe("offline", () => {
  const KEY = "e2e0000000000001";
  const FILE = `/offline/manuals/files/${KEY}`;

  test("a manual saved on the device opens with no network", async ({
    browser,
  }) => {
    const page = await open(browser, "f");
    const context = page.context();
    await gamePage(page);
    // the worker only exists in the production build the suite runs against
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

    // What "Save for offline" writes: the PDF and its description, in the manuals cache.
    await page.evaluate(
      async ({ key, file }) => {
        const cache = await caches.open("amika-manuals-v1");
        await cache.put(
          file,
          new Response("%PDF-1.7 fixture", {
            headers: { "content-type": "application/pdf" },
          }),
        );
        await cache.put(
          `/offline/manuals/meta/${key}`,
          new Response(
            JSON.stringify({
              key,
              url: "https://example.com/e2e/saved.pdf",
              gameId: "g",
              gameName: "Manuals E2E",
              title: "Saved rulebook",
              locale: "es",
              publisher: "Devir",
              sizeBytes: 16,
              savedAt: new Date().toISOString(),
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      },
      { key: KEY, file: FILE },
    );

    try {
      await context.setOffline(true);

      await page.goto("/offline/manuals.html");
      await expect(
        page.getByRole("heading", { name: "Saved manuals" }),
      ).toBeVisible();
      await expect(page.getByText("Saved rulebook")).toBeVisible();
      await expect(page.getByRole("link", { name: "Open" })).toHaveAttribute(
        "href",
        FILE,
      );

      // the PDF itself comes from the worker, not from the network
      const served = await page.evaluate(async (file) => {
        const res = await fetch(file);
        return {
          status: res.status,
          type: res.headers.get("content-type"),
          text: await res.text(),
        };
      }, FILE);
      expect(served).toEqual({
        status: 200,
        type: "application/pdf",
        text: "%PDF-1.7 fixture",
      });

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);

      // removing works offline too
      await page.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByText("Saved rulebook")).toHaveCount(0);
    } finally {
      await context.setOffline(false);
      await page.evaluate(() => caches.delete("amika-manuals-v1"));
    }
  });

  test("a normal page load while offline still shows the offline page", async ({
    browser,
  }) => {
    const page = await open(browser, "f");
    const context = page.context();
    await gamePage(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    try {
      await context.setOffline(true);
      await page.goto("/en/home");
      await expect(page.getByText("You're offline")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Saved manuals" }),
      ).toHaveAttribute("href", "/offline/manuals.html");
    } finally {
      await context.setOffline(false);
    }
  });
});
