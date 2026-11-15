"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { displayNameSchema } from "../schemas";

export type UpdateDisplayNameResult =
  { ok: true } | { ok: false; error: "unauthenticated" | "tooLong" | "failed" };

export async function updateDisplayName(
  input: unknown,
): Promise<UpdateDisplayNameResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };

    const parsed = displayNameSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "tooLong" };

    const { error } = await createSupabaseServerClient()
      .from("profiles")
      .upsert(
        { id: userId, display_name: parsed.data.displayName },
        { onConflict: "id" },
      );
    if (error) {
      logger.error("profiles.displayName failed", error);
      return { ok: false, error: "failed" };
    }
    revalidatePath("/", "layout"); // the name appears on several pages
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("profiles.displayName threw", error);
    return { ok: false, error: "failed" };
  }
}
