import "server-only";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type Definition } from "../engine/definition";
import { composeCopyTitle } from "../schemas";
import { validateDefinition } from "../engine/validate";

export type SheetSummary = {
  id: string;
  gameId: string;
  title: string;
  locale: string;
  latestVersion: number;
  ownedByMe: boolean;
  copiedFrom: string | null;
  updatedAt: string;
};

export type SheetDetail = SheetSummary & { definition: Definition };

export type CreateOutcome = { sheetId: string } | "limit" | "not_found";
export type SaveVersionOutcome =
  { version: number } | "conflict" | "limit" | "not_found";

/** Postgres codes we expect: 42501 = RLS said no, 23503 = missing parent, 23505 = lost a race, P0001 = a limit trigger. */
const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

type SheetRow = {
  id: string;
  game_id: string;
  owner_id: string;
  title: string;
  locale: string;
  copied_from: string | null;
  updated_at: string;
};

const SHEET_COLUMNS =
  "id, game_id, owner_id, title, locale, copied_from, updated_at";

function toSummary(
  row: SheetRow,
  latestVersion: number,
  userId: string | null,
): SheetSummary {
  return {
    id: row.id,
    gameId: row.game_id,
    title: row.title,
    locale: row.locale,
    latestVersion,
    ownedByMe: userId !== null && row.owner_id === userId,
    copiedFrom: row.copied_from,
    updatedAt: row.updated_at,
  };
}

/** RLS: the signed-in user's own sheets for this game (public ones arrive in Phase 5c). */
export async function listSheetsForGame(
  gameId: string,
): Promise<SheetSummary[]> {
  if (!z.uuid().safeParse(gameId).success) return [];
  const { userId } = await auth();
  const { data, error } = await createSupabaseServerClient()
    .from("scoring_sheets")
    .select(`${SHEET_COLUMNS}, scoring_sheet_versions(version)`)
    .eq("game_id", gameId)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) =>
    toSummary(
      row,
      Math.max(0, ...row.scoring_sheet_versions.map((v) => v.version)),
      userId,
    ),
  );
}

/**
 * The sheet with its latest version. Null when missing, not visible, or when the
 * stored definition fails validation (it is untrusted: users can write rows directly).
 */
export async function getSheet(sheetId: string): Promise<SheetDetail | null> {
  if (!z.uuid().safeParse(sheetId).success) return null;
  const supabase = createSupabaseServerClient();
  const { userId } = await auth();

  const { data: sheet, error } = await supabase
    .from("scoring_sheets")
    .select(SHEET_COLUMNS)
    .eq("id", sheetId)
    .maybeSingle();
  if (error) throw error;
  if (!sheet) return null;

  const { data: latest, error: versionError } = await supabase
    .from("scoring_sheet_versions")
    .select("version, definition")
    .eq("sheet_id", sheetId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) throw versionError;
  if (!latest) return null;

  const validated = validateDefinition(latest.definition);
  if (!validated.ok) {
    logger.error("scoring.getSheet invalid stored definition", null, {
      sheetId,
      version: latest.version,
    });
    return null;
  }
  return {
    ...toSummary(sheet, latest.version, userId),
    definition: validated.definition,
  };
}

/** The sheet and its first version are created together: a failed version removes the sheet. */
export async function createSheet(input: {
  gameId: string;
  title: string;
  locale: string;
  definition: Definition;
  copiedFrom?: string;
}): Promise<CreateOutcome> {
  const supabase = createSupabaseServerClient();

  const { data: sheet, error } = await supabase
    .from("scoring_sheets")
    .insert({
      game_id: input.gameId,
      title: input.title,
      locale: input.locale,
      copied_from: input.copiedFrom ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (pgCode(error) === "P0001") return "limit";
    if (pgCode(error) === "42501" || pgCode(error) === "23503")
      return "not_found"; // a game the user cannot see
    throw error;
  }

  // A new sheet starts at version 1 (the numbering trigger checks it is the next one).
  const { error: versionError } = await supabase
    .from("scoring_sheet_versions")
    .insert({
      sheet_id: sheet.id,
      version: 1,
      definition: input.definition as unknown as Json,
    });
  if (versionError) {
    await supabase.from("scoring_sheets").delete().eq("id", sheet.id);
    throw versionError;
  }
  return { sheetId: sheet.id };
}

/**
 * Editing means a new version; old versions are immutable. The save creates
 * `baseVersion + 1` (the version the author loaded + 1): if someone saved in the
 * meantime the database refuses with 23505 and we report a conflict.
 */
export async function saveSheetVersion(
  sheetId: string,
  definition: Definition,
  baseVersion: number,
): Promise<SaveVersionOutcome> {
  const { data, error } = await createSupabaseServerClient()
    .from("scoring_sheet_versions")
    .insert({
      sheet_id: sheetId,
      version: baseVersion + 1,
      definition: definition as unknown as Json,
    })
    .select("version")
    .single();
  if (error) {
    const code = pgCode(error);
    if (code === "23505") return "conflict";
    if (code === "P0001") return "limit";
    if (code === "42501" || code === "23503") return "not_found";
    throw error;
  }
  return { version: data.version };
}

export async function renameSheet(
  sheetId: string,
  title: string,
  locale: string,
): Promise<"saved" | "not_found"> {
  const { data, error } = await createSupabaseServerClient()
    .from("scoring_sheets")
    .update({ title, locale })
    .eq("id", sheetId)
    .select("id");
  if (error) throw error;
  return data.length > 0 ? "saved" : "not_found";
}

export async function deleteSheet(sheetId: string): Promise<void> {
  const { error } = await createSupabaseServerClient()
    .from("scoring_sheets")
    .delete()
    .eq("id", sheetId);
  if (error) throw error;
}

/** A new, independent sheet whose first version is the source's latest definition. */
export async function copySheet(
  sheetId: string,
  titleSuffix: string,
): Promise<CreateOutcome> {
  const source = await getSheet(sheetId);
  if (!source) return "not_found";
  return createSheet({
    gameId: source.gameId,
    title: composeCopyTitle(source.title, titleSuffix),
    locale: source.locale,
    definition: source.definition,
    copiedFrom: source.id,
  });
}
