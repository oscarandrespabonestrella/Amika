import "server-only";
import { auth } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  display_name: string;
  locale: string;
  theme: "light" | "dark" | "system";
};

const COLUMNS = "id, display_name, locale, theme";

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
    return created.data as Profile;
  } catch (error) {
    // auth() signals "this route is dynamic" by throwing: never swallow that.
    unstable_rethrow(error);
    logger.error("profiles.lookup threw", error);
    return null;
  }
});
