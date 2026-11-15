#!/usr/bin/env node
/**
 * Grants (or revokes) the administrator role to a Clerk user, by e-mail.
 *
 *   node scripts/grant-admin.mjs you@example.com            # grant
 *   node scripts/grant-admin.mjs you@example.com --revoke   # revoke
 *
 * Safety: the e-mail address must be VERIFIED in Clerk, otherwise anyone could
 * claim an address they do not own. Needs CLERK_SECRET_KEY, SUPABASE_DB_PASSWORD
 * (.env.local) and a linked Supabase project (supabase/.temp/pooler-url).
 * Nothing secret is printed.
 */
import { createClerkClient } from "@clerk/backend";
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const email = process.argv[2]?.trim().toLowerCase();
const revoke = process.argv.includes("--revoke");
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/grant-admin.mjs <email> [--revoke]");
  process.exit(2);
}
for (const name of ["CLERK_SECRET_KEY", "SUPABASE_DB_PASSWORD"]) {
  if (!process.env[name]) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(2);
  }
}
if (!existsSync("supabase/.temp/pooler-url")) {
  console.error(
    "Run `supabase link` first (supabase/.temp/pooler-url not found).",
  );
  process.exit(2);
}

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const { data: users } = await clerk.users.getUserList({
  emailAddress: [email],
});

const match = users.find((user) =>
  user.emailAddresses.some(
    (address) =>
      address.emailAddress.toLowerCase() === email &&
      address.verification?.status === "verified",
  ),
);
if (!match) {
  console.error(
    users.length === 0
      ? `No Clerk user with ${email}. Sign up / sign in to the app once with that address first.`
      : `${email} exists in Clerk but is NOT verified: refusing to change roles.`,
  );
  process.exit(1);
}
if (match.privateMetadata?.e2eTestUser === true) {
  console.error("That is an automated-test user: refusing.");
  process.exit(1);
}

const url = new URL(readFileSync("supabase/.temp/pooler-url", "utf8").trim());
url.password = process.env.SUPABASE_DB_PASSWORD;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  if (revoke) {
    const { rowCount } = await db.query(
      "delete from public.user_roles where user_id = $1 and role = 'admin'",
      [match.id],
    );
    console.log(
      rowCount
        ? `Administrator role revoked from ${email}.`
        : `${email} was not an administrator.`,
    );
  } else {
    // The role references profiles(id): make sure the row exists (idempotent).
    await db.query(
      "insert into public.profiles (id) values ($1) on conflict do nothing",
      [match.id],
    );
    const { rowCount } = await db.query(
      "insert into public.user_roles (user_id, role) values ($1, 'admin') on conflict do nothing",
      [match.id],
    );
    console.log(
      rowCount
        ? `${email} is now an administrator.`
        : `${email} was already an administrator.`,
    );
  }
} finally {
  await db.end();
}
