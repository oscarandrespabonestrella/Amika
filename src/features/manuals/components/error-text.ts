/** Error codes the manuals UI can show; each has a message in `Manuals.errors`. */
export type ManualErrorCode =
  | "unauthenticated"
  | "unavailable"
  | "rate_limited"
  | "quota_exhausted"
  | "failed"
  | "invalid"
  | "forbidden"
  | "limit"
  | "already_added"
  | "already_proposed"
  | "not_pdf"
  | "unreachable"
  | "quota"
  | "too_large"
  | "network"
  | "offlineUnsupported";

/** Codes outside the list (a future server error) fall back to the generic one. */
export function knownError(code: string): ManualErrorCode {
  const known: ManualErrorCode[] = [
    "unauthenticated",
    "unavailable",
    "rate_limited",
    "quota_exhausted",
    "failed",
    "invalid",
    "forbidden",
    "limit",
    "already_added",
    "already_proposed",
    "not_pdf",
    "unreachable",
    "quota",
    "too_large",
    "network",
    "offlineUnsupported",
  ];
  return (known as string[]).includes(code)
    ? (code as ManualErrorCode)
    : "failed";
}
