import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LibraryFilters, LibraryInput, LibraryStatus } from "../schemas";

export type LibraryItem = {
  status: LibraryStatus;
  isFavorite: boolean;
  rating: number | null;
  notes: string | null;
};

export type LibraryEntry = {
  status: LibraryStatus;
  isFavorite: boolean;
  rating: number | null;
  game: {
    id: string;
    name: string;
    kind: "base" | "expansion";
    yearPublished: number | null;
    minPlayers: number | null;
    maxPlayers: number | null;
    minPlaytime: number | null;
    maxPlaytime: number | null;
    coverUrl: string | null;
    isCustom: boolean;
  };
};

export type SaveOutcome = "saved" | "invalid" | "not_found";

/** RLS: returns only the signed-in user's own item. */
export async function getLibraryItem(
  gameId: string,
): Promise<LibraryItem | null> {
  if (!z.uuid().safeParse(gameId).success) return null;
  const { data, error } = await createSupabaseServerClient()
    .from("library_items")
    .select("status, is_favorite, rating, notes")
    .eq("game_id", gameId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    status: data.status as LibraryStatus,
    isFavorite: data.is_favorite,
    rating: data.rating,
    notes: data.notes,
  };
}

export async function countLibrary(): Promise<number> {
  const { count, error } = await createSupabaseServerClient()
    .from("library_items")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export type LibraryCounts = {
  all: number;
  owned: number;
  previouslyOwned: number;
  favorites: number;
};

/** Totals behind the quick filters (independent of the search text). */
export async function getLibraryCounts(): Promise<LibraryCounts> {
  const { data, error } = await createSupabaseServerClient()
    .from("library_items")
    .select("status, is_favorite");
  if (error) throw error;
  const rows = data ?? [];
  return {
    all: rows.length,
    owned: rows.filter((r) => r.status === "owned").length,
    previouslyOwned: rows.filter((r) => r.status === "previously_owned").length,
    favorites: rows.filter((r) => r.is_favorite).length,
  };
}

export async function searchLibrary(
  filters: LibraryFilters,
): Promise<LibraryEntry[]> {
  const { data, error } = await createSupabaseServerClient().rpc(
    "search_library",
    {
      q: filters.q || undefined,
      p_status: filters.status,
      p_favorites: filters.favorites || undefined,
      p_players: filters.players,
      p_max_minutes: filters.time,
      p_category: filters.category,
      p_mechanic: filters.mechanic,
      p_limit: 100,
    },
  );
  if (error) throw error;

  return (data ?? []).map((row) => ({
    status: row.status as LibraryStatus,
    isFavorite: row.is_favorite,
    rating: row.rating,
    game: {
      id: row.game_id,
      name: row.name,
      kind: row.kind as "base" | "expansion",
      yearPublished: row.year_published,
      minPlayers: row.min_players,
      maxPlayers: row.max_players,
      minPlaytime: row.min_playtime,
      maxPlaytime: row.max_playtime,
      coverUrl: row.cover_url,
      isCustom: row.source === "manual",
    },
  }));
}

export type LibraryTermOption = { id: string; name: string };
export type LibraryTerms = {
  category: LibraryTermOption[];
  mechanic: LibraryTermOption[];
};

/**
 * Categories and mechanics that appear in the user's library (so the filter only offers
 * values that can match), named in the user's language with English as fallback.
 */
export async function listLibraryTerms(locale: string): Promise<LibraryTerms> {
  const { data, error } = await createSupabaseServerClient()
    .from("library_items")
    .select(
      "games!inner(game_terms(terms(id, type, name, term_translations(locale, name))))",
    );
  if (error) throw error;

  const found = new Map<string, LibraryTermOption & { type: string }>();
  for (const item of data ?? []) {
    for (const gt of item.games?.game_terms ?? []) {
      const term = gt.terms;
      if (!term || (term.type !== "category" && term.type !== "mechanic"))
        continue;
      const translations = term.term_translations ?? [];
      const name =
        translations.find((t) => t.locale === locale)?.name ??
        translations.find((t) => t.locale === "en")?.name ??
        term.name;
      found.set(term.id, { id: term.id, type: term.type, name });
    }
  }
  const byType = (type: "category" | "mechanic") =>
    [...found.values()]
      .filter((term) => term.type === type)
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  return { category: byType("category"), mechanic: byType("mechanic") };
}

/**
 * Adds a game or updates only the fields that were provided. A new item needs a
 * status; the database (RLS) rejects games the user cannot see.
 */
export async function saveLibraryItem(
  input: LibraryInput,
): Promise<SaveOutcome> {
  const supabase = createSupabaseServerClient();

  const { data: existing, error: lookupError } = await supabase
    .from("library_items")
    .select("id")
    .eq("game_id", input.gameId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const fields = {
    ...(input.status !== undefined && { status: input.status }),
    ...(input.isFavorite !== undefined && { is_favorite: input.isFavorite }),
    ...(input.rating !== undefined && { rating: input.rating }),
    ...(input.notes !== undefined && {
      notes: input.notes === "" ? null : input.notes,
    }),
  };

  if (!existing) {
    if (input.status === undefined) return "invalid";
    const { error } = await supabase
      .from("library_items")
      .insert({ game_id: input.gameId, status: input.status, ...fields });
    if (error) {
      if (error.code === "42501") return "not_found"; // not allowed to see that game
      throw error;
    }
    return "saved";
  }

  if (Object.keys(fields).length === 0) return "saved";
  const { error } = await supabase
    .from("library_items")
    .update(fields)
    .eq("id", existing.id);
  if (error) throw error;
  return "saved";
}

export type NewLibraryItem = {
  gameId: string;
  status: LibraryStatus;
  rating: number | null;
};

/**
 * Adds games in bulk. Entries the user already has are left untouched (an import must
 * never overwrite their status, rating or notes). RLS applies as for a single save.
 */
export async function addLibraryItems(
  items: NewLibraryItem[],
): Promise<{ added: number; existing: number }> {
  if (items.length === 0) return { added: 0, existing: 0 };
  const supabase = createSupabaseServerClient();

  const { data, error: lookupError } = await supabase
    .from("library_items")
    .select("game_id")
    .in(
      "game_id",
      items.map((i) => i.gameId),
    );
  if (lookupError) throw lookupError;
  const have = new Set((data ?? []).map((r) => r.game_id));

  const fresh = items.filter((i) => !have.has(i.gameId));
  if (fresh.length > 0) {
    const { error } = await supabase.from("library_items").insert(
      fresh.map((i) => ({
        game_id: i.gameId,
        status: i.status,
        rating: i.rating,
      })),
    );
    if (error) throw error;
  }
  return { added: fresh.length, existing: items.length - fresh.length };
}

export async function removeLibraryItem(gameId: string): Promise<void> {
  const { error } = await createSupabaseServerClient()
    .from("library_items")
    .delete()
    .eq("game_id", gameId);
  if (error) throw error;
}
