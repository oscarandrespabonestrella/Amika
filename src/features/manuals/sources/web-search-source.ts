import type { WebResult } from "../types";

export type WebSearchOptions = {
  /** Content language filter (`search_lang`), e.g. "es". */
  lang: string;
  /** 2-letter country code that biases the results, e.g. "ES". */
  country?: string;
  /** Maximum results (the API caps it at 20). */
  count?: number;
};

export type WebSearchErrorCode =
  | "not_configured" // no API key available
  | "unauthorized" // key rejected
  | "rate_limited"
  | "timeout"
  | "invalid_response"
  | "upstream";

export class WebSearchError extends Error {
  constructor(
    public readonly code: WebSearchErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "WebSearchError";
  }
}

/**
 * Port of a web search engine. Brave is the first adapter; a second one is a new file,
 * not a change to the service (same idea as `GameSource` for BoardGameGeek).
 */
export interface WebSearchSource {
  readonly id: string;
  isConfigured(): boolean;
  search(query: string, options: WebSearchOptions): Promise<WebResult[]>;
}
