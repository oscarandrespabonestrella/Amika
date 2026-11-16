import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** One entry of the user's own roster. */
export type Player = {
  id: string;
  name: string;
  /** "This is me": the player linked to the owner's own account. */
  isMe: boolean;
  matchCount: number;
};

export type RenameOutcome = "ok" | "exists" | "not_found";
export type MergeOutcome = "ok" | "together" | "not_found";
export type DeleteOutcome = "ok" | "in_use" | "not_found";
export type SetMeOutcome = "ok" | "me_taken" | "not_found";

/** Postgres codes: 23505 = name taken / second "me", 23503 = still has matches, PL001 = played together, P0002 = not found. */
const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

/** The roster (RLS: only the signed-in user's own players), most played first. */
export async function listPlayers(): Promise<Player[]> {
  const { data, error } = await createSupabaseServerClient()
    .from("players")
    .select("id, name, linked_user_id, play_participants(count)");
  if (error) throw error;

  return (data ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      isMe: row.linked_user_id !== null,
      matchCount: row.play_participants[0]?.count ?? 0,
    }))
    .sort(
      (a, b) =>
        b.matchCount - a.matchCount ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}

export async function renamePlayer(
  id: string,
  name: string,
): Promise<RenameOutcome> {
  const { data, error } = await createSupabaseServerClient()
    .from("players")
    .update({ name })
    .eq("id", id)
    .select("id");
  if (error) {
    if (pgCode(error) === "23505") return "exists";
    throw error;
  }
  return data.length > 0 ? "ok" : "not_found";
}

/** Moves the removed player's matches to the kept one and deletes the removed one. */
export async function mergePlayers(
  keepId: string,
  removeId: string,
): Promise<MergeOutcome> {
  const { error } = await createSupabaseServerClient().rpc("merge_players", {
    p_keep: keepId,
    p_remove: removeId,
  });
  if (error) {
    const code = pgCode(error);
    if (code === "PL001") return "together";
    if (code === "P0002" || code === "42501" || code === "22023")
      return "not_found";
    throw error;
  }
  return "ok";
}

export async function deletePlayer(id: string): Promise<DeleteOutcome> {
  const { data, error } = await createSupabaseServerClient()
    .from("players")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    if (pgCode(error) === "23503") return "in_use";
    throw error;
  }
  return data.length > 0 ? "ok" : "not_found";
}

/**
 * Marks a roster player as "me" (moving the mark from the previous one), or clears it
 * with `null`. Only the owner themself can be linked for now (Phase 8 adds others).
 */
export async function setMe(playerId: string | null): Promise<SetMeOutcome> {
  const { userId } = await auth();
  if (!userId) return "not_found";
  const supabase = createSupabaseServerClient();

  if (playerId !== null) {
    const { data: target, error: lookupError } = await supabase
      .from("players")
      .select("id")
      .eq("id", playerId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!target) return "not_found";
  }

  const { error: clearError } = await supabase
    .from("players")
    .update({ linked_user_id: null })
    .eq("linked_user_id", userId);
  if (clearError) throw clearError;
  if (playerId === null) return "ok";

  const { error } = await supabase
    .from("players")
    .update({ linked_user_id: userId })
    .eq("id", playerId);
  if (error) {
    if (pgCode(error) === "23505") return "me_taken";
    throw error;
  }
  return "ok";
}
