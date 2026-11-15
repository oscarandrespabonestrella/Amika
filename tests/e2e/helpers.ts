import { createClerkClient } from "@clerk/backend";
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
} as const;

export const STATE_FILE = {
  a: "playwright/.clerk/user-a.json",
  b: "playwright/.clerk/user-b.json",
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
