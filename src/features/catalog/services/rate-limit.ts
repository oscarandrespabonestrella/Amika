/**
 * Per-user limit on calls to the external source (pure rules; the usage log
 * itself lives in Postgres, see catalog-store.ts). It is a soft limit: two
 * simultaneous requests can both pass the check.
 */
export const LIMITS = { perMinute: 10, perHour: 60 } as const;

export type Usage = { lastMinute: number; lastHour: number };

export function isOverLimit(usage: Usage): boolean {
  return (
    usage.lastMinute >= LIMITS.perMinute || usage.lastHour >= LIMITS.perHour
  );
}
