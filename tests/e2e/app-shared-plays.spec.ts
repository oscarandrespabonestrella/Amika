import { expect, test } from "@playwright/test";
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
test.use({ storageState: STATE_FILE.p });
test.describe.configure({ mode: "serial" });

// Own reserved id range (after 9906 roster): 9907 friends and shared live matches.
const PREFIX = "9907";
const GAME_NAME = "Shared Match Game E2E";
const SEEN_SOON = { timeout: 20_000 }; // Realtime, or the 10 s fallback read

let userP: string; // owner
let userQ: string; // guest
let gameId: string;
let playId: string;

const wipe = async () => {
  await withDb(async (c) => {
    await c.query(
      `delete from public.friend_invites where created_by = any($1)`,
      [[userP, userQ]],
    );
    await c.query(
      `delete from public.friendships where user_a = any($1) or user_b = any($1)`,
      [[userP, userQ]],
    );
    await c.query(`delete from public.plays where owner_id = any($1)`, [
      [userP, userQ],
    ]);
    await c.query(`delete from public.players where owner_id = any($1)`, [
      [userP, userQ],
    ]);
  });
  await cleanupCatalogFixtures([userP, userQ], PREFIX);
};

test.beforeAll(async () => {
  userP = await testUserId(TEST_USERS.p.email);
  userQ = await testUserId(TEST_USERS.q.email);
  await withDb((c) =>
    c.query(
      `insert into public.profiles (id, display_name) values ($1,$3),($2,$4)
       on conflict (id) do update set display_name = excluded.display_name`,
      [userP, userQ, TEST_USERS.p.firstName, TEST_USERS.q.firstName],
    ),
  );
  await wipe();
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
      relations: [],
    });
    // A sheet with one numeric category, and an OPEN match between two named seats.
    const sheet = await c.query<{ id: string }>(
      `insert into public.scoring_sheets (game_id, owner_id, title, locale)
       values ($1,$2,'Shared sheet','en') returning id`,
      [gameId, userP],
    );
    const version = await c.query<{ id: string }>(
      `insert into public.scoring_sheet_versions (sheet_id, version, definition)
       values ($1,1,$2::jsonb) returning id`,
      [
        sheet.rows[0].id,
        JSON.stringify({
          schemaVersion: 1,
          categories: [
            { key: "points", label: "Points", type: "number", scoring: true },
          ],
        }),
      ],
    );
    const play = await c.query<{ id: string }>(
      `insert into public.plays (created_by, owner_id, game_id, played_on, scoring_version_id, status)
       values ($1,$1,$2,current_date,$3,'open') returning id`,
      [userP, gameId, version.rows[0].id],
    );
    playId = play.rows[0].id;
    const players = await c.query<{ id: string; name: string }>(
      `insert into public.players (owner_id, name) values ($1,'Pablo'),($1,'Quinn') returning id, name`,
      [userP],
    );
    for (const [seat, name] of ["Pablo", "Quinn"].entries()) {
      await c.query(
        `insert into public.play_participants (play_id, seat, player_id) values ($1,$2,$3)`,
        [playId, seat, players.rows.find((p) => p.name === name)!.id],
      );
    }
  });
});

test.afterAll(wipe);

test("two users become friends through a one-use link", async ({
  page,
  browser,
}) => {
  await page.goto("/en/friends");
  await page.getByRole("button", { name: "Create a link" }).click();
  const link = await page.getByTestId("friend-link").inputValue();
  expect(link).toMatch(/\/en\/friends\/join\/[0-9a-f]{64}$/);

  const guest = await browser.newContext({ storageState: STATE_FILE.q });
  const q = await guest.newPage();
  await q.goto(link);
  // Opening the link alone does not make the friendship: it is a click.
  const before = await withDb(
    async (c) =>
      (
        await c.query(
          `select count(*)::int n from public.friendships where user_a = any($1) and user_b = any($1)`,
          [[userP, userQ]],
        )
      ).rows[0].n,
  );
  expect(before).toBe(0);
  await q.getByRole("button", { name: "Accept invitation" }).click();
  await expect(q.getByTestId("friend")).toContainText("E2E Pablo");

  // The link is spent: a second use is refused.
  await q.goto(link);
  await q.getByRole("button", { name: "Accept invitation" }).click();
  await expect(q.getByText(/not valid, was already used/)).toBeVisible();
  await guest.close();

  await page.reload();
  await expect(page.getByTestId("friend")).toContainText("E2E Quinn");
});

