import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { displayNameFromClerk } from "./clerk-sync";

export type Profile = {
  id: string;
  display_name: string;
  locale: string;
  theme: "light" | "dark" | "system";
};

const COLUMNS = "id, display_name, locale, theme";

/**
 * Gives an unnamed profile the name Clerk has for the user (first and last name, else the
 * username). One Clerk call, and only when the name is empty; a failure keeps the profile
 * as it was. A user with no name anywhere stays unnamed.
 */
async function fillNameFromClerk(profile: Profile): Promise<Profile> {
  if (profile.display_name.trim() !== "") return profile;
  try {
    const user = await currentUser();
    const name = user
      ? displayNameFromClerk({
          id: user.id,
          first_name: user.firstName,
          last_name: user.lastName,
          username: user.username,
        })
      : "";
    if (!name) return profile;
    const { error } = await createSupabaseServerClient()
      .from("profiles")
      .update({ display_name: name })
      .eq("id", profile.id);
    if (error) {
      logger.error("profiles.fillName failed", error);
      return profile;
    }
    return { ...profile, display_name: name };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("profiles.fillName threw", error);
    return profile;
  }
}

/**
 * For the screens that show a person to others (friends): makes sure the signed-in user's
 * profile has a name, filling it from Clerk if it is still empty.
 */
export async function ensureDisplayName(): Promise<void> {
  const profile = await getOrCreateProfile();
  if (profile) await fillNameFromClerk(profile);
}

/**
 * Returns the signed-in user's profile, creating it on first access
 * (the Clerk `user.created` webhook is the other creation path).
 * Cached per request. Returns null when signed out or when the lookup fails:
 * the profile enriches the page but must never be able to break rendering.
 */
export const getOrCreateProfile = cache(async (): Promise<Profile | null> => {
  try {
    const { userId } = await auth();
    if (!userId) return null;

    const supabase = createSupabaseServerClient();

    const existing = await supabase
      .from("profiles")
      .select(COLUMNS)
      .eq("id", userId)
      .maybeSingle();
    if (existing.error) {
      logger.error("profiles.select failed", existing.error);
      return null;
    }
    if (existing.data) return existing.data as Profile;

    const created = await supabase
      .from("profiles")
      .upsert({ id: userId }, { onConflict: "id" })
      .select(COLUMNS)
      .single();
    if (created.error) {
      logger.error("profiles.create failed", created.error);
      return null;
    }
    // A lazily created profile has no name (the Clerk webhook, which would give it one, is
    // not always there): take it from Clerk once, now, so friends do not see "Someone".
    return fillNameFromClerk(created.data as Profile);
  } catch (error) {
    // auth() signals "this route is dynamic" by throwing: never swallow that.
    unstable_rethrow(error);
    logger.error("profiles.lookup threw", error);
    return null;
  }
});
