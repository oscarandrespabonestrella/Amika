import "server-only";
import { z } from "zod";
import { serviceRoleKeySchema } from "./service-role-key";

/**
 * Server-only secrets. Never import this from client components.
 * Each secret is read (and validated) on its own, so a problem with one never
 * breaks code that only needs another: e.g. the games page only needs to know
 * whether the BGG token exists, not the Supabase service key.
 */

/** Needed only by privileged server code (webhooks, catalog imports, account deletion). */
export function getSupabaseServiceRoleKey(): string {
  return serviceRoleKeySchema.parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Optional on purpose: while BoardGameGeek's token is pending the app runs
 * without it and the BGG search shows an "unavailable" state.
 */
export function getBggApiToken(): string | undefined {
  return z
    .string()
    .min(1)
    .optional()
    .parse(process.env.BGG_API_TOKEN || undefined);
}
