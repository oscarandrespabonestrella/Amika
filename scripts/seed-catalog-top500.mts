/**
 * Seeds the global catalog (public.games) with the BoardGameGeek top-500 games of the
 * reference pack, so they show up in "Games" and can be searched and filtered, in addition
 * to being recognized by the camera.
 *
 *   npm run catalog:seed-top500 -- [--limit 500] [--delay 1500] [--dry-run]
 *
 * Needs BGG_API_TOKEN, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Idempotent and resumable: a game already in the catalog (by BGG id) is skipped without
 * calling BGG, and a failure leaves that game for the next run. It writes with the same
 * validated path as the in-app import (externalGameSchema + upsert_external_game).
 * Sequential and throttled, as BGG asks (429 -> waits 30 s).
 */
import { existsSync, readFileSync } from "node:fs";
import { BggError } from "../src/features/catalog/sources/bgg/errors.ts";
import { createBggSource } from "../src/features/catalog/sources/bgg/client.ts";
import { externalGameSchema } from "../src/features/catalog/sources/external-game.schema.ts";
import { createSupabaseImportStore } from "../src/features/catalog/services/catalog-store.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const token = process.env.BGG_API_TOKEN;
if (!token) {
  console.error("Needs BGG_API_TOKEN in .env.local.");
  process.exit(2);
}
const limit = Number(flag("--limit") ?? 500);
const delay = Number(flag("--delay") ?? 1500);
const dryRun = args.includes("--dry-run");

const manifest = JSON.parse(
  readFileSync("src/features/recognition/pack/pack-manifest.json", "utf8"),
) as { games: { bggId: string; name: string; rank: number }[] };
const games = manifest.games.slice(0, limit);

const bgg = createBggSource({ token });
const store = createSupabaseImportStore();

const stats = { already: 0, added: 0, failed: [] as string[] };
const known = await store.findGameIds(
  "bgg",
  games.map((g) => g.bggId),
);
console.log(
  `${games.length} games in the pack, ${known.size} already in the catalog`,
);

for (const game of games) {
  if (known.has(game.bggId)) {
    stats.already++;
    continue;
  }
  if (dryRun) {
    console.log(`would import #${game.rank} ${game.name}`);
    continue;
  }
  let done = false;
  for (let attempt = 0; attempt < 4 && !done; attempt++) {
    try {
      const parsed = externalGameSchema.safeParse(
        await bgg.fetchGame(game.bggId),
      );
      if (!parsed.success) throw new Error("failed validation");
      await store.upsertGame(parsed.data);
      stats.added++;
      done = true;
    } catch (error) {
      if (error instanceof BggError && error.code === "rate_limited") {
        console.log(`rate limited, waiting 30 s (${game.name})`);
        await sleep(30_000);
        continue;
      }
      console.log(
        `#${game.rank} ${game.name} (${game.bggId}): ${(error as Error).message}`,
      );
      break;
    }
  }
  if (!done) stats.failed.push(`${game.bggId} ${game.name}`);
  if ((stats.added + stats.failed.length) % 25 === 0)
    console.log(`  added ${stats.added}, failed ${stats.failed.length}`);
  await sleep(delay);
}

console.log(
  `Done: ${stats.added} added, ${stats.already} already there, ${stats.failed.length} failed`,
);
if (stats.failed.length)
  console.log("Failed (run again to retry):", stats.failed);
