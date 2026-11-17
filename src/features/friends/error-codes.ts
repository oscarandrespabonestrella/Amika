/** The error codes the friends screens can show (keys of `Friends.errors`). */
export const FRIEND_ERROR_CODES = [
  "unauthenticated",
  "invalid",
  "own",
  "limit",
  "failed",
  "not_found",
  "not_friend",
  "custom_game",
  "already_invited",
  "closed",
] as const;
export type FriendErrorCode = (typeof FRIEND_ERROR_CODES)[number];

/** Anything unexpected is shown as the generic failure. */
export function toFriendError(code: string): FriendErrorCode {
  return (FRIEND_ERROR_CODES as readonly string[]).includes(code)
    ? (code as FriendErrorCode)
    : "failed";
}
