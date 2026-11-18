import { knownPublishers } from "./publishers";
import type { GameIdentity, SearchLocale } from "./types";
import { SEARCH_LOCALES } from "./types";

// One query per language (es, en, fr, de) plus one aimed at the game's own publisher.
// Brave supports the `filetype:` and `site:` operators; results are verified afterwards
// anyway, so an engine that ignores an operator only costs a few discarded hits.

export type ManualQuery = {
  q: string;
  /** `search_lang` for the engine. */
  lang: SearchLocale;
  country: string;
  /** Language this query was meant to find. */
  locale: SearchLocale;
  /** True for the publisher-site query. */
  official: boolean;
};

const RULE_WORDS: Record<SearchLocale, string> = {
  es: "reglamento",
  en: "rulebook",
  fr: "règles",
  de: "Spielregeln",
};

const COUNTRY: Record<SearchLocale, string> = {
  es: "ES",
  en: "US",
  fr: "FR",
  de: "DE",
};

const MAX_SITES = 5;

/** A name safe to put inside quotes in a query. */
function quoted(name: string): string {
  return `"${name.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}"`;
}

export function buildQueries(game: GameIdentity): ManualQuery[] {
  const name = quoted(game.name);
  const queries: ManualQuery[] = SEARCH_LOCALES.map((locale) => ({
    q: `${name} ${RULE_WORDS[locale]} filetype:pdf`,
    lang: locale,
    country: COUNTRY[locale],
    locale,
    official: false,
  }));

  const sites = knownPublishers(game.publishers)
    .flatMap((p) => p.domains)
    .slice(0, MAX_SITES);
  if (sites.length > 0) {
    queries.push({
      q: `${name} (reglamento OR rulebook OR règles OR Spielregeln) filetype:pdf (${sites
        .map((s) => `site:${s}`)
        .join(" OR ")})`,
      lang: "es",
      country: "ES",
      locale: "es",
      official: true,
    });
  }
  return queries;
}
