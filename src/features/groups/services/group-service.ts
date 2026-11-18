import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** A saved group of the user's own players. */
export type Group = {
  id: string;
  name: string;
  members: { id: string; name: string }[];
};

export type CreateOutcome =
  | { outcome: "ok"; id: string }
  | { outcome: "exists" }
  | { outcome: "too_many" };
export type RenameOutcome = "ok" | "exists" | "not_found";
export type DeleteOutcome = "ok" | "not_found";
export type SetMembersOutcome = "ok" | "not_found";

/** Postgres codes: 23505 = name taken, P0001 = group cap, 42501 = RLS (not yours). */
const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The user's groups with their members (RLS: only your own), by name. */
export async function listGroups(): Promise<Group[]> {
  const { data, error } = await createSupabaseServerClient()
    .from("player_groups")
    .select("id, name, player_group_members(players(id, name))");
  if (error) throw error;

  return (data ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      members: row.player_group_members
        .flatMap((m) => (m.players ? [m.players] : []))
        .sort(byName),
    }))
    .sort(byName);
}

export async function createGroup(name: string): Promise<CreateOutcome> {
  const { data, error } = await createSupabaseServerClient()
    .from("player_groups")
    .insert({ name })
    .select("id")
    .single();
  if (error) {
    if (pgCode(error) === "23505") return { outcome: "exists" };
    if (pgCode(error) === "P0001") return { outcome: "too_many" };
    throw error;
  }
  return { outcome: "ok", id: data.id };
}

export async function renameGroup(
  id: string,
  name: string,
): Promise<RenameOutcome> {
  const { data, error } = await createSupabaseServerClient()
    .from("player_groups")
    .update({ name })
    .eq("id", id)
    .select("id");
  if (error) {
    if (pgCode(error) === "23505") return "exists";
    throw error;
  }
  return data.length > 0 ? "ok" : "not_found";
}

/** Deleting a group never deletes its players. */
export async function deleteGroup(id: string): Promise<DeleteOutcome> {
  const { data, error } = await createSupabaseServerClient()
    .from("player_groups")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return data.length > 0 ? "ok" : "not_found";
}

/** Makes the group's members exactly `playerIds` (removes the extra, adds the new). */
export async function setGroupMembers(
  id: string,
  playerIds: readonly string[],
): Promise<SetMembersOutcome> {
  const supabase = createSupabaseServerClient();
  const { data: group, error: groupError } = await supabase
    .from("player_groups")
    .select("id, player_group_members(player_id)")
    .eq("id", id)
    .maybeSingle();
  if (groupError) throw groupError;
  if (!group) return "not_found";

  const current = new Set(group.player_group_members.map((m) => m.player_id));
  const wanted = new Set(playerIds);
  const toRemove = [...current].filter((p) => !wanted.has(p));
  const toAdd = [...wanted].filter((p) => !current.has(p));

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("player_group_members")
      .delete()
      .eq("group_id", id)
      .in("player_id", toRemove);
    if (error) throw error;
  }
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("player_group_members")
      .insert(toAdd.map((player_id) => ({ group_id: id, player_id })));
    if (error) {
      // RLS: one of the players is not yours (or the group vanished).
      if (pgCode(error) === "42501") return "not_found";
      throw error;
    }
  }
  return "ok";
}
