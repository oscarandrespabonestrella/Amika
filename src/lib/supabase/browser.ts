import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env/public";
import type { Database } from "./database.types";

/**
 * Supabase client for the BROWSER, acting as the signed-in Clerk user.
 * `getToken` must return the Clerk session token (Clerk's `useSession().session.getToken`).
 * Only the publishable key is used here: RLS and bucket policies do the enforcing.
 */
export function createSupabaseBrowserClient(
  getToken: () => Promise<string | null>,
) {
  const env = getPublicEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { accessToken: getToken },
  );
}
