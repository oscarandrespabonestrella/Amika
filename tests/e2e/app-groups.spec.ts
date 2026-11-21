import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
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
test.use({ storageState: STATE_FILE.r });
test.describe.configure({ mode: "serial" });

// Own reserved id range (9912) and own user: the roster is wiped around the file.
const PREFIX = "9912";
const GAME_NAME = "Groups Game E2E";

let userR: string;
// A friend who never signs in here: only a profile row and the friendship.
const FRIEND_ID = "e2e_groups_friend_9912";
let gameId: string;

const wipe = async () => {
  await cleanupCatalogFixtures([userR], PREFIX);
  await withDb(async (c) => {
    await c.query(`delete from public.player_groups where owner_id = $1`, [
      userR,
    ]);
    await c.query(`delete from public.players where owner_id = $1`, [userR]);
    await c.query(`delete from public.profiles where id = $1`, [FRIEND_ID]);
  });
};

test.beforeAll(async () => {
  userR = await testUserId(TEST_USERS.r.email);
  await withDb((c) =>
    c.query(
      `insert into public.profiles (id) values ($1) on conflict do nothing`,
      [userR],
    ),
  );
  await wipe();
  await withDb(async (c) => {
    await c.query(
      `insert into public.players (owner_id, name) values ($1,'Ana'),($1,'Bo'),($1,'Cy')`,
      [userR],
    );
    gameId = await insertImportedGame(c, {
      source: "bgg",
      externalId: `${PREFIX}01`,
      language: "en",
      kind: "base",
      name: GAME_NAME,
      description: "Fixture",
      yearPublished: 2012,
      minPlayers: 2,
      maxPlayers: 6,
      minPlaytime: 30,
      maxPlaytime: 60,
      minAge: 8,
      coverUrl: null,
      terms: [],
      relations: [],
    });
  });
});

test.afterAll(wipe);

const groupItem = (page: Page, name: string) =>
  page
    .getByRole("list", { name: "Your groups" })
    .getByRole("listitem")
    .filter({ has: page.getByText(name, { exact: true }) });

const memberNames = (group: string) =>
  withDb(async (c) =>
    (
      await c.query<{ name: string }>(
        `select p.name from public.player_group_members m
           join public.player_groups g on g.id = m.group_id
           join public.players p on p.id = m.player_id
          where g.owner_id = $1 and g.name = $2 order by p.name`,
        [userR, group],
      )
    ).rows.map((r) => r.name),
  );

const playerCombobox = (page: Page, n: number) =>
  page
    .getByRole("group", { name: `Player ${n}` })
    .getByRole("combobox", { name: new RegExp(`^Name of player ${n}\\b`) });

const openNewGroup = async (page: Page) => {
  await page.getByRole("button", { name: "New group", exact: true }).click();
  return page.getByRole("dialog", { name: "New group" });
};

test("create a group and choose its players", async ({ page }) => {
  await page.goto("/en/groups");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My groups");
  const sheet = await openNewGroup(page);
  await sheet.getByLabel("Name", { exact: true }).fill("Jueves");
  // The user is in every new group by default (here, as a player still to be marked "me").
  const me = sheet.getByRole("listitem").filter({ hasText: "You" });
  await expect(me.getByRole("checkbox")).toBeChecked();
  await expect(sheet.getByText("1 selected")).toBeVisible();
  await expect(sheet.getByText("Pick at least 2 players")).toBeVisible();
  // Unticked here, so the group matches the match-form tests below.
  await me.getByRole("checkbox").uncheck();
  await sheet.getByLabel("Ana", { exact: true }).check();
  await sheet.getByLabel("Bo", { exact: true }).check();
  await sheet.getByRole("button", { name: "Create group with 2" }).click();
  await expect(sheet).toBeHidden();

  const item = groupItem(page, "Jueves");
  await expect(item.getByText("Ana, Bo · 2 players")).toBeVisible();
  await expect(
    item.getByRole("link", { name: "Pick a game with Jueves" }),
  ).toHaveAttribute("href", /\/en\/nights\?groupId=/);
  expect(await memberNames("Jueves")).toEqual(["Ana", "Bo"]);
});

