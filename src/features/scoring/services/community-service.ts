import "server-only";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { VoteInput } from "../schemas";

/** One sheet of a game as ranked by the database, with the viewer's relation to it. */
export type CommunitySheet = {
  sheetId: string;
  title: string;
  locale: string;
  version: number;
  versionId: string;
  isMine: boolean;
  visibility: "private" | "public";
  verified: boolean;
  disabled: boolean;
  upVotes: number;
  flagVotes: number;
  uses: number;
  score: number;
};

export type PublishOutcome = "ok" | "not_found" | "custom_game" | "daily_limit";
export type VoteOutcome = "ok" | "own_sheet" | "no_match" | "invalid";
export type AdminOutcome = "ok" | "forbidden" | "not_found";
export type MyVote = { kind: "up" | "flag"; reason: string | null } | null;

/** Postgres codes: 42501 = RLS/permission, PB001/PB002 = publication rules, P0002 = no such row, 23514 = a CHECK. */
const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

/**
 * The sheets of a game the viewer may see (their own, and public enabled ones; admins
 * also see disabled public sheets), best first: verified, Wilson score, uses. Never
 * includes who wrote a sheet.
 */
export async function listCommunitySheets(
  gameId: string,
): Promise<CommunitySheet[]> {
  if (!z.uuid().safeParse(gameId).success) return [];
  const { data, error } = await createSupabaseServerClient().rpc(
    "sheet_rankings",
    { p_game_id: gameId },
  );
  if (error) throw error;
  return (data ?? []).map((row) => ({
    sheetId: row.sheet_id,
    title: row.title,
    locale: row.locale,
    version: row.version,
    versionId: row.version_id,
    isMine: row.is_mine,
    visibility: row.visibility as "private" | "public",
    verified: row.verified,
    disabled: row.disabled,
    upVotes: row.up_votes,
    flagVotes: row.flag_votes,
    uses: row.uses,
    score: row.score,
  }));
}

/** True only for administrators (the database re-checks on every admin function). */
export async function isAdminViewer(): Promise<boolean> {
  const { data, error } = await createSupabaseServerClient().rpc("is_admin");
  if (error) throw error;
  return data === true;
}

async function setVisibility(
  sheetId: string,
  visibility: "public" | "private",
): Promise<PublishOutcome> {
  const { data, error } = await createSupabaseServerClient()
    .from("scoring_sheets")
    .update({ visibility })
    .eq("id", sheetId)
    .select("id");
  if (error) {
    const code = pgCode(error);
    if (code === "PB001") return "custom_game";
    if (code === "PB002") return "daily_limit";
    if (code === "42501") return "not_found";
    throw error;
  }
  return data.length > 0 ? "ok" : "not_found";
}

export const publishSheet = (sheetId: string) =>
  setVisibility(sheetId, "public");

export async function unpublishSheet(
  sheetId: string,
): Promise<"ok" | "not_found"> {
  const outcome = await setVisibility(sheetId, "private");
  return outcome === "ok" ? "ok" : "not_found";
}

/** The viewer's own vote on a version (RLS: nobody else's). */
export async function getMyVote(versionId: string): Promise<MyVote> {
  if (!z.uuid().safeParse(versionId).success) return null;
  const { userId } = await auth();
  if (!userId) return null;
  // Administrators can read every vote: ask for the viewer's own explicitly.
  const { data, error } = await createSupabaseServerClient()
    .from("scoring_votes")
    .select("kind, reason")
    .eq("version_id", versionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { kind: data.kind as "up" | "flag", reason: data.reason }
    : null;
}

/**
 * Votes (or changes the vote) on a version. The database requires the voter's own match
 * on exactly that version and refuses the author; we only tell the two cases apart.
 */
export async function castVote(input: VoteInput): Promise<VoteOutcome> {
  const supabase = createSupabaseServerClient();
  const { userId } = await auth();

  const { data: version, error: lookupError } = await supabase
    .from("scoring_sheet_versions")
    .select("scoring_sheets(owner_id)")
    .eq("id", input.versionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (
    version?.scoring_sheets?.owner_id &&
    version.scoring_sheets.owner_id === userId
  )
    return "own_sheet";

  const { error } = await supabase.from("scoring_votes").upsert(
    {
      version_id: input.versionId,
      play_id: input.playId,
      kind: input.kind,
      reason: input.reason,
    },
    { onConflict: "user_id,version_id" },
  );
  if (error) {
    const code = pgCode(error);
    if (code === "42501") return "no_match";
    if (code === "23514") return "invalid";
    throw error;
  }
  return "ok";
}

export async function clearVote(versionId: string): Promise<void> {
  const { error } = await createSupabaseServerClient()
    .from("scoring_votes")
    .delete()
    .eq("version_id", versionId);
  if (error) throw error;
}

async function adminCall(
  call: () => PromiseLike<{ error: unknown }>,
): Promise<AdminOutcome> {
  const { error } = await call();
  if (error) {
    const code = pgCode(error);
    if (code === "42501") return "forbidden";
    if (code === "P0002") return "not_found";
    throw error;
  }
  return "ok";
}

export const setSheetVerified = (sheetId: string, verified: boolean) =>
  adminCall(() =>
    createSupabaseServerClient().rpc("admin_set_sheet_verified", {
      p_sheet: sheetId,
      p_verified: verified,
    }),
  );

export const setSheetDisabled = (sheetId: string, disabled: boolean) =>
  adminCall(() =>
    createSupabaseServerClient().rpc("admin_set_sheet_disabled", {
      p_sheet: sheetId,
      p_disabled: disabled,
    }),
  );

/** The reasons behind the flags of a sheet: administrators only (empty otherwise). */
export async function listSheetFlags(
  sheetId: string,
): Promise<{ version: number; reason: string; createdAt: string }[]> {
  if (!z.uuid().safeParse(sheetId).success) return [];
  const { data, error } = await createSupabaseServerClient().rpc(
    "admin_sheet_flags",
    { p_sheet: sheetId },
  );
  if (error) {
    if (pgCode(error) === "42501") return [];
    throw error;
  }
  return (data ?? []).map((row) => ({
    version: row.version,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}
