/** The error codes the live match screen can show (keys of `Live.errors`). */
export const LIVE_ERROR_CODES = [
  "unauthenticated",
  "invalid",
  "failed",
  "not_found",
  "not_friend",
  "custom_game",
  "already_invited",
  "closed",
  "limit",
] as const;
export type LiveErrorCode = (typeof LIVE_ERROR_CODES)[number];

/** Anything unexpected is shown as the generic failure. */
export function toLiveError(code: string): LiveErrorCode {
  return (LIVE_ERROR_CODES as readonly string[]).includes(code)
    ? (code as LiveErrorCode)
    : "failed";
}
