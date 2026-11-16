import { createClerkClient } from "@clerk/backend";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { dbUrl, hasDb } from "../integration/db";

export const hasClerkKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY;
export const canRunAppTests = hasClerkKeys && hasDb;

/** `+clerk_test` addresses never send real email on Clerk dev instances. */
export const TEST_USERS = {
  a: { email: "bglib-e2e-a+clerk_test@example.com", firstName: "E2E Alice" },
  b: { email: "bglib-e2e-b+clerk_test@example.com", firstName: "E2E Bob" },
  // Creates games/photos in app-games.spec.ts, so it must not be shared.
  c: { email: "bglib-e2e-c+clerk_test@example.com", firstName: "E2E Carol" },
  // Library flows (app-library.spec.ts).
  d: { email: "bglib-e2e-d+clerk_test@example.com", firstName: "E2E Dave" },
  // Game Center flows (app-game-center.spec.ts): an administrator and a regular user.
  e: { email: "bglib-e2e-e+clerk_test@example.com", firstName: "E2E Erin" },
  f: { email: "bglib-e2e-f+clerk_test@example.com", firstName: "E2E Frank" },
  // Score sheets (app-scoring-sheets.spec.ts).
  g: { email: "bglib-e2e-g+clerk_test@example.com", firstName: "E2E Grace" },
  // Matches (app-plays.spec.ts).
  h: { email: "bglib-e2e-h+clerk_test@example.com", firstName: "E2E Heidi" },
} as const;

export const STATE_FILE = {
  a: "playwright/.clerk/user-a.json",
  b: "playwright/.clerk/user-b.json",
  c: "playwright/.clerk/user-c.json",
  d: "playwright/.clerk/user-d.json",
  e: "playwright/.clerk/user-e.json",
  f: "playwright/.clerk/user-f.json",
  g: "playwright/.clerk/user-g.json",
  h: "playwright/.clerk/user-h.json",
} as const;

function clerk() {
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
}

/** Creates the test user once; refuses to touch a real (non-test) user. */
export async function ensureTestUser(email: string, firstName: string) {
  const { data } = await clerk().users.getUserList({ emailAddress: [email] });
  if (data.length > 0) {
    if (data[0].privateMetadata.e2eTestUser !== true) {
      throw new Error(`${email} belongs to a user that is not a test user`);
    }
    return data[0].id;
  }
  const user = await clerk().users.createUser({
    emailAddress: [email],
    firstName,
    skipPasswordRequirement: true,
    privateMetadata: { e2eTestUser: true },
  });
  return user.id;
}

export async function testUserId(email: string): Promise<string> {
  const { data } = await clerk().users.getUserList({ emailAddress: [email] });
  if (data.length === 0) throw new Error(`test user ${email} does not exist`);
  return data[0].id;
}

/** Privileged DB access (bypasses RLS) to assert on persisted state. */
export async function withDb<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: dbUrl! });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export type ProfileRow = { id: string; theme: string; locale: string };

export function getProfile(userId: string) {
  return withDb(async (c) => {
    const { rows } = await c.query<ProfileRow>(
      "select id, theme, locale from public.profiles where id = $1",
      [userId],
    );
    return rows[0] ?? null;
  });
}

// --- catalog fixtures and cleanup (Phase 2) ---------------------------------

/** Marks fixtures so cleanup can never touch anything else. */
export const E2E_EXTERNAL_PREFIX = "9900"; // BGG-style numeric ids reserved for tests

/** A global game as if it had been imported from BGG (goes through the real DB function). */
export async function insertImportedGame(
  client: Client,
  payload: Record<string, unknown>,
) {
  const { rows } = await client.query<{ id: string }>(
    "select public.upsert_external_game($1::jsonb) as id",
    [JSON.stringify(payload)],
  );
  return rows[0].id;
}

/** Removes every E2E fixture game (global ones by reserved id, custom ones by owner). */
export async function cleanupCatalogFixtures(
  ownerIds: string[],
  externalPrefix: string = E2E_EXTERNAL_PREFIX,
) {
  await withDb(async (c) => {
    await c.query(
      `delete from public.games where id in (
         select game_id from public.game_external_ids
         where source = 'bgg' and external_id like $1)`,
      [`${externalPrefix}%`],
    );
    await c.query(
      "delete from public.terms where source = 'bgg' and external_id like $1",
      [`${externalPrefix}%`],
    );
    if (ownerIds.length > 0) {
      await c.query("delete from public.games where owner_id = any($1)", [
        ownerIds,
      ]);
    }
  });
  for (const owner of ownerIds) await removeUserPhotos(owner);
}

function adminStorage() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  ).storage.from("game-photos");
}

/** Every file path under a user's folder (Storage listing is not recursive). */
export async function listUserPhotoPaths(userId: string): Promise<string[]> {
  const bucket = adminStorage();
  const walk = async (prefix: string): Promise<string[]> => {
    const { data } = await bucket.list(prefix, { limit: 1000 });
    const paths: string[] = [];
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) paths.push(path);
      else paths.push(...(await walk(path)));
    }
    return paths;
  };
  return walk(userId);
}

export async function removeUserPhotos(userId: string) {
  const paths = await listUserPhotoPaths(userId);
  if (paths.length > 0) await adminStorage().remove(paths);
}
