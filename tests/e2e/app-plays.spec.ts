import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { evaluate } from "../../src/features/scoring/engine/evaluate";
import { SEVEN_WONDERS } from "../../src/features/scoring/engine/fixtures";
import {
  canRunAppTests,
  cleanupCatalogFixtures,
  insertImportedGame,
  pickPlayer,
  STATE_FILE,
  TEST_USERS,
  testUserId,
  withDb,
} from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
test.use({ storageState: STATE_FILE.h });
test.describe.configure({ mode: "serial" });

// Own reserved id range: 9900 games, 9901 library, 9902 game center, 9903 scoring sheets.
const PREFIX = "9904";
const GAME_NAME = "Wonders Matches E2E";
const EXPANSION_NAME = "Wonders Expansion E2E";
const SHEET_TITLE = "Wonders sheet";
const SPARE_TITLE = "Spare sheet";
const MANUAL = "No sheet: enter totals";

let userH: string;
let gameId: string;
let versionId: string;

const gameFixture = (
  n: number,
  kind: string,
  name: string,
  relations: unknown[],
) => ({
  source: "bgg",
  externalId: `${PREFIX}0${n}`,
  language: "en",
  kind,
  name,
  description: "Fixture",
  yearPublished: 2010,
  minPlayers: 2,
  maxPlayers: 7,
  minPlaytime: 30,
  maxPlaytime: 30,
  minAge: 10,
  coverUrl: null,
  terms: [],
  relations,
});

test.beforeAll(async () => {
  userH = await testUserId(TEST_USERS.h.email);
  await cleanupCatalogFixtures([userH], PREFIX);
  await withDb(async (c) => {
    gameId = await insertImportedGame(
      c,
      gameFixture(1, "base", GAME_NAME, [
        {
          type: "has_expansion",
          externalId: `${PREFIX}02`,
          name: EXPANSION_NAME,
        },
      ]),
    );
    await insertImportedGame(
      c,
      gameFixture(2, "expansion", EXPANSION_NAME, []),
    );
    await c.query(
      `insert into public.profiles (id) values ($1) on conflict do nothing`,
      [userH],
    );
    for (const title of [SHEET_TITLE, SPARE_TITLE]) {
      const sheet = await c.query<{ id: string }>(
        `insert into public.scoring_sheets (game_id, owner_id, title, locale)
         values ($1,$2,$3,'en') returning id`,
        [gameId, userH, title],
      );
      const version = await c.query<{ id: string }>(
        `insert into public.scoring_sheet_versions (sheet_id, definition)
         values ($1,$2::jsonb) returning id`,
        [sheet.rows[0].id, JSON.stringify(SEVEN_WONDERS)],
      );
      if (title === SHEET_TITLE) versionId = version.rows[0].id;
    }
    // The main sheet is the most recently updated: it is the default choice.
    await c.query(
      `update public.scoring_sheets set updated_at = now() + interval '1 minute' where title = $1 and owner_id = $2`,
      [SHEET_TITLE, userH],
    );
  });
});

test.afterAll(async () => {
  await cleanupCatalogFixtures([userH], PREFIX);
});

type PlayRow = {
  id: string;
  played_on: string;
  duration_minutes: number | null;
  notes: string | null;
  scoring_version_id: string | null;
  people: {
    seat: number;
    name: string;
    total: number | null;
    rank: number | null;
    win: boolean;
  }[];
};
const plays = () =>
  withDb(async (c) => {
    const { rows } = await c.query<PlayRow>(
      `select p.id, p.played_on::text, p.duration_minutes, p.notes, p.scoring_version_id,
              (select json_agg(json_build_object('seat', pp.seat, 'name', pl.name,
                       'total', pp.total_score, 'rank', pp.rank, 'win', pp.is_winner) order by pp.seat)
                 from public.play_participants pp join public.players pl on pl.id = pp.player_id
                where pp.play_id = p.id) as people
         from public.plays p where p.created_by = $1 order by p.created_at`,
      [userH],
    );
    return rows;
  });

const player = (page: Page, n: number) =>
  page.getByRole("group", { name: `Player ${n}` });
const save = (page: Page) => page.getByRole("button", { name: "Save match" });
const panel = (page: Page) => page.getByRole("region", { name: "Matches" });

