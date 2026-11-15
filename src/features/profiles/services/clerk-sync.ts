import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ClerkUserData = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
};

const MAX_DISPLAY_NAME = 60;

export function displayNameFromClerk(user: ClerkUserData): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return (full || user.username || "").slice(0, MAX_DISPLAY_NAME);
}

/** Idempotent: a profile created earlier (lazily) is left untouched. */
export async function createProfileFromClerk(user: ClerkUserData) {
  const { error } = await createSupabaseAdminClient()
    .from("profiles")
    .upsert(
      { id: user.id, display_name: displayNameFromClerk(user) },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error) throw error;
}

/**
 * Deletes everything owned by a Clerk user (cascades from `profiles`).
 * Idempotent. Extend as new user-owned tables are added.
 */
export async function deleteUserData(userId: string) {
  const { error } = await createSupabaseAdminClient()
    .from("profiles")
    .delete()
    .eq("id", userId);
  if (error) throw error;
}
