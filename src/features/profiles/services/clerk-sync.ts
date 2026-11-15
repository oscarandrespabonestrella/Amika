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

const PHOTO_BUCKET = "game-photos";

type Storage = ReturnType<typeof createSupabaseAdminClient>["storage"];

/** Every object path under `prefix` (Storage listing is not recursive). */
async function listAllPaths(
  storage: Storage,
  prefix: string,
): Promise<string[]> {
  const { data, error } = await storage
    .from(PHOTO_BUCKET)
    .list(prefix, { limit: 1000 });
  if (error) throw error;

  const paths: string[] = [];
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    // Folders come back without an id; files have one.
    if (entry.id) paths.push(path);
    else paths.push(...(await listAllPaths(storage, path)));
  }
  return paths;
}

/**
 * Deletes everything owned by a Clerk user: their files in Storage first
 * (rows cascade, files do not), then the profile row, which cascades to
 * library, custom games, photos... Idempotent: a retry after a partial
 * failure finishes the job. Extend as new user-owned data is added.
 */
export async function deleteUserData(userId: string) {
  const admin = createSupabaseAdminClient();

  const paths = await listAllPaths(admin.storage, userId);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage
      .from(PHOTO_BUCKET)
      .remove(paths.slice(i, i + 100));
    if (error) throw error;
  }

  const { error } = await admin.from("profiles").delete().eq("id", userId);
  if (error) throw error;
}