async function fillPlayer(
  page: Page,
  n: number,
  name: string,
  entries: Record<string, string> = {},
) {
  const group = player(page, n);
  await pickPlayer(page, n, name);
  for (const [label, value] of Object.entries(entries))
    await group.getByLabel(label, { exact: true }).fill(value);
}

const openNew = async (page: Page) => {
  await page.goto(`/en/games/${gameId}/plays/new`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Log a match" }),
  ).toBeVisible();
};
const saveAndReturn = async (page: Page) => {
  await save(page).click();
  await expect(page).toHaveURL(new RegExp(`/en/games/${gameId}$`));
};

test.describe("logging matches", () => {
  test("the game page starts with an empty matches section and a way in", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}`);
    await expect(panel(page).getByText("No matches yet").first()).toBeVisible();
    await panel(page).getByRole("link", { name: "Log a match" }).click();
    await expect(page).toHaveURL(/\/plays\/new$/);
  });

  test("with a sheet: live totals, ranks and the winner; the server stores its own numbers", async ({
    page,
  }) => {
    await openNew(page);
    // The sheet used last (or edited last) is preselected.
    await expect(page.getByLabel("Score sheet")).toHaveValue(/.+/);
    await page.getByLabel("Score sheet").selectOption({ label: SHEET_TITLE });

    await page.getByLabel("Date").fill("2026-11-14");
    await page.getByLabel("Duration in minutes (optional)").fill("90");
    await page.getByLabel("Notes (optional)").fill("  Close game  ");
    await page.getByLabel(EXPANSION_NAME).check();

    await fillPlayer(page, 1, "Ana", {
      Military: "6",
      "Coins (1 point per 3)": "10",
      Tablets: "3",
      Compass: "2",
      Gears: "1",
    });
    await fillPlayer(page, 2, "Bo", { Military: "12" });

    // 6 military + floor(10 / 3) coins + science (9 + 4 + 1 + 7)  = 30;  Bo = 12
    await expect(page.getByTestId("total-0")).toHaveText("30");
    await expect(page.getByTestId("total-1")).toHaveText("12");
    await expect(
      player(page, 1).getByText("Winner", { exact: true }),
    ).toBeVisible();
    await expect(player(page, 1).getByText("Rank 1")).toBeVisible();
    await expect(player(page, 2).getByText("Rank 2")).toBeVisible();
    await expect(
      player(page, 2).getByText("Winner", { exact: true }),
    ).toHaveCount(0);

    await saveAndReturn(page);
    await expect(panel(page).getByText("1 match")).toBeVisible();
    await expect(panel(page).getByText("Ana")).toBeVisible();

    const rows = await plays();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      played_on: "2026-11-14",
      duration_minutes: 90,
      notes: "Close game",
      scoring_version_id: versionId,
    });
    expect(rows[0].people).toEqual([
      { seat: 0, name: "Ana", total: 30, rank: 1, win: true },
      { seat: 1, name: "Bo", total: 12, rank: 2, win: false },
    ]);

    const expansions = await withDb((c) =>
      c.query(`select 1 from public.play_expansions where play_id = $1`, [
        rows[0].id,
      ]),
    );
    expect(expansions.rowCount).toBe(1);
  });

  test("stored totals are exactly what the engine computes from the stored scores", async () => {
    const rows = await withDb(async (c) => {
      const { rows: people } = await c.query<{
        id: string;
        total_score: number | null;
      }>(
        `select pp.id, pp.total_score from public.play_participants pp
           join public.plays p on p.id = pp.play_id
          where p.created_by = $1 and p.scoring_version_id is not null`,
        [userH],
      );
      const out: { stored: number | null; computed: number | null }[] = [];
      for (const person of people) {
        const { rows: scores } = await c.query<{
          category_key: string;
          value: unknown;
        }>(
          `select category_key, value from public.play_scores where participant_id = $1`,
          [person.id],
        );
        const values = Object.fromEntries(
          scores.map((s) => [s.category_key, s.value]),
        );
        out.push({
          stored: person.total_score,
          computed: scores.length
            ? evaluate(SEVEN_WONDERS, values as never).total
            : null,
        });
      }
      return out;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.stored).toBe(row.computed);
  });

  test("a tie gives every tied player rank 1 and the Winner badge", async ({
    page,
  }) => {
    await openNew(page);
    await fillPlayer(page, 1, "Cy", { Military: "5" });
    await fillPlayer(page, 2, "Di", { Military: "5" });
    await expect(
      player(page, 1).getByText("Winner", { exact: true }),
    ).toBeVisible();
    await expect(
      player(page, 2).getByText("Winner", { exact: true }),
    ).toBeVisible();
    await saveAndReturn(page);

    const last = (await plays()).at(-1)!;
    expect(last.people.map((p) => [p.rank, p.win])).toEqual([
      [1, true],
      [1, true],
    ]);
  });

  test("with no scores recorded nobody wins", async ({ page }) => {
    await openNew(page);
    await fillPlayer(page, 1, "Ed");
    await fillPlayer(page, 2, "Flo");
    await expect(page.getByTestId("total-0")).toHaveText("Nothing recorded");
    await expect(page.getByText("Winner", { exact: true })).toHaveCount(0);
    await saveAndReturn(page);

    const last = (await plays()).at(-1)!;
    expect(last.people.map((p) => [p.total, p.rank, p.win])).toEqual([
      [null, null, false],
      [null, null, false],
    ]);
  });

  test("without a sheet the totals are typed in by hand", async ({ page }) => {
    await openNew(page);
    await page.getByLabel("Score sheet").selectOption({ label: MANUAL });
    await fillPlayer(page, 1, "Gus", { "Total points": "40" });
    await fillPlayer(page, 2, "Hal", { "Total points": "25" });
    await expect(
      player(page, 1).getByText("Winner", { exact: true }),
    ).toBeVisible();
    await saveAndReturn(page);

    const last = (await plays()).at(-1)!;
    expect(last.scoring_version_id).toBeNull();
    expect(last.people.map((p) => [p.total, p.rank, p.win])).toEqual([
      [40, 1, true],
      [25, 2, false],
    ]);
    await expect(panel(page).getByText("Manual totals").first()).toBeVisible();
  });

  test("changing the sheet clears what was typed for the old one", async ({
    page,
  }) => {
    await openNew(page);
    await page.getByLabel("Score sheet").selectOption({ label: SHEET_TITLE });
    await fillPlayer(page, 1, "Ivy", { Military: "9" });
    await expect(page.getByTestId("total-0")).toHaveText("9");
    await page.getByLabel("Score sheet").selectOption({ label: MANUAL });
    await expect(page.getByTestId("total-0")).toHaveText("Nothing recorded");
    await page.getByLabel("Score sheet").selectOption({ label: SHEET_TITLE });
    await expect(
      player(page, 1).getByLabel("Military", { exact: true }),
    ).toHaveValue("");
  });
});

test.describe("players", () => {
  test("a match holds up to 12 players", async ({ page }) => {
    await openNew(page);
    const add = page.getByRole("button", { name: "Add player" });
    for (let i = 0; i < 10; i++) await add.click();
    await expect(page.getByRole("group", { name: /^Player \d+$/ })).toHaveCount(
      12,
    );
    await expect(add).toBeDisabled();
    await expect(
      page.getByText("A match can have up to 12 players."),
    ).toBeVisible();
  });

  test("typing in the player search key by key keeps the focus on the field", async ({
    page,
  }) => {
    await openNew(page);
    await player(page, 1).getByRole("combobox").click();
    const search = page.getByPlaceholder("Search or add a player…");
    await search.pressSequentially("Ana García 🐦");
    await expect(search).toHaveValue("Ana García 🐦");
    await expect(search).toBeFocused();
    await search.press("Enter");
    await expect(
      player(page, 1).getByRole("combobox", { name: /Ana García 🐦/ }),
    ).toBeVisible();
  });

  test("the server-rendered form is deterministic: no per-request ids and no server-side date", async ({
    page,
  }) => {
    const url = `/en/games/${gameId}/plays/new`;
    // page.request runs no JavaScript, so it cannot renew Clerk's 60 s session cookie: late in
    // a long run it would get a handshake page instead of the form. Visiting a page first
    // lets the browser renew it.
    await page.goto("/en/home");
    const first = await (await page.request.get(url)).text();
    const second = await (await page.request.get(url)).text();
    const ids = (html: string) =>
      [...html.matchAll(/id="((?:name|manual)-[^"]*)"/g)].map((m) => m[1]);
    // Ids that depend on how many forms the server rendered before would not match
    // what the browser computes when it hydrates.
    expect(ids(first).length).toBeGreaterThan(0);
    expect(ids(second)).toEqual(ids(first));

    // Today's date depends on the viewer's time zone: the server must not render one.
    const dateInput = /<input[^>]*id="play-date"[^>]*>/.exec(first)?.[0] ?? "";
    expect(dateInput).not.toBe("");
    expect(dateInput).not.toMatch(/value="\d{4}-\d{2}-\d{2}"/);
  });

  test("the date defaults to today once the page is live", async ({ page }) => {
    await openNew(page);
    const today = await page.evaluate(() => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    });
    await expect(page.getByLabel("Date")).toHaveValue(today);
  });

  test("a blank name explains itself once the field is left, and Save says why it is off", async ({
    page,
  }) => {
    await openNew(page);
    const name = player(page, 1).getByRole("combobox");
    await name.click();
    await page.keyboard.press("Escape"); // leave without choosing a player
    await expect(player(page, 1).getByText("Enter a name.")).toBeVisible();
    await expect(name).toHaveAccessibleDescription("Enter a name.");
    await expect(
      page.getByText("Fix the highlighted fields before saving."),
    ).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await pickPlayer(page, 1, "Lou");
    await expect(player(page, 1).getByText("Enter a name.")).toHaveCount(0);
  });

  test("a name is required: Save stays disabled until every player has one", async ({
    page,
  }) => {
    await openNew(page);
    await expect(save(page)).toBeDisabled();
    await fillPlayer(page, 1, "Jo");
    await expect(save(page)).toBeDisabled();
    await fillPlayer(page, 2, "Kim");
    await expect(save(page)).toBeEnabled();
    await player(page, 2)
      .getByRole("button", { name: "Remove player 2" })
      .click();
    await expect(save(page)).toBeEnabled();
  });

  test("markup in a name is shown as text, 61 characters are refused, padding is trimmed", async ({
    page,
  }) => {
    const hostile = "<img src=x onerror=window.__pwned=1>";
    await openNew(page);
    await fillPlayer(page, 1, hostile);
    await fillPlayer(page, 2, "   Padded   ");
    await saveAndReturn(page);
    await expect(panel(page).getByText(hostile).first()).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
    const last = (await plays()).at(-1)!;
    expect(last.people.map((p) => p.name)).toEqual([hostile, "Padded"]);

    await openNew(page);
    // 61 characters: the search is capped or, if forced, offers no "Add" item.
    await player(page, 1).getByRole("combobox").click();
    const search = page.getByPlaceholder("Search or add a player…");
    await search.fill("x".repeat(61));
    const typed = (await search.inputValue()).length;
    if (typed > 60)
      await expect(page.getByRole("option", { name: /^Add/ })).toHaveCount(0);
    else expect(typed).toBeLessThanOrEqual(60);
  });
});

test.describe("editing and deleting", () => {
  test("opening a match from the list: the sheet is locked and ranks recalculate", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}`);
    await panel(page).getByRole("link", { name: /Ana/ }).first().click();
    await expect(page).toHaveURL(/\/plays\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Match" }),
    ).toBeVisible();
    await expect(page.getByLabel("Score sheet")).toBeDisabled();
    await expect(save(page)).toBeDisabled(); // nothing changed yet
    await expect(
      player(page, 1).getByLabel("Military", { exact: true }),
    ).toHaveValue("6");

    await player(page, 2).getByLabel("Military", { exact: true }).fill("40");
    await expect(page.getByTestId("total-1")).toHaveText("40");
    await expect(
      player(page, 2).getByText("Winner", { exact: true }),
    ).toBeVisible();
    await expect(
      player(page, 1).getByText("Winner", { exact: true }),
    ).toHaveCount(0);
    await save(page).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(save(page)).toBeDisabled();

    const first = (await plays())[0];
    expect(first.scoring_version_id).toBe(versionId); // the stored sheet is unchanged
    expect(first.people).toEqual([
      { seat: 0, name: "Ana", total: 30, rank: 2, win: false },
      { seat: 1, name: "Bo", total: 40, rank: 1, win: true },
    ]);
    const expansions = await withDb((c) =>
      c.query(`select 1 from public.play_expansions where play_id = $1`, [
        first.id,
      ]),
    );
    expect(expansions.rowCount).toBe(1); // editing keeps the expansion
  });

  test("deleting asks for confirmation and can be cancelled", async ({
    page,
  }) => {
    const before = (await plays()).length;
    const target = (await plays()).at(-1)!;
    await page.goto(`/en/games/${gameId}/plays/${target.id}`);
    await page.getByRole("button", { name: "Delete match" }).click();
    await expect(page.getByText("Delete this match?")).toBeVisible();
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(
      page.getByRole("button", { name: "Delete match" }),
    ).toBeVisible();
    expect((await plays()).length).toBe(before);

    await page.getByRole("button", { name: "Delete match" }).click();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page).toHaveURL(new RegExp(`/en/games/${gameId}$`));
    expect((await plays()).length).toBe(before - 1);
  });
});

