import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env/public";
import type { Database } from "./database.types";

/**
 * Supabase client acting as the signed-in Clerk user: RLS applies.
 * Create one per request; never cache it across requests.
 */
export function createSupabaseServerClient() {
  const env = getPublicEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      async accessToken() {
        return (await auth()).getToken();
      },
    },
  );
}
