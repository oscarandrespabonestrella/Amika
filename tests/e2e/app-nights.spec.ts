import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
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
test.use({ storageState: STATE_FILE.s });
test.describe.configure({ mode: "serial" });

// Own reserved id range (9914; 9913 is app-manuals) and own users: s hosts, t is the friend who votes.
const PREFIX = "9914";
const NAMES = {
  alpha: "Nights Alpha E2E", // 2-4 players, 30 min
  beta: "Nights Beta E2E", // 2-6 players, 60 min
  gamma: "Nights Gamma E2E", // 5-8 players, 90 min
  delta: "Nights Delta E2E", // owned by Tina only: she suggests it
};
const NIGHT_TITLE = "Noche E2E";
const SEEN_SOON = { timeout: 20_000 }; // the page polls every 10 s
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

let userS: string;
let userT: string;
const gameIds: Record<keyof typeof NAMES, string> = {
  alpha: "",
  beta: "",
  gamma: "",
  delta: "",
};
let nightId: string;
let guestUrl: string;

const wipe = async () => {
  await withDb(async (c) => {
    // Nights go first: links, guests, votes, members and night games cascade from them.
    await c.query(`delete from public.game_nights where owner_id = any($1)`, [
      [userS, userT],
    ]);
    await c.query(
      `delete from public.friendships where user_a = any($1) or user_b = any($1)`,
      [[userS, userT]],
    );
    await c.query(`delete from public.library_items where user_id = any($1)`, [
      [userS, userT],
    ]);
    await c.query(`delete from public.players where owner_id = any($1)`, [
      [userS, userT],
    ]);
  });
  await cleanupCatalogFixtures([userS, userT], PREFIX);
};

async function importGame(
  key: keyof typeof NAMES,
  n: number,
  min: number,
  max: number,
  playtime: number,
) {
  gameIds[key] = await withDb((c) =>
    insertImportedGame(c, {
      source: "bgg",
      externalId: `${PREFIX}0${n}`,
      language: "en",
      kind: "base",
      name: NAMES[key],
      description: "Fixture",
      yearPublished: 2020,
      minPlayers: min,
      maxPlayers: max,
      minPlaytime: playtime,
      maxPlaytime: playtime,
      minAge: 8,
      coverUrl: null,
      terms: [],
      relations: [],
    }),
  );
}

test.beforeAll(async () => {
  userS = await testUserId(TEST_USERS.s.email);
  userT = await testUserId(TEST_USERS.t.email);
  await withDb((c) =>
    c.query(
      // Named: the invite list and the voters show the profile name.
      `insert into public.profiles (id, display_name) values ($1,$3),($2,$4)
       on conflict (id) do update set display_name = excluded.display_name`,
      [userS, userT, TEST_USERS.s.firstName, TEST_USERS.t.firstName],
    ),
  );
  await wipe();
  await importGame("alpha", 1, 2, 4, 30);
  await importGame("beta", 2, 2, 6, 60);
  await importGame("gamma", 3, 5, 8, 90);
  await importGame("delta", 4, 1, 4, 45);
  await withDb(async (c) => {
    await c.query(
      `insert into public.library_items (user_id, game_id, status)
       values ($1,$2,'owned'),($1,$3,'owned'),($1,$4,'owned'),($5,$6,'owned')`,
      [userS, gameIds.alpha, gameIds.beta, gameIds.gamma, userT, gameIds.delta],
    );
    await c.query(
      `insert into public.friendships (user_a, user_b)
       values (least($1::text,$2::text), greatest($1::text,$2::text))`,
      [userS, userT],
    );
    // Sam's roster knows Tina: "Play this" pre-fills her once she accepted.
    // The link guard only lets a confirmed request set it: the same flag the RPC uses.
    await c.query("begin");
    await c.query("select set_config('amika.link_ok', '1', true)");
    await c.query(
      `insert into public.players (owner_id, name, linked_user_id) values ($1,'Tina',$2)`,
      [userS, userT],
    );
    await c.query("commit");
  });
});

test.afterAll(wipe);

const shortlist = (page: Page, name = "Shortlist") =>
  page.getByRole("region", { name });
/** The candidates only (the reason badges inside them are lists too). */
const candidates = (page: Page, name?: string) =>
  shortlist(page, name).getByRole("list").first().locator(":scope > li");

async function filterPlayers(page: Page, n: number, label = "players") {
  await page
    .getByRole("button", { name: `${n} ${label}`, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`players=${n}`));
}

const spinButton = (page: Page, prefix = "Spin from") =>
  page.getByRole("button", { name: new RegExp(`^${prefix}`) });

async function asFriend(browser: Browser) {
  const context = await browser.newContext({ storageState: STATE_FILE.t });
  return { context, page: await context.newPage() };
}

