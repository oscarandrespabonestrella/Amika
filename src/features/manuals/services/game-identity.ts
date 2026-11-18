import "server-only";
import { z } from "zod";
import { pickByLocale } from "@/lib/locale-fallback";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GameIdentity } from "../types";

type TermRow = { terms: { type: string; name: string } | null };

/**
 * What the SERVER knows about a game, read through the caller's RLS. The search never trusts
 * a name sent by the browser: the client sends only the game id.
 * `null` when the game does not exist or the user cannot see it.
 */
export async function loadGameIdentity(
  gameId: string,
  locale: string,
): Promise<(GameIdentity & { isCustom: boolean }) | null> {
  if (!z.uuid().safeParse(gameId).success) return null;
  const supabase = createSupabaseServerClient();

  const { data: game, error } = await supabase
    .from("games")
    .select("id, name, kind, year_published, source, original_language")
    .eq("id", gameId)
    .maybeSingle();
  if (error) throw error;
  if (!game) return null;

  const [translations, terms, relations] = await Promise.all([
    supabase
      .from("game_translations")
      .select("locale, name")
      .eq("game_id", gameId),
    supabase
      .from("game_terms")
      .select("terms(type, name)")
      .eq("game_id", gameId),
    supabase
      .from("game_relations")
      .select("type, related_name")
      .eq("game_id", gameId),
  ]);
  for (const result of [translations, terms, relations])
    if (result.error) throw result.error;

  const named = (translations.data ?? []).filter(
    (t): t is { locale: string; name: string } => Boolean(t.name),
  );
  const localized = pickByLocale(named, locale, game.original_language);

  return {
    id: game.id,
    name: localized?.name || game.name,
    altNames: [game.name, ...named.map((t) => t.name)],
    year: game.year_published,
    publishers: ((terms.data ?? []) as unknown as TermRow[]).flatMap((row) =>
      row.terms?.type === "publisher" ? [row.terms.name] : [],
    ),
    relatedNames: (relations.data ?? []).flatMap((r) =>
      r.type === "has_expansion" && r.related_name ? [r.related_name] : [],
    ),
    isExpansion: game.kind === "expansion",
    isCustom: game.source === "manual",
  };
}
