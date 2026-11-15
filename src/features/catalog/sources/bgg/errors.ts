export type BggErrorCode =
  | "not_configured" // no API token available
  | "unauthorized" // token rejected
  | "rate_limited" // BGG answered 429
  | "timeout"
  | "not_found"
  | "invalid_response" // unparsable / oversized / unexpected payload
  | "upstream"; // any other BGG failure

export class BggError extends Error {
  constructor(
    public readonly code: BggErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "BggError";
  }
}