test("a duplicate group name is refused", async ({ page }) => {
  await page.goto("/en/groups");
  const sheet = await openNewGroup(page);
  await sheet.getByLabel("Name", { exact: true }).fill("jueves ");
  await sheet.getByLabel("Ana", { exact: true }).check();
  await sheet.getByRole("button", { name: "Create group with 2" }).click();
  await expect(
    sheet.getByText("You already have a group with that name."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("adding the group fills the match, keeps who is there and adds no duplicate", async ({
  page,
}) => {
  await page.goto(`/en/games/${gameId}/plays/new`);
  await pickPlayer(page, 1, "Ana");
  await page.getByRole("button", { name: "Add the group Jueves" }).click();

  await expect(playerCombobox(page, 1)).toContainText("Ana");
  await expect(playerCombobox(page, 2)).toContainText("Bo");
  await expect(page.getByRole("group", { name: "Player 3" })).toHaveCount(0);
});

test("the table can still be edited without touching the group", async ({
  page,
}) => {
  await page.goto(`/en/games/${gameId}/plays/new`);
  await pickPlayer(page, 1, "Cy");
  await page.getByRole("button", { name: "Add the group Jueves" }).click();
  // Cy was there, so the group fills the empty row and adds a third one.
  await expect(playerCombobox(page, 2)).toContainText("Ana");
  await expect(playerCombobox(page, 3)).toContainText("Bo");

  await page.getByRole("button", { name: "Remove player 3" }).click();
  await page.getByRole("button", { name: "Add player" }).click();
  await pickPlayer(page, 3, "Dee");
  await expect(playerCombobox(page, 3)).toContainText("Dee");

  expect(await memberNames("Jueves")).toEqual(["Ana", "Bo"]);
  await page.goto("/en/groups");
  await expect(groupItem(page, "Jueves").getByText("Ana, Bo")).toBeVisible();
});

test("renaming and deleting a group keeps the players", async ({ page }) => {
  await page.goto("/en/groups");
  await page.getByRole("button", { name: "Options for Jueves" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit Jueves" });
  await sheet.getByLabel("Name", { exact: true }).fill("Familia");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(groupItem(page, "Familia")).toBeVisible();

  await page.getByRole("button", { name: "Options for Familia" }).click();
  await page.getByRole("menuitem", { name: "Delete group" }).click();
  await groupItem(page, "Familia")
    .getByRole("button", { name: "Yes, delete" })
    .click();
  await expect(groupItem(page, "Familia")).toHaveCount(0);

  const roster = await withDb(async (c) =>
    (
      await c.query<{ name: string }>(
        `select name from public.players where owner_id = $1 order by name`,
        [userR],
      )
    ).rows.map((r) => r.name),
  );
  // "Dee" was only typed into an unsaved match: it never became a player.
  expect(roster).toEqual(["Ana", "Bo", "Cy"]);
});

test("the groups page has no accessibility violations", async ({ page }) => {
  await page.goto("/en/groups");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("groups stay reachable after the roster is emptied", async ({ page }) => {
  await withDb(async (c) => {
    await c.query(
      `insert into public.player_groups (owner_id, name) values ($1, 'Huérfano')`,
      [userR],
    );
    await c.query(`delete from public.players where owner_id = $1`, [userR]);
  });
  await page.goto("/en/groups");
  await expect(groupItem(page, "Huérfano")).toBeVisible();
  const item = groupItem(page, "Huérfano");
  await expect(item.getByText("No players in this group yet.")).toBeVisible();
  await expect(item.getByText(/fewer than 2 players/)).toBeVisible();
});

test("a group can be made from an empty roster by adding players by name", async ({
  page,
}) => {
  // The previous test emptied the roster.
  await page.goto("/en/groups");
  const sheet = await openNewGroup(page);
  await sheet.getByLabel("Name", { exact: true }).fill("Viernes");
  await expect(sheet.getByText("No other players yet")).toBeVisible();
  const search = sheet.getByLabel("Search or add a player");
  await search.fill("Eva");
  await sheet
    .getByRole("button", { name: "Add “Eva” as a new player" })
    .click();
  await expect(sheet.getByLabel("Eva", { exact: true })).toBeChecked();
  // The same name again picks the existing player instead of a duplicate.
  await search.fill(" eva");
  await search.press("Enter");
  await expect(search).toHaveValue("");
  await search.fill("Fede");
  await search.press("Enter");
  await expect(sheet.getByLabel("Fede", { exact: true })).toBeChecked();
  // With the user ticked by default: three players.
  await sheet.getByRole("button", { name: "Create group with 3" }).click();

  await expect(groupItem(page, "Viernes").getByText("3 players")).toBeVisible();
  // Saving created the user's own player and marked it "This is me".
  const meName = await withDb(async (c) =>
    (
      await c.query<{ name: string }>(
        `select name from public.players where owner_id = $1 and linked_user_id = $1`,
        [userR],
      )
    ).rows.map((r) => r.name),
  );
  expect(meName).toHaveLength(1);
  expect(await memberNames("Viernes")).toEqual(
    [...meName, "Eva", "Fede"].sort(),
  );
});

test("a friend can be added as a player straight into a group", async ({
  page,
}) => {
  await withDb(async (c) => {
    await c.query(
      `insert into public.profiles (id, display_name) values ($1, 'Gina')
       on conflict (id) do update set display_name = excluded.display_name`,
      [FRIEND_ID],
    );
    await c.query(
      `insert into public.friendships (user_a, user_b)
       values (least($1::text,$2::text), greatest($1::text,$2::text))
       on conflict do nothing`,
      [userR, FRIEND_ID],
    );
  });
  await page.goto("/en/groups");
  await page.getByRole("button", { name: "Options for Viernes" }).click();
  await page.getByRole("menuitem", { name: "Edit players" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit Viernes" });
  // Friends not yet in the roster are listed, tagged as friends.
  await sheet.getByLabel("Gina", { exact: true }).check();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();

  await expect(groupItem(page, "Viernes").getByText("4 players")).toBeVisible();
  expect(await memberNames("Viernes")).toEqual(
    expect.arrayContaining(["Eva", "Fede", "Gina"]),
  );
  // The friend is asked to confirm the link, as when linking from My players.
  const requests = await withDb(async (c) =>
    (
      await c.query<{ name: string }>(
        `select p.name from public.player_link_requests r
           join public.players p on p.id = r.player_id
          where r.owner_id = $1 and r.friend_id = $2 and r.status = 'pending'`,
        [userR, FRIEND_ID],
      )
    ).rows.map((r) => r.name),
  );
  expect(requests).toEqual(["Gina"]);

  // My players offers the same through its own control.
  await page.goto("/en/players");
  await expect(page.getByLabel("Add a friend as a player")).toBeVisible();
});

test("a friend with the same name as a player is listed once", async ({
  page,
}) => {
  // The previous test made a player "Gina" whose link to the friend Gina is still pending.
  await page.goto("/en/groups");
  const sheet = await openNewGroup(page);
  await sheet.getByLabel("Name", { exact: true }).fill("Sábado");
  const gina = sheet.getByLabel("Gina", { exact: true });
  await expect(gina).toHaveCount(1);
  await expect(
    sheet.getByRole("listitem").filter({ hasText: "Gina" }),
  ).toContainText("Friend");
  await gina.check();
  await sheet.getByRole("button", { name: "Create group with 2" }).click();
  await expect(sheet).toBeHidden();

  const ginas = await withDb(
    async (c) =>
      (
        await c.query<{ n: number }>(
          `select count(*)::int n from public.players where owner_id = $1 and name = 'Gina'`,
          [userR],
        )
      ).rows[0].n,
  );
  expect(ginas).toBe(1);
  expect(await memberNames("Sábado")).toEqual(expect.arrayContaining(["Gina"]));
});

test("the group sheet has no accessibility violations", async ({ page }) => {
  await page.goto("/en/groups");
  await openNewGroup(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
