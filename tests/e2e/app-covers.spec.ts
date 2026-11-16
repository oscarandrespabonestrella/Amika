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
test.use({ storageState: STATE_FILE.o });
test.describe.configure({ mode: "serial" });

// Own reserved id range: 9900-9908 are taken (9908 recognition).
const PREFIX = "9909";
const RANDOM_UUID = "00000000-0000-4000-8000-00000000dead";

let userO: string;
let catalogGameId: string; // visible, but without a cover
let othersCustomGameId: string; // another user's private custom game WITH a cover URL

test.beforeAll(async () => {
  userO = await testUserId(TEST_USERS.o.email);
  const userA = await testUserId(TEST_USERS.a.email);
  await withDb((c) =>
    c.query(
      `insert into public.profiles (id) values ($1),($2) on conflict do nothing`,
      [userO, userA],
    ),
  );
  await cleanupCatalogFixtures([userO], PREFIX);
  await withDb(async (c) => {
    await c.query(
      `delete from public.games where owner_id = $1 and name = 'Cover Secret E2E'`,
      [userA],
    );
    catalogGameId = await insertImportedGame(c, {
      source: "bgg",
      externalId: `${PREFIX}01`,
      language: "en",
      kind: "base",
      name: "Cover Endpoint E2E",
      description: "Fixture",
      yearPublished: 2020,
      minPlayers: 1,
      maxPlayers: 4,
      minPlaytime: 20,
      maxPlaytime: 40,
      minAge: 8,
      coverUrl: null,
      terms: [],
      relations: [],
    });
    const { rows } = await c.query<{ id: string }>(
      `insert into public.games (name, source, kind, owner_id, cover_url)
       values ('Cover Secret E2E','manual','base',$1,'https://cf.geekdo-images.com/secret/pic.jpg')
       returning id`,
      [userA],
    );
    othersCustomGameId = rows[0].id;
  });
});

test.afterAll(async () => {
  await cleanupCatalogFixtures([userO], PREFIX);
  await withDb((c) =>
    c.query(`delete from public.games where id = $1`, [othersCustomGameId]),
  );
});

test("signed out: 401, whatever the id", async ({ browser }) => {
  // Explicitly empty: a new context would otherwise inherit the signed-in state.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  for (const id of [catalogGameId, "not-a-uuid"]) {
    const res = await context.request.get(`/api/covers/${id}`, {
      maxRedirects: 0,
    });
    expect(res.status(), id).toBe(401);
    expect(res.headers()["content-type"] ?? "").not.toContain("image/");
  }
  await context.close();
});

test("a malformed id, an unknown game and a game without a cover are the same 404", async ({
  request,
}) => {
  for (const id of ["not-a-uuid", "123", RANDOM_UUID, catalogGameId]) {
    const res = await request.get(`/api/covers/${id}`);
    expect(res.status(), id).toBe(404);
    expect(await res.text(), id).toBe("");
  }
});

test("another user's private game is indistinguishable from a game that does not exist", async ({
  request,
}) => {
  const secret = await request.get(`/api/covers/${othersCustomGameId}`);
  const missing = await request.get(`/api/covers/${RANDOM_UUID}`);
  expect(secret.status()).toBe(404);
  expect(secret.status()).toBe(missing.status());
  expect(await secret.text()).toBe(await missing.text());
  expect(secret.headers()["content-type"]).toBe(
    missing.headers()["content-type"],
  );
});
