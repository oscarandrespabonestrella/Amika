/** The error codes the night screens can show (keys of the nights errors messages). */
export const NIGHT_ERROR_CODES = [
  "unauthenticated",
  "invalid",
  "failed",
  "not_found",
  "not_friend",
  "closed",
  "already",
  "limit",
  "not_owned",
  "link_invalid",
  "rate_limited",
] as const;
export type NightErrorCode = (typeof NIGHT_ERROR_CODES)[number];

/** Anything unexpected is shown as the generic failure. */
export function toNightError(code: string): NightErrorCode {
  return (NIGHT_ERROR_CODES as readonly string[]).includes(code)
    ? (code as NightErrorCode)
    : "failed";
}

const PG_TO_ERROR: Record<string, NightErrorCode> = {
  GN001: "not_friend",
  GN002: "closed",
  GN003: "already",
  GN004: "limit",
  GN005: "link_invalid",
  GN006: "not_owned",
  P0002: "not_found",
  "42501": "not_found",
};

/** Postgres error code of the night functions to a screen error code. */
export function fromPgCode(code: string | undefined): NightErrorCode {
  return (code && PG_TO_ERROR[code]) || "failed";
}
