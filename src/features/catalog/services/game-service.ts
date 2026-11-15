import "server-only";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CustomGameData } from "../schemas";
import type { GameKind, RelationType, TermType } from "../types";

export type GameDetail = {
  id: string;
  kind: GameKind;
  name: string;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlaytime: number | null;
  maxPlaytime: number | null;
  minAge: number | null;
  coverUrl: string | null;
  isCustom: boolean;
  description: string | null;
  terms: { type: TermType; name: string }[];
  relations: {
    type: RelationType;
    name: string;
    /** Local game id when we already have it, otherwise the external id. */
    gameId: string | null;
    externalId: string | null;
  }[];
  bggUrl: string | null;
  photos: { id: string; path: string; url: string | null }[];
};

const PHOTO_URL_TTL_SECONDS = 3600;

/** locale -> the game's original language -> English -> whatever exists. */
export function pickByLocale<T extends { locale: string }>(
  rows: T[],
  locale: string,
  originalLanguage: string,
): T | null {
  for (const wanted of [locale, originalLanguage, "en"]) {
    const row = rows.find((r) => r.locale === wanted);
    if (row) return row;
  }
  return rows[0] ?? null;
}

type TermRow = {
  terms: {
    type: string;
    name: string;
    term_translations: { locale: string; name: string }[];
  } | null;
};

export async function getGameDetail(
  id: string,
  locale: string,
): Promise<GameDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = createSupabaseServerClient();

  // RLS: returns nothing for someone else's custom game, same as a missing id.
  const { data: game, error } = await supabase
    .from("games")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!game) return null;

  const [translations, terms, relations, externalIds, photos] =
    await Promise.all([
      supabase
        .from("game_translations")
        .select("locale, name, description")
        .eq("game_id", id),
      supabase
        .from("game_terms")
        .select("terms(type, name, term_translations(locale, name))")
        .eq("game_id", id),
      supabase
        .from("game_relations")
        .select("type, related_game_id, related_external_id, related_name")
        .eq("game_id", id),
      supabase
        .from("game_external_ids")
        .select("source, external_id")
        .eq("game_id", id),
      supabase
        .from("game_photos")
        .select("id, storage_path")
        .eq("game_id", id)
        .order("created_at"),
    ]);
  for (const result of [translations, terms, relations, externalIds, photos]) {
    if (result.error) throw result.error;
  }

  const translation = pickByLocale(
    translations.data ?? [],
    locale,
    game.original_language,
  );

  // Relations to games that were imported after this one: resolve by external id.
  const unresolved = (relations.data ?? [])
    .filter((r) => !r.related_game_id && r.related_external_id)
    .map((r) => r.related_external_id as string);
  const resolved = new Map<string, string>();
  if (unresolved.length > 0) {
    const { data } = await supabase
      .from("game_external_ids")
      .select("game_id, external_id")
      .in("external_id", unresolved);
    for (const row of data ?? []) resolved.set(row.external_id, row.game_id);
  }

  const photoRows = photos.data ?? [];
  let signed = new Map<string, string>();
  if (photoRows.length > 0) {
    const { data, error: signError } = await supabase.storage
      .from("game-photos")
      .createSignedUrls(
        photoRows.map((p) => p.storage_path),
        PHOTO_URL_TTL_SECONDS,
      );
    if (signError) logger.error("signing photo urls failed", signError);
    signed = new Map(
      (data ?? []).flatMap((entry) =>
        entry.path && entry.signedUrl
          ? [[entry.path, entry.signedUrl] as const]
          : [],
      ),
    );
  }

  const bggId = externalIds.data?.find((e) => e.source === "bgg")?.external_id;

  return {
    id: game.id,
    kind: game.kind as GameKind,
    name: translation?.name || game.name,
    yearPublished: game.year_published,
    minPlayers: game.min_players,
    maxPlayers: game.max_players,
    minPlaytime: game.min_playtime,
    maxPlaytime: game.max_playtime,
    minAge: game.min_age,
    coverUrl: game.cover_url,
    isCustom: game.source === "manual",
    description: translation?.description ?? null,
    terms: ((terms.data ?? []) as unknown as TermRow[])
      .flatMap((row) => (row.terms ? [row.terms] : []))
      .map((term) => ({
        type: term.type as TermType,
        name:
          pickByLocale(term.term_translations, locale, "en")?.name ?? term.name,
      })),
    relations: (relations.data ?? []).map((r) => ({
      type: r.type as RelationType,
      name: r.related_name ?? "",
      gameId:
        r.related_game_id ?? resolved.get(r.related_external_id ?? "") ?? null,
      externalId: r.related_external_id,
    })),
    bggUrl: bggId ? `https://boardgamegeek.com/boardgame/${bggId}` : null,
    photos: photoRows.map((p) => ({
      id: p.id,
      path: p.storage_path,
      url: signed.get(p.storage_path) ?? null,
    })),
  };
}

/** Creates a private game owned by the user (RLS enforces ownership). */
export async function createCustomGame(
  userId: string,
  data: CustomGameData,
): Promise<string> {
  const supabase = createSupabaseServerClient();
  const { data: game, error } = await supabase
    .from("games")
    .insert({
      name: data.name,
      kind: data.kind,
      year_published: data.yearPublished ?? null,
      min_players: data.minPlayers ?? null,
      max_players: data.maxPlayers ?? null,
      min_playtime: data.minPlaytime ?? null,
      max_playtime: data.maxPlaytime ?? null,
      min_age: data.minAge ?? null,
      original_language: data.locale,
      source: "manual",
      owner_id: userId,
    })
    .select("id")
    .single();
  if (error) throw error;

  if (data.description) {
    const { error: translationError } = await supabase
      .from("game_translations")
      .insert({
        game_id: game.id,
        locale: data.locale,
        name: data.name,
        description: data.description,
      });
    if (translationError) {
      // Do not leave a half-created game behind.
      await supabase.from("games").delete().eq("id", game.id);
      throw translationError;
    }
  }
  return game.id;
}
