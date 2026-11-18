/**
 * Limits on the paid / network-heavy calls of the manual search (pure rules; the usage log lives
 * in Postgres, see manual-store.ts). Soft limits: two simultaneous requests can both pass the
 * check, which is fine for a cost guard.
 *
 * The search API has a monthly quota (Brave's free plan: 1000 requests). One search costs
 * several API calls (one per language plus the publisher's site), so three things protect it:
 * a shared cache per game (see manual-search-service.ts), a per-user limit, and a global monthly
 * cap that stops the search BEFORE the provider's own limit is reached.
 */
export const SEARCH_LIMITS = { perMinute: 3, perDay: 10 } as const;
export const DOWNLOAD_LIMITS = { perHour: 20 } as const;

/** Default global cap of API calls per calendar month (UTC): a margin under a 1000-call plan. */
export const DEFAULT_MONTHLY_CALL_LIMIT = 800;

export type SearchUsage = { lastMinute: number; lastDay: number };

export function isSearchOverLimit(usage: SearchUsage): boolean {
  return (
    usage.lastMinute >= SEARCH_LIMITS.perMinute ||
    usage.lastDay >= SEARCH_LIMITS.perDay
  );
}

export function isDownloadOverLimit(lastHour: number): boolean {
  return lastHour >= DOWNLOAD_LIMITS.perHour;
}

/** True when making `calls` more API calls would pass the monthly cap. */
export function wouldExceedBudget(
  usedThisMonth: number,
  calls: number,
  limit: number,
): boolean {
  return usedThisMonth + calls > limit;
}

/** First instant of the current calendar month, UTC (the quota window). */
export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
