"use server";

import { auth } from "@clerk/nextjs/server";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { preferencesSchema } from "../schemas";

export type UpdatePreferencesResult =
  { ok: true } | { ok: false; error: "unauthenticated" | "invalid" | "failed" };

/** Persists theme/locale on the signed-in user's profile (RLS enforces ownership). */
export async function updatePreferences(
  input: unknown,
): Promise<UpdatePreferencesResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };

    const parsed = preferencesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };

    const { error } = await createSupabaseServerClient()
      .from("profiles")
      .upsert({ id: userId, ...parsed.data }, { onConflict: "id" });

    if (error) {
      logger.error("preferences.update failed", error);
      return { ok: false, error: "failed" };
    }
    return { ok: true };
  } catch (error) {
    logger.error("preferences.update threw", error);
    return { ok: false, error: "failed" };
  }
}
