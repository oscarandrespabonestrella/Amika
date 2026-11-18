// Shared types of the manual search. No server-only code here: the dialog imports it too.

/** Languages we search in, in priority order (the product rule: es, then en, fr, de). */
export const SEARCH_LOCALES = ["es", "en", "fr", "de"] as const;
export type SearchLocale = (typeof SEARCH_LOCALES)[number];

/** What the server knows about the game it is searching a manual for. Never from the client. */
export type GameIdentity = {
  id: string;
  /** Name in the viewer's language (or the best fallback). */
  name: string;
  /** Other known names (original, translations), used only to MATCH results. */
  altNames: string[];
  year: number | null;
  /** Publisher names from the catalog terms. */
  publishers: string[];
  /** Names of expansions of this game: a result about them is a different document. */
  relatedNames: string[];
  isExpansion: boolean;
};

/** A raw hit from the web search API. */
export type WebResult = {
  url: string;
  title: string;
  description: string;
  /** Page language as reported by the search engine, when it says. */
  language: string | null;
};

/** A verified rulebook PDF, ready for the dialog. */
export type ManualResult = {
  url: string;
  title: string;
  locale: string | null;
  publisher: string | null;
  sourceHost: string;
  isOfficial: boolean;
  sizeBytes: number | null;
  alreadyAdded: boolean;
  alreadyProposed: boolean;
  /** Signed, short-lived permission to download THIS url through our proxy. */
  downloadToken: string | null;
};

/** A verified result as kept in the shared cache: nothing that depends on who is asking. */
export type CachedResult = Omit<
  ManualResult,
  "alreadyAdded" | "alreadyProposed" | "downloadToken"
>;

export type ManualSearchError =
  | "unavailable" // no API key, or the key was rejected
  | "rate_limited"
  | "quota_exhausted" // the app's monthly cap on search API calls is used up
  | "not_found" // the search worked but nothing usable came out
  | "failed";

export type ManualSearchOutcome =
  | { ok: true; results: ManualResult[] }
  | { ok: false; error: ManualSearchError };
