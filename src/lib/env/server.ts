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
 * Optional: without it the manual search answers "unavailable" and nothing else breaks.
 * Brave Search API subscription token (server only).
 */
export function getBraveSearchApiKey(): string | undefined {
  return z
    .string()
    .min(1)
    .optional()
    .parse(process.env.BRAVE_SEARCH_API_KEY || undefined);
}

/**
 * Optional: the app's own monthly cap of search API calls (default 800, a margin under Brave's
 * 1000-request free plan). Raise it only if the plan does.
 */
export function getManualMonthlyCallLimit(): number {
  return z.coerce
    .number()
    .int()
    .min(1)
    .default(800)
    .parse(process.env.MANUAL_MONTHLY_CALL_LIMIT || undefined);
}

/**
 * Optional: signs the short-lived download links of manual search results. Without it only
 * manuals already stored in the database can be downloaded through the proxy.
 */
export function getManualLinkSecret(): string | undefined {
  return z
    .string()
    .min(32)
    .optional()
    .parse(process.env.MANUAL_LINK_SECRET || undefined);
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