test("invite, accept, write your own column and watch it live", async ({
  page,
  browser,
}) => {
  // The owner invites Quinn's seat.
  await page.goto(`/en/games/${gameId}/plays/${playId}/live`);
  await expect(page.getByTestId("live-status")).toHaveText("Open");
  await page.getByTestId("invite-seat").selectOption({ label: "Quinn" });
  await page.getByTestId("invite-friend").selectOption({ label: "E2E Quinn" });
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent")).toBeVisible();

  const guest = await browser.newContext({ storageState: STATE_FILE.q });
  const q = await guest.newPage();

  // Before accepting, Quinn sees the invitation and nothing of the match.
  const before = await q.goto(`/en/games/${gameId}/plays/${playId}/live`);
  expect(before?.status()).toBe(404);
  await q.goto("/en/friends");
  await expect(q.getByTestId("play-invite")).toContainText(GAME_NAME);
  await q.getByRole("button", { name: "Accept" }).click();
  await expect(q.getByTestId("play-invite")).toHaveCount(0);

  // After accepting: the match, with an editable column only for Quinn.
  await q.goto(`/en/games/${gameId}/plays/${playId}/live`);
  const mine = q.getByTestId("live-column").filter({ hasText: "Quinn" });
  await expect(mine).toHaveAttribute("data-mine", "true");
  await expect(
    q
      .getByTestId("live-column")
      .filter({ hasText: "Pablo" })
      .getByLabel("Points"),
  ).toHaveCount(0); // someone else's column is not editable
  await mine.getByLabel("Points").fill("7");
  await q.getByRole("button", { name: "Save my points" }).click();
  await expect(q.getByText("Saved")).toBeVisible();

  // The owner sees Quinn's points without reloading.
  await expect(
    page
      .getByTestId("live-column")
      .filter({ hasText: "Quinn" })
      .getByTestId("live-total"),
  ).toContainText("7", SEEN_SOON);

  // The owner closes the match: totals are fixed and Quinn can no longer edit.
  await page.getByRole("button", { name: "Close match" }).click();
  await page.getByRole("button", { name: "Yes, close" }).click();
  await expect(page.getByTestId("live-status")).toHaveText("Closed", SEEN_SOON);
  await expect(q.getByTestId("live-status")).toHaveText("Closed", SEEN_SOON);
  await expect(q.getByRole("button", { name: "Save my points" })).toHaveCount(
    0,
  );
  const stored = await withDb(
    async (c) =>
      (
        await c.query(
          `select seat, total_score, rank, is_winner from public.play_participants
          where play_id = $1 and total_score is not null order by seat`,
          [playId],
        )
      ).rows,
  );
  expect(stored).toEqual([
    { seat: 1, total_score: 7, rank: 1, is_winner: true },
  ]);

  // A game Quinn does not own: the match appears under "played elsewhere".
  await q.goto("/en/plays/elsewhere");
  await expect(q.getByTestId("elsewhere-list")).toContainText(GAME_NAME);
  await guest.close();
});

test("a stranger cannot open the match", async ({ browser }) => {
  const stranger = await browser.newContext({ storageState: STATE_FILE.a });
  const s = await stranger.newPage();
  const response = await s.goto(`/en/games/${gameId}/plays/${playId}/live`);
  expect(response?.status()).toBe(404);
  await stranger.close();
});

test("deleting as owner passes the match to the other player", async ({
  page,
  browser,
}) => {
  const guest = await browser.newContext({ storageState: STATE_FILE.q });
  const q = await guest.newPage();
  await page.goto(`/en/games/${gameId}/plays/${playId}`);
  await page.getByRole("button", { name: "Delete match" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await page.waitForURL(new RegExp(`/en/games/${gameId}$`));

  const owner = await withDb(
    async (c) =>
      (
        await c.query(`select owner_id from public.plays where id = $1`, [
          playId,
        ])
      ).rows[0]?.owner_id,
  );
  expect(owner).toBe(userQ);
  const response = await q.goto(`/en/games/${gameId}/plays/${playId}/live`);
  expect(response?.status()).toBe(200);
  await guest.close();
});
