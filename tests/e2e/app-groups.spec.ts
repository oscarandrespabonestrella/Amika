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
let gameId: string;

const wipe = async () => {
  await cleanupCatalogFixtures([userR], PREFIX);
  await withDb(async (c) => {
    await c.query(`delete from public.player_groups where owner_id = $1`, [
      userR,
    ]);
    await c.query(`delete from public.players where owner_id = $1`, [userR]);
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

test("create a group and choose its players", async ({ page }) => {
  await page.goto("/en/groups");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My groups");
  await page.getByLabel("New group").fill("Jueves");
  await page.getByRole("button", { name: "Create group" }).click();

  const item = groupItem(page, "Jueves");
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Choose players" }).click();
  await item.getByLabel("Ana", { exact: true }).check();
  await item.getByLabel("Bo", { exact: true }).check();
  await item.getByRole("button", { name: "Save", exact: true }).click();

  await expect(item.getByText("Ana, Bo")).toBeVisible();
  await expect(item.getByText("2 players")).toBeVisible();
  expect(await memberNames("Jueves")).toEqual(["Ana", "Bo"]);
});

test("a duplicate group name is refused", async ({ page }) => {
  await page.goto("/en/groups");
  await page.getByLabel("New group").fill("jueves ");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(
    page.getByText("You already have a group with that name."),
  ).toBeVisible();
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
  const item = groupItem(page, "Jueves");
  await item.getByRole("button", { name: "Rename" }).click();
  await item.getByLabel("New name for Jueves").fill("Familia");
  await item.getByRole("button", { name: "Save", exact: true }).click();
  await expect(groupItem(page, "Familia")).toBeVisible();

  const renamed = groupItem(page, "Familia");
  await renamed.getByRole("button", { name: "Delete" }).click();
  await renamed.getByRole("button", { name: "Yes, delete" }).click();
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
  await expect(
    groupItem(page, "Huérfano").getByText("No players", { exact: true }),
  ).toBeVisible();
});