test("picker ranks and spins", async ({ page }) => {
  await page.goto("/en/nights");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Game night",
  );
  await filterPlayers(page, 4);

  const items = candidates(page);
  await expect(items).toHaveCount(2);
  await expect(shortlist(page)).toContainText(NAMES.alpha);
  await expect(shortlist(page)).toContainText(NAMES.beta);
  await expect(shortlist(page)).not.toContainText(NAMES.gamma);
  // Each candidate says why it is there.
  await expect(items.first()).toContainText("You have never played it");
  await expect(items.last()).toContainText("You have never played it");

  await expect(spinButton(page)).toHaveText("Spin from 2 games");
  await spinButton(page).click();
  const chosen = page.getByRole("region", { name: "Tonight you play" });
  await expect(
    chosen.getByRole("link", { name: "Let’s play", exact: true }),
  ).toBeVisible({ timeout: 5_000 });
  const text = (await chosen.innerText()).trim();
  expect(text.includes(NAMES.alpha) || text.includes(NAMES.beta)).toBe(true);
});

test("empty picker explains", async ({ page }) => {
  // 12 is not a preset chip: the URL still carries any count.
  await page.goto("/en/nights?players=12");
  await expect(
    page.getByRole("button", { name: "12 players", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("No game fits", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "No games fit, widen the filters" }),
  ).toBeDisabled();
});

test("plan, invite, friend votes and suggests", async ({ page, browser }) => {
  test.setTimeout(90_000); // several round trips plus the 10 s fallback poll
  await page.goto("/en/nights/new?players=4");
  await expect(candidates(page, "Let them vote")).toHaveCount(2);
  await page.getByLabel("Night title", { exact: true }).fill(NIGHT_TITLE);
  await page.getByRole("button", { name: "Save night" }).click();
  await page.waitForURL(/\/en\/nights\/[0-9a-f-]{36}$/);
  nightId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NIGHT_TITLE);
  await expect(page.getByTestId("night-game")).toHaveCount(2);

  await page.getByRole("button", { name: "Invite E2E Tina" }).click();
  await expect(page.getByText("Invited", { exact: true })).toBeVisible();

  // Tina sees the invitation in /friends, accepts and joins the night.
  const { context, page: t } = await asFriend(browser);
  await t.goto("/en/friends");
  const invite = t.getByTestId("night-invite");
  await expect(invite).toContainText(NIGHT_TITLE);
  await invite.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(t.getByTestId("night-invite")).toHaveCount(0);

  await t.goto(`/en/nights/${nightId}`);
  const vote = t.getByRole("button", { name: `Vote for ${NAMES.alpha}` });
  await vote.click();
  await expect(vote).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      withDb(
        async (c) =>
          (
            await c.query(
              `select count(*)::int n from public.game_night_votes v
                 join public.game_night_games g on g.id = v.night_game_id
                where g.night_id = $1 and v.user_id = $2`,
              [nightId, userT],
            )
          ).rows[0].n,
      ),
    )
    .toBe(1);

  // She suggests a game of her own library.
  await t.getByRole("combobox", { name: "Choose a game" }).click();
  await t.getByRole("option", { name: NAMES.delta }).click();
  const suggested = t
    .getByTestId("night-game")
    .filter({ hasText: NAMES.delta });
  await expect(suggested).toBeVisible();
  await expect(suggested).toContainText("Suggested");
  await context.close();

  // The host sees the vote and the suggestion (poll or reload, never a fixed sleep).
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByTestId("night-game").filter({ hasText: NAMES.alpha }),
    ).toContainText("E2E Tina", { timeout: 2_000 });
    await expect(page.getByTestId("night-game")).toHaveCount(3, {
      timeout: 2_000,
    });
  }).toPass(SEEN_SOON);
});

test("guest link votes without account", async ({ page, browser }) => {
  test.setTimeout(90_000); // the host sees the guest on the next 10 s poll
  await page.goto(`/en/nights/${nightId}`);
  await page.getByRole("button", { name: "Create link", exact: true }).click();
  const field = page.getByLabel("Public link of the night");
  await expect(field).toBeVisible();
  guestUrl = await field.inputValue();
  expect(guestUrl).toMatch(/\/en\/n\/[^/]+$/);

  // No storageState: a visitor without an account.
  const visitor = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const g = await visitor.newPage();
  await g.goto(guestUrl);
  await expect(g.getByRole("heading", { level: 1 })).toHaveText(NIGHT_TITLE);
  await g.getByLabel("Your name", { exact: true }).fill("Gus");
  await g.getByRole("button", { name: "Join", exact: true }).click();
  await expect(g.getByText("You vote as Gus")).toBeVisible();
  const vote = g.getByRole("button", { name: `Vote for ${NAMES.beta}` });
  await vote.click();
  await expect(vote).toHaveAttribute("aria-pressed", "true");
  await visitor.close();

  // The host sees the guest's name within one polling cycle.
  await expect(
    page.getByTestId("night-game").filter({ hasText: NAMES.beta }),
  ).toContainText("Gus", SEEN_SOON);
});