test.describe("sheets that are in use", () => {
  test("a sheet with matches cannot be deleted; an unused one can", async ({
    page,
  }) => {
    await page.goto(`/en/games/${gameId}/sheets`);
    const used = page.getByRole("listitem").filter({ hasText: SHEET_TITLE });
    await used.getByRole("button", { name: "Delete" }).click();
    await used.getByRole("button", { name: "Yes, delete" }).click();
    await expect(
      page.getByText("This sheet has matches, so it can't be deleted."),
    ).toBeVisible();
    await expect(used).toBeVisible();

    const spare = page.getByRole("listitem").filter({ hasText: SPARE_TITLE });
    await spare.getByRole("button", { name: "Delete" }).click();
    await spare.getByRole("button", { name: "Yes, delete" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: SPARE_TITLE }),
    ).toHaveCount(0);
  });
});

test.describe("privacy and translations", () => {
  test("another user sees no matches and cannot open one", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: STATE_FILE.b });
    const page = await context.newPage();
    await page.goto(`/en/games/${gameId}`);
    await expect(panel(page).getByText("No matches yet").first()).toBeVisible();
    const mine = (await plays())[0];
    const response = await page.goto(`/en/games/${gameId}/plays/${mine.id}`);
    expect(response?.status()).toBe(404);
    await context.close();
  });

  test("a match opened under another game is a 404", async ({ page }) => {
    const mine = (await plays())[0];
    const response = await page.goto(
      `/en/games/00000000-0000-4000-8000-000000000000/plays/${mine.id}`,
    );
    expect(response?.status()).toBe(404);
  });

  test("the panel and the form are translated (es, fr)", async ({ page }) => {
    await page.goto(`/es/games/${gameId}`);
    await expect(page.getByRole("region", { name: "Partidas" })).toBeVisible();
    await page.goto(`/es/games/${gameId}/plays/new`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Registrar una partida",
    );
    await page.goto(`/fr/games/${gameId}`);
    await expect(page.getByRole("region", { name: "Parties" })).toBeVisible();
    await page.goto(`/fr/games/${gameId}/plays/new`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Enregistrer une partie",
    );
  });
});

test.describe("accessibility and mobile", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`game page, new match and a saved match have no axe violations (${scheme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: STATE_FILE.h,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      const mine = (await plays())[0];
      for (const path of [
        `/en/games/${gameId}`,
        `/en/games/${gameId}/plays/new`,
        `/en/games/${gameId}/plays/${mine.id}`,
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (path.endsWith("/new")) {
          await page.getByLabel("Score sheet").selectOption({ label: MANUAL });
          await fillPlayer(page, 1, "Axe", { "Total points": "3" });
        }
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations, `${path} (${scheme})`).toEqual([]);
      }
      await context.close();
    });
  }

  test("the form fits a phone: no sideways scroll and big touch targets", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: STATE_FILE.h,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await openNew(page);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const control of [
      page.getByRole("button", { name: "Add player" }),
      page.getByRole("button", { name: "Remove player 1" }),
      player(page, 1).getByRole("combobox"),
      page.getByLabel("Date"),
    ]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await context.close();
  });
});
