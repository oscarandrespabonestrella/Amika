import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { startOfMonthUtc, type SearchUsage } from "../rate-limit";
import type { CachedSearch } from "./manual-search-service";

export type SuggestionView = {
  id: string;
  url: string;
  title: string;
  locale: string | null;
  publisher: string | null;
  sourceHost: string;
  isOfficial: boolean;
  sizeBytes: number | null;
  status: "pending" | "rejected";
  /** True when the signed-in user wrote it (admins also see everybody else's). */
  mine: boolean;
};

export type NewManual = {
  gameId: string;
  url: string;
  title: string;
  locale: string | null;
  publisher: string | null;
  sourceHost: string;
  isOfficial: boolean;
  sizeBytes: number | null;
  verifiedAt: string;
};

/** Manuals of a game, read through the caller's RLS. */
export async function knownUrls(
  gameId: string,
): Promise<{ added: string[]; proposed: string[] }> {
  const supabase = createSupabaseServerClient();
  const [resources, suggestions] = await Promise.all([
    supabase
      .from("game_resources")
      .select("url")
      .eq("game_id", gameId)
      .eq("kind", "rules"),
    supabase.from("manual_suggestions").select("url").eq("game_id", gameId),
  ]);
  if (resources.error) throw resources.error;
  if (suggestions.error) throw suggestions.error;
  const urls = (rows: { url: string | null }[] | null) =>
    (rows ?? []).flatMap((r) => (r.url ? [r.url] : []));
  return { added: urls(resources.data), proposed: urls(suggestions.data) };
}

export async function listSuggestions(
  gameId: string,
  userId: string,
): Promise<SuggestionView[]> {
  const { data, error } = await createSupabaseServerClient()
    .from("manual_suggestions")
    .select(
      "id, url, title, locale, publisher, source_host, is_official, size_bytes, status, created_by, created_at",
    )
    .eq("game_id", gameId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    locale: row.locale,
    publisher: row.publisher,
    sourceHost: row.source_host,
    isOfficial: row.is_official,
    sizeBytes: row.size_bytes,
    status: row.status as SuggestionView["status"],
    mine: row.created_by === userId,
  }));
}

/** Throws a Postgres error: 23505 duplicate, P0001 cap reached, 42501 not allowed. */
export async function insertSuggestion(manual: NewManual): Promise<void> {
  const { error } = await createSupabaseServerClient()
    .from("manual_suggestions")
    .insert({
      game_id: manual.gameId,
      url: manual.url,
      title: manual.title,
      locale: manual.locale,
      publisher: manual.publisher,
      source_host: manual.sourceHost,
      is_official: manual.isOfficial,
      size_bytes: manual.sizeBytes,
      verified_at: manual.verifiedAt,
    });
  if (error) throw error;
}

/** Administrators only (RLS): straight into the Game Center. */
export async function insertRulesResource(manual: NewManual): Promise<void> {
  const { error } = await createSupabaseServerClient()
    .from("game_resources")
    .insert({
      game_id: manual.gameId,
      kind: "rules",
      locale: manual.locale,
      title: manual.title,
      url: manual.url,
      is_official: manual.isOfficial,
      publisher: manual.publisher,
      verified_at: manual.verifiedAt,
    });
  if (error) throw error;
}

export async function publishSuggestion(id: string): Promise<void> {
  const { error } = await createSupabaseServerClient().rpc(
    "publish_manual_suggestion",
    { p_id: id },
  );
  if (error) throw error;
}

export async function rejectSuggestion(id: string): Promise<void> {
  const { error } = await createSupabaseServerClient()
    .from("manual_suggestions")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteSuggestion(id: string): Promise<void> {
  const { error } = await createSupabaseServerClient()
    .from("manual_suggestions")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/**
 * The URL behind a stored manual, through the caller's RLS: a published rules link (any user
 * who can see the game) or a proposal (its author or an administrator). Null = not visible.
 */
export async function urlOfResource(
  id: string,
): Promise<{ url: string; gameId: string } | null> {
  const { data, error } = await createSupabaseServerClient()
    .from("game_resources")
    .select("url, game_id")
    .eq("id", id)
    .eq("kind", "rules")
    .maybeSingle();
  if (error) throw error;
  return data?.url ? { url: data.url, gameId: data.game_id } : null;
}

export async function urlOfSuggestion(
  id: string,
): Promise<{ url: string; gameId: string } | null> {
  const { data, error } = await createSupabaseServerClient()
    .from("manual_suggestions")
    .select("url, game_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? { url: data.url, gameId: data.game_id } : null;
}

// --- usage log (privileged: no RLS policies on manual_requests) ---------------------

const countSince = async (userId: string, kind: string, ms: number) => {
  const { count, error } = await createSupabaseAdminClient()
    .from("manual_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", new Date(Date.now() - ms).toISOString());
  if (error) throw error;
  return count ?? 0;
};

export async function getSearchUsage(userId: string): Promise<SearchUsage> {
  const [lastMinute, lastDay] = await Promise.all([
    countSince(userId, "search", 60_000),
    countSince(userId, "search", 24 * 60 * 60_000),
  ]);
  return { lastMinute, lastDay };
}

export const getDownloadsLastHour = (userId: string) =>
  countSince(userId, "download", 60 * 60_000);

export async function recordRequest(
  userId: string,
  kind: "search" | "download",
): Promise<void> {
  const { error } = await createSupabaseAdminClient()
    .from("manual_requests")
    .insert({ user_id: userId, kind });
  if (error) throw error;
}

/** Calls made to the paid search API, in total (all users) since the start of this UTC month. */
export async function getApiCallsThisMonth(
  now: Date = new Date(),
): Promise<number> {
  const { count, error } = await createSupabaseAdminClient()
    .from("manual_requests")
    .select("id", { count: "exact", head: true })
    .eq("kind", "api_call")
    .gte("created_at", startOfMonthUtc(now).toISOString());
  if (error) throw error;
  return count ?? 0;
}

/** One row per call, so the monthly total is a plain count. */
export async function recordApiCalls(
  userId: string,
  calls: number,
): Promise<void> {
  if (calls <= 0) return;
  const { error } = await createSupabaseAdminClient()
    .from("manual_requests")
    .insert(
      Array.from({ length: calls }, () => ({
        user_id: userId,
        kind: "api_call",
      })),
    );
  if (error) throw error;
}

// --- shared search cache (privileged: no RLS policies on manual_search_cache) ----------

const cachedResultSchema = z.object({
  url: z.string().max(500),
  title: z.string().max(200),
  locale: z.string().nullable(),
  publisher: z.string().nullable(),
  sourceHost: z.string(),
  isOfficial: z.boolean(),
  sizeBytes: z.number().nullable(),
});

export const searchCache = {
  async get(gameId: string): Promise<CachedSearch | null> {
    const { data, error } = await createSupabaseAdminClient()
      .from("manual_search_cache")
      .select("outcome, results, created_at")
      .eq("game_id", gameId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (data.outcome === "not_found")
      return { outcome: "not_found", createdAt: data.created_at };
    // anything that does not look right is a miss, never an error
    const parsed = z.array(cachedResultSchema).safeParse(data.results);
    return parsed.success
      ? { outcome: "results", results: parsed.data, createdAt: data.created_at }
      : null;
  },

  async put(gameId: string, entry: CachedSearch): Promise<void> {
    const { error } = await createSupabaseAdminClient()
      .from("manual_search_cache")
      .upsert({
        game_id: gameId,
        outcome: entry.outcome,
        results: entry.outcome === "results" ? entry.results : [],
        created_at: entry.createdAt,
      });
    if (error) throw error;
  },
};