for (const scheme of ["light", "dark"] as const) {
  test(`nights pages have no axe violations (${scheme})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: STATE_FILE.s,
      colorScheme: scheme,
    });
    const page = await context.newPage();
    for (const path of [`/en/nights`, `/en/nights/${nightId}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path.endsWith(nightId)) {
        // Let the votes load so rows with voters are checked too.
        await expect(page.getByTestId("night-game").first()).toBeVisible();
      }
      const results = await new AxeBuilder({ page })
        .withTags(AXE_TAGS)
        .analyze();
      expect(results.violations, `${path} (${scheme})`).toEqual([]);
    }
    await context.close();

    // The friend's view of the night (suggest-a-game combobox) is checked too.
    const friend = await browser.newContext({
      storageState: STATE_FILE.t,
      colorScheme: scheme,
    });
    const t = await friend.newPage();
    await t.goto(`/en/nights/${nightId}`);
    await expect(t.getByTestId("night-game").first()).toBeVisible();
    const friendResults = await new AxeBuilder({ page: t })
      .withTags(AXE_TAGS)
      .analyze();
    expect(friendResults.violations, `friend view (${scheme})`).toEqual([]);
    await friend.close();

    const visitor = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      colorScheme: scheme,
    });
    const g = await visitor.newPage();
    await g.goto(guestUrl);
    await expect(g.getByRole("heading", { level: 1 })).toHaveText(NIGHT_TITLE);
    const results = await new AxeBuilder({ page: g })
      .withTags(AXE_TAGS)
      .analyze();
    expect(results.violations, `guest page (${scheme})`).toEqual([]);
    await visitor.close();
  });
}

test("the guest page fits a phone", async ({ browser }) => {
  const visitor = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  const g = await visitor.newPage();
  await g.goto(guestUrl);
  await expect(g.getByRole("heading", { level: 1 })).toHaveText(NIGHT_TITLE);
  await g.getByLabel("Your name", { exact: true }).fill("Mobi");
  await g.getByRole("button", { name: "Join", exact: true }).click();
  const vote = g.getByRole("button", { name: `Vote for ${NAMES.alpha}` });
  await expect(vote).toBeVisible();
  const box = await vote.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  const overflow = await g.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await visitor.close();
});

test("revoked link shows inactive", async ({ page, browser }) => {
  await page.goto(`/en/nights/${nightId}`);
  await page.getByRole("button", { name: "Revoke link", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create link", exact: true }),
  ).toBeVisible();

  const visitor = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const g = await visitor.newPage();
  await g.goto(guestUrl);
  await expect(g.getByText("This link is no longer active")).toBeVisible();
  await visitor.close();
});

test("play this pre-fills players", async ({ page }) => {
  await page.goto(`/en/nights/${nightId}`);
  await page
    .getByRole("button", { name: `More actions for ${NAMES.alpha}` })
    .click();
  await page.getByRole("menuitem", { name: "Play this", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/en/games/${gameIds.alpha}/plays/new\\?night=${nightId}`),
  );
  // Tina accepted and is linked to a roster player, so she already has a row.
  await expect(
    page
      .getByRole("combobox", { name: /^Name of player \d/ })
      .filter({ hasText: "Tina" }),
  ).toBeVisible();
});

test("the night works in Spanish and Portuguese", async ({ page }) => {
  await page.goto("/es/nights");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Noche de juegos",
  );
  await filterPlayers(page, 4, "jugadores");
  await expect(candidates(page, "Lista corta")).toHaveCount(2);
  await spinButton(page, "Girar entre").click();
  await expect(
    page.getByRole("region", { name: "Esta noche jugáis a" }),
  ).toBeVisible({ timeout: 5_000 });

  await page.goto("/pt/nights");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Noite de jogos",
  );
  await filterPlayers(page, 4, "jogadores");
  await expect(candidates(page, "Lista curta")).toHaveCount(2);

  // The public page speaks the language of its link.
  const visitor = await page
    .context()
    .browser()!
    .newContext({
      storageState: { cookies: [], origins: [] },
    });
  const g = await visitor.newPage();
  await g.goto(guestUrl.replace("/en/n/", "/es/n/"));
  await expect(g.getByText("Este enlace ya no está activo")).toBeVisible();
  await visitor.close();
});
