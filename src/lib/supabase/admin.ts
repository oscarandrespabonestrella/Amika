import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env/public";
import { getSupabaseServiceRoleKey } from "@/lib/env/server";
import type { Database } from "./database.types";

/**
 * Privileged client that BYPASSES RLS. Only for trusted server code such as
 * verified webhooks and catalog imports. Never expose it to a user request
 * without checking authorization first.
 */
export function createSupabaseAdminClient() {
  return createClient<Database>(
    getPublicEnv().NEXT_PUBLIC_SUPABASE_URL,
    getSupabaseServiceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
