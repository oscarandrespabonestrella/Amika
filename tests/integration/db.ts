import { existsSync, readFileSync } from "node:fs";
import { Client } from "pg";

/**
 * Connection to the Supabase *dev* database for RLS tests.
 * Needs SUPABASE_DB_PASSWORD (.env.local) and a linked project
 * (supabase/.temp/pooler-url, created by `supabase link`).
 */
function connectionString(): string | null {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const password = process.env.SUPABASE_DB_PASSWORD;
  const poolerFile = "supabase/.temp/pooler-url";
  if (!password || !existsSync(poolerFile)) return null;

  const url = new URL(readFileSync(poolerFile, "utf8").trim());
  url.password = password;
  return url.toString();
}

export const dbUrl = connectionString();
export const hasDb = dbUrl !== null;

type Claims = { sub: string } | null;

/**
 * Runs `fn` inside a transaction that is ALWAYS rolled back.
 * `fixtures` run as the privileged role (bypass RLS); then the session is
 * switched to `authenticated` (with Clerk-like JWT claims) or `anon`.
 */
export async function withRole<T>(
  role: "authenticated" | "anon",
  claims: Claims,
  fixtures: (c: Client) => Promise<void>,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: dbUrl! });
  await client.connect();
  try {
    await client.query("begin");
    await fixtures(client);
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      claims ? JSON.stringify({ ...claims, role }) : "",
    ]);
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

/** Postgres error code of a rejected query (e.g. 42501 = RLS / permission denied). */
export async function pgErrorCode(
  promise: Promise<unknown>,
): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}
