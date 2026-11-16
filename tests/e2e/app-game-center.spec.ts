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

// Own reserved id range (see app-games / app-library specs).
const PREFIX = "9902";
const GAME_NAME = "Game Center E2E";
const YT_ID = "dQw4w9WgXcQ";

let adminId: string;
let gameId: string;
let customId: string;

const contexts: BrowserContext[] = [];
async function open(
  browser: Browser,
  user: "e" | "f" | "b",
  scheme: "light" | "dark" = "light",
): Promise<Page> {
  const context = await browser.newContext({
    storageState: STATE_FILE[user],
    colorScheme: scheme,
  });
  contexts.push(context);
  return context.newPage();
}

test.beforeAll(async () => {
  adminId = await testUserId(TEST_USERS.e.email);
  await cleanupCatalogFixtures([], PREFIX);
  await withDb(async (c) => {
    gameId = await insertImportedGame(c, {
      source: "bgg",
      externalId: `${PREFIX}01`,
      language: "en",
      kind: "base",
      name: GAME_NAME,
      description: "Fixture",
      yearPublished: 2020,
      minPlayers: 2,
      maxPlayers: 4,
      minPlaytime: 30,
      maxPlaytime: 60,
      minAge: 8,
      coverUrl: null,
      terms: [],
      relations: [
        {
          type: "has_expansion",
          externalId: `${PREFIX}02`,
          name: "GC Expansion",
        },
      ],
    });
    // The administrator role is granted to this test user only for the run.
    await c.query(
      `insert into public.profiles (id) values ($1) on conflict do nothing`,
      [adminId],
    );
    await c.query(
      `insert into public.user_roles (user_id, role) values ($1,'admin') on conflict do nothing`,
      [adminId],
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

/** The admin form's own Add button (the Expansions list has its own "Add" too). */
const addButton = (page: Page) =>
  page
    .getByLabel("Title", { exact: true })
    .first()
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: "Add", exact: true });

const gamePage = (page: Page, locale = "en") =>
  page.goto(`/${locale}/games/${gameId}`);
/** Admin controls and the FAQ form need Clerk (the Server Actions check the session). */
const ready = (page: Page) =>
  expect(
    page.getByRole("button", { name: /^(Send suggestion|Publish)$/ }),
  ).toBeEnabled();

test.describe("roles", () => {
  test("only an administrator sees the management panel", async ({
    browser,
  }) => {
    const admin = await open(browser, "e");
    await gamePage(admin);
    await expect(admin.getByText("Manage Game Center")).toBeVisible();

    const user = await open(browser, "f");
    await gamePage(user);
    await expect(
      user.getByRole("heading", { name: "Frequently asked questions" }),
    ).toBeVisible();
    await expect(user.getByText("Manage Game Center")).toHaveCount(0);
    await expect(user.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("a custom (private) game has no Game Center", async ({ browser }) => {
    const user = await open(browser, "f");
    await user.goto("/en/games/new");
    await user.getByLabel("Name").fill(`GC Custom ${Date.now()}`);
    await user.getByRole("button", { name: "Create game" }).click();
    await expect(user).toHaveURL(/\/en\/games\/[0-9a-f-]{36}$/);
    customId = new URL(user.url()).pathname.split("/").pop()!;
    await expect(
      user.getByRole("heading", { name: "Frequently asked questions" }),
    ).toHaveCount(0);
    await expect(
      user.getByRole("heading", { name: "Rules", exact: true }),
    ).toHaveCount(0);
  });
});

test.describe("administrator adds content", () => {
  test("validates links and videos", async ({ browser }) => {
    const page = await open(browser, "e");
    await gamePage(page);
    await page.getByText("Manage Game Center").click();
    await ready(page);

    await page.getByLabel("Title", { exact: true }).first().fill("Bad link");
    await page
      .getByLabel("Address (https://…)", { exact: true })
      .fill("http://insecure.example.com/rules.pdf");
    await addButton(page).click();
    await expect(
      page.getByText("Enter a valid https:// address."),
    ).toBeVisible();

    await page.getByLabel("Type").selectOption("video");
    await page
      .getByLabel("YouTube link or video id")
      .fill("https://vimeo.com/12345");
    await addButton(page).click();
    await expect(
      page.getByText("Enter a YouTube link or a video id."),
    ).toBeVisible();
  });

  test("adds an official rules link, shown in its language", async ({
    browser,
  }) => {
    const page = await open(browser, "e");
    await gamePage(page);
    await page.getByText("Manage Game Center").click();
    await ready(page);

    await page
      .getByLabel("Title", { exact: true })
      .first()
      .fill("Official rulebook");
    await page
      .getByLabel("Address (https://…)", { exact: true })
      .fill("https://example.com/rulebook.pdf");
    await page.getByLabel("Official source").check();
    await addButton(page).click();
    await expect(
      page.getByText("Saved", { exact: true }).first(),
    ).toBeVisible();

    const link = page.getByRole("link", { name: /Official rulebook/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      "https://example.com/rulebook.pdf",
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(
      page.locator("#rules").getByText("Official", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("#rules").getByText("English", { exact: true }),
    ).toBeVisible();
  });

  test("adds a YouTube video from a URL; nothing loads until it is played", async ({
    browser,
  }) => {
    const page = await open(browser, "e");
    await gamePage(page);
    await page.getByText("Manage Game Center").click();
    await ready(page);

    await page.getByLabel("Type").selectOption("video");
    await page.getByLabel("Title", { exact: true }).first().fill("How to play");
    await page
      .getByLabel("YouTube link or video id")
      .fill(`https://www.youtube.com/watch?v=${YT_ID}&t=10s`);
    await addButton(page).click();
    await expect(
      page.getByText("Saved", { exact: true }).first(),
    ).toBeVisible();

    const stored = await withDb((c) =>
      c.query(
        `select kind, url, youtube_id from public.game_resources where game_id = $1 and kind = 'video'`,
        [gameId],
      ),
    );
    expect(stored.rows).toEqual([
      { kind: "video", url: null, youtube_id: YT_ID },
    ]); // only the id is stored

    // Fresh page: count requests to YouTube before and after pressing play.
    const requests: string[] = [];
    page.on("request", (r) => {
      if (/youtube/i.test(new URL(r.url()).hostname)) requests.push(r.url());
    });
    await gamePage(page);
    const play = page.getByRole("button", { name: "Play video: How to play" });
    await expect(play).toBeVisible();
    expect(requests).toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);

    await play.click();
    const frame = page.locator("iframe");
    await expect(frame).toHaveAttribute(
      "src",
      new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${YT_ID}`),
    );
    await expect(frame).toHaveAttribute("title", "How to play");
    await expect(frame).toHaveAttribute("sandbox", /allow-scripts/);
  });

  test("saves a rules summary per language, as plain text", async ({
    browser,
  }) => {
    const page = await open(browser, "e");
    await gamePage(page);
    await page.getByText("Manage Game Center").click();
    await ready(page);

    const form = page.locator("form", {
      has: page.getByRole("heading", { name: "Rules summary" }),
    });
    await form.getByLabel("Language").selectOption("en");
    await form
      .getByLabel("Summary")
      .fill("Roll dice.\n\nScore <b>points</b> and win.");
    await form.getByRole("button", { name: "Save summary" }).click();
    await expect(
      page.getByText("Saved", { exact: true }).first(),
    ).toBeVisible();

    await form.getByLabel("Language").selectOption("es");
    await form.getByLabel("Summary").fill("Tira los dados.");
    await form.getByRole("button", { name: "Save summary" }).click();
    // Only the summary in the viewer's language starts open; the Spanish one is collapsed.
    const spanish = page.locator("#rules details", { hasText: "Español" });
    await expect(spanish).toHaveCount(1, { timeout: 15_000 });
    await expect(spanish.getByText("Tira los dados.")).toBeHidden();
    await spanish.locator("summary").click();
    await expect(spanish.getByText("Tira los dados.")).toBeVisible();

    await expect(
      page.locator("#rules").getByText("Score <b>points</b> and win."),
    ).toBeVisible();
    await expect(page.locator("#rules b")).toHaveCount(0);
  });

  test("adds a gallery image with attribution", async ({ browser }) => {
    const page = await open(browser, "e");
    await gamePage(page);
    await page.getByText("Manage Game Center").click();
    await ready(page);

    await page
      .getByLabel("Image address (https://…)")
      .fill("https://example.com/box.jpg");
    await page.getByLabel("Credit (required)").fill("Photo: Jane Doe");
    await page.getByLabel("License").fill("CC BY 4.0");
    await page.getByRole("button", { name: "Add image" }).click();
    await expect(
      page.locator("#gallery").getByText("Credit: Photo: Jane Doe"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator("#gallery").getByText("License: CC BY 4.0"),
    ).toBeVisible();
  });

  test("an image without a credit is rejected", async ({ browser }) => {
    const page = await open(browser, "e");
    await gamePage(page);
    await page.getByText("Manage Game Center").click();
    await ready(page);
    await page
      .getByLabel("Image address (https://…)")
      .fill("https://example.com/other.jpg");
    await page.getByRole("button", { name: "Add image" }).click();
    await expect(page.getByText("This field is required.")).toBeVisible();
  });

  test("publishes an FAQ directly", async ({ browser }) => {
    const page = await open(browser, "e");
    await gamePage(page);
    await ready(page);
    await page.getByLabel("Question", { exact: true }).fill("How many dice?");
    await page
      .getByLabel("Answer", { exact: true })
      .fill("Two dice.\nRolled together.");
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Published.")).toBeVisible();
    await expect(page.getByText("How many dice?")).toBeVisible();
  });
});

test.describe("a regular user", () => {
  test("sees the published content but cannot manage it", async ({
    browser,
  }) => {
    const page = await open(browser, "f");
    await gamePage(page);
    await expect(
      page.getByRole("link", { name: /Official rulebook/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Play video: How to play" }),
    ).toBeVisible();
    await expect(
      page.locator("#faq").getByText("How many dice?"),
    ).toBeVisible();
    await page.locator("#faq summary", { hasText: "How many dice?" }).click();
    await expect(page.getByText("Two dice.")).toBeVisible();
    await expect(page.getByText("Manage Game Center")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("suggests a question: it stays private until approved", async ({
    browser,
  }) => {
    const user = await open(browser, "f");
    await gamePage(user);
    await ready(user);
    await user
      .getByLabel("Question", { exact: true })
      .fill("Can I trade on turn one?");
    await user
      .getByLabel("Answer", { exact: true })
      .fill("Yes, with any player.");
    await user.getByRole("button", { name: "Send suggestion" }).click();
    await expect(user.getByText("Sent for review. Thank you!")).toBeVisible();

    // The author sees it, labelled as pending.
    await expect(user.getByText("Your suggestions")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      user.locator("#faq").getByText("Pending review"),
    ).toBeVisible();

    const row = await withDb((c) =>
      c.query(
        `select status, created_by is not null as has_author from public.faq_entries where game_id = $1 and status = 'pending'`,
        [gameId],
      ),
    );
    expect(row.rows).toEqual([{ status: "pending", has_author: true }]);

    // Another user does not see it.
    const other = await open(browser, "b");
    await gamePage(other);
    await expect(other.getByText("Can I trade on turn one?")).toHaveCount(0);
  });

  test("the administrator reviews and approves it", async ({ browser }) => {
    const admin = await open(browser, "e");
    await gamePage(admin);
    const queue = admin.getByTestId("faq-review");
    await expect(queue).toBeVisible();
    await expect(queue.getByText("Can I trade on turn one?")).toBeVisible();
    await queue.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByTestId("faq-review")).toHaveCount(0, {
      timeout: 15_000,
    });

    const status = await withDb((c) =>
      c.query(
        `select status, reviewed_by from public.faq_entries where game_id = $1 and created_by <> $2`,
        [gameId, adminId],
      ),
    );
    expect(status.rows).toEqual([
      { status: "published", reviewed_by: adminId },
    ]);

    // Now everyone sees it, and the author no longer lists it as a pending suggestion.
    const other = await open(browser, "b");
    await gamePage(other);
    await expect(
      other.locator("#faq").getByText("Can I trade on turn one?"),
    ).toBeVisible();
    const author = await open(browser, "f");
    await gamePage(author);
    await expect(author.getByText("Your suggestions")).toHaveCount(0);
  });

  test("a rejected suggestion is shown as not accepted, only to its author", async ({
    browser,
  }) => {
    const user = await open(browser, "f");
    await gamePage(user);
    await ready(user);
    await user
      .getByLabel("Question", { exact: true })
      .fill("Is this a good game?");
    await user.getByLabel("Answer", { exact: true }).fill("Opinion.");
    await user.getByRole("button", { name: "Send suggestion" }).click();
    await expect(user.getByText("Sent for review. Thank you!")).toBeVisible();

    const admin = await open(browser, "e");
    await gamePage(admin);
    await admin
      .getByTestId("faq-review")
      .getByRole("button", { name: "Reject" })
      .click();
    await expect(admin.getByTestId("faq-review")).toHaveCount(0, {
      timeout: 15_000,
    });

    await gamePage(user);
    await expect(user.locator("#faq").getByText("Not accepted")).toBeVisible();
    const other = await open(browser, "b");
    await gamePage(other);
    await expect(other.getByText("Is this a good game?")).toHaveCount(0);
  });

  test("can withdraw a pending suggestion", async ({ browser }) => {
    const user = await open(browser, "f");
    await gamePage(user);
    await ready(user);
    await user.getByLabel("Question", { exact: true }).fill("Withdraw me?");
    await user.getByLabel("Answer", { exact: true }).fill("Soon.");
    await user.getByRole("button", { name: "Send suggestion" }).click();
    await expect(user.getByText("Sent for review. Thank you!")).toBeVisible();

    const mine = user.locator("details", { hasText: "Withdraw me?" });
    await mine.locator("summary").click();
    await mine.getByRole("button", { name: "Withdraw" }).click();
    await user.getByRole("button", { name: "Yes, remove" }).click();
    await expect(user.getByText("Withdraw me?")).toHaveCount(0, {
      timeout: 15_000,
    });
    const left = await withDb((c) =>
      c.query(
        `select 1 from public.faq_translations where question = 'Withdraw me?'`,
      ),
    );
    expect(left.rowCount).toBe(0);
  });

  test("is limited to 5 open suggestions per game", async ({ browser }) => {
    const user = await open(browser, "f");
    const frank = await testUserId(TEST_USERS.f.email);
    await withDb(async (c) => {
      await c.query(
        `delete from public.faq_entries where created_by = $1 and status = 'pending'`,
        [frank],
      );
      for (let i = 1; i <= 5; i++) {
        await c.query(
          `insert into public.faq_entries (game_id, status, created_by) values ($1,'pending',$2)`,
          [gameId, frank],
        );
      }
    });
    await gamePage(user);
    await ready(user);
    await user.getByLabel("Question", { exact: true }).fill("One too many");
    await user.getByLabel("Answer", { exact: true }).fill("No.");
    await user.getByRole("button", { name: "Send suggestion" }).click();
    await expect(
      user
        .getByRole("alert")
        .filter({ hasText: "5 suggestions waiting for review" }),
    ).toBeVisible();
    await withDb((c) =>
      c.query(
        `delete from public.faq_entries where created_by = $1 and status = 'pending'`,
        [frank],
      ),
    );
  });

  test("an empty question is rejected with a translated message", async ({
    browser,
  }) => {
    const user = await open(browser, "f");
    await gamePage(user, "es");
    await expect(
      user.getByRole("button", { name: "Enviar sugerencia" }),
    ).toBeEnabled();
    await user.getByRole("button", { name: "Enviar sugerencia" }).click();
    await expect(user.getByText("Este campo es obligatorio.")).toBeVisible();
  });
});

test.describe("administrator removes content", () => {
  test("removes a resource after confirming", async ({ browser }) => {
    const admin = await open(browser, "e");
    await gamePage(admin);
    await admin
      .locator("#rules li", { hasText: "Official rulebook" })
      .getByRole("button", { name: "Remove" })
      .click();
    await admin.getByRole("button", { name: "Cancel" }).click();
    await expect(
      admin.getByRole("link", { name: /Official rulebook/ }),
    ).toBeVisible();

    await admin
      .locator("#rules li", { hasText: "Official rulebook" })
      .getByRole("button", { name: "Remove" })
      .click();
    await admin.getByRole("button", { name: "Yes, remove" }).click();
    await expect(
      admin.getByRole("link", { name: /Official rulebook/ }),
    ).toHaveCount(0, { timeout: 15_000 });
  });
});

test.describe("languages and expansions", () => {
  test("content falls back to English and is labelled when it differs", async ({
    browser,
  }) => {
    const user = await open(browser, "f");
    await gamePage(user, "es");
    await expect(
      user.getByRole("heading", { name: "Reglas", exact: true }),
    ).toBeVisible();
    await expect(
      user.getByRole("heading", { name: "Preguntas frecuentes" }),
    ).toBeVisible();
    // The Spanish rules summary comes first; the FAQ only exists in English and says so.
    await expect(
      user.locator("#rules").getByText("Tira los dados."),
    ).toBeVisible();
    await expect(
      user
        .locator("#faq summary", { hasText: "How many dice?" })
        .getByText("English"),
    ).toBeVisible();

    await gamePage(user, "fr");
    await expect(
      user.getByRole("heading", { name: "Règles", exact: true }),
    ).toBeVisible();
    await expect(
      user.getByRole("heading", { name: "Questions fréquentes" }),
    ).toBeVisible();
  });

  test("an expansion that is not in the catalog cannot be added while BGG is unavailable", async ({
    browser,
  }) => {
    test.skip(!!process.env.BGG_API_TOKEN, "BGG token configured");
    const user = await open(browser, "f");
    await gamePage(user);
    await expect(user.getByText("GC Expansion")).toBeVisible();
    await expect(user.getByText("(Not in the catalog yet)")).toBeVisible();
    await expect(
      user.getByRole("button", { name: "Add", exact: true }),
    ).toHaveCount(0);
  });

  test("the section links jump to their sections", async ({ browser }) => {
    const user = await open(browser, "f");
    await gamePage(user);
    const nav = user.getByRole("navigation", { name: "Game Center sections" });
    for (const [label, id] of [
      ["Rules", "rules"],
      ["Videos", "videos"],
      ["FAQ", "faq"],
      ["Gallery", "gallery"],
    ] as const) {
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        `#${id}`,
      );
      await expect(user.locator(`#${id}`)).toBeVisible();
    }
  });
});

test.describe("accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const role of ["e", "f"] as const) {
      test(`the game page has no axe violations (${role === "e" ? "admin" : "user"}, ${scheme})`, async ({
        browser,
      }) => {
        const page = await open(browser, role, scheme);
        await gamePage(page);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (role === "e") await page.getByText("Manage Game Center").click();
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      });
    }
  }

  test("the private game page still passes", async ({ browser }) => {
    const page = await open(browser, "f");
    await page.goto(`/en/games/${customId}`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
