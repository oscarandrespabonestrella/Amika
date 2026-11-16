/**
 * Hashes the cover of every catalog game that does not have a cover hash yet (games
 * imported before Phase 7a, or whose hashing failed). Idempotent; fetches at most 5
 * covers per second; only HASHES are stored, never the images.
 *
 *   npm run recognition:backfill            # dry run: only counts
 *   npm run recognition:backfill -- --yes   # do it
 *
 * Needs SUPABASE_DB_PASSWORD (.env.local) and a linked project
 * (supabase/.temp/pooler-url). Nothing secret is printed.
 */
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import { hashCover } from "../src/features/recognition/cover-hash.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const apply = process.argv.includes("--yes");
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password || !existsSync("supabase/.temp/pooler-url")) {
  console.error(
    "Needs SUPABASE_DB_PASSWORD in .env.local and `supabase link` (pooler-url).",
  );
  process.exit(2);
}
const url = new URL(readFileSync("supabase/.temp/pooler-url", "utf8").trim());
url.password = password;

const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  const { rows } = await client.query<{ id: string; cover_url: string }>(
    `select g.id, g.cover_url
       from public.games g
      where g.cover_url is not null
        and not exists (
          select 1 from public.game_image_hashes h
           where h.game_id = g.id and h.source = 'cover')
      order by g.id`,
  );
  console.log(`${rows.length} game(s) without a cover hash.`);
  if (!apply) {
    console.log("Dry run. Add --yes to hash them.");
  } else {
    let done = 0;
    let failed = 0;
    for (const row of rows) {
      const hash = await hashCover(row.cover_url);
      if (hash) {
        await client.query("select public.upsert_cover_hash($1, $2)", [
          row.id,
          hash,
        ]);
        done++;
      } else {
        failed++;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    console.log(`Hashed ${done}, could not hash ${failed}.`);
  }
} finally {
  await client.end();
}
