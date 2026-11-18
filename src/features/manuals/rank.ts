import { knownPublishers, publisherForHost } from "./publishers";
import type { GameIdentity, SearchLocale, WebResult } from "./types";
import { SEARCH_LOCALES } from "./types";
import { normalizeManualUrl } from "./url-safety";

// Turns raw search hits into a ranked list of CANDIDATES for the right game. Pure: no
// network, no database. Order of concerns: is it this game (and not an expansion or another
// game with a similar name)? is it a rulebook? who published it? in which language?

export type Candidate = WebResult & { queryLocale: SearchLocale };

export type Ranked = {
  /** Normalized https URL. */
  url: string;
  title: string;
  locale: string | null;
  publisher: string | null;
  host: string;
  isOfficial: boolean;
  score: number;
};

const LANGUAGE_BONUS: Record<string, number> = {
  es: 30,
  en: 20,
  fr: 10,
  de: 5,
};

// Sites that re-host other people's PDFs without permission: never offered.
const REHOST_HOSTS = [
  "scribd.com",
  "pdfcoffee.com",
  "dokumen.pub",
  "vdocuments.mx",
  "yumpu.com",
  "slideshare.net",
  "studylib.net",
  "docplayer.net",
  "docplayer.es",
  "issuu.com",
  "pdfslide.net",
  "fliphtml5.com",
  "anyflip.com",
];

const STOPWORDS = new Set([
  "the",
  "of",
  "and",
  "a",
  "an",
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "y",
  "le",
  "les",
  "des",
  "du",
  "et",
  "der",
  "die",
  "das",
  "und",
  "von",
]);

const RULES_WORDS =
  /\b(rules?|rulebook|regla|reglas|reglamento|regle|regles|reglement|spielregel\w*|spielanleitung|anleitung|manual|manuel|instrucciones|instructions?|notice|livret|regolamento)\b/;
const NOISE_WORDS =
  /\b(summary|resumen|cheat|cheatsheet|quick|reference|referencia|errata|faq|review|resena|scoresheet|score sheet|player aid|ayuda|aide|spielhilfe|catalog|catalogo|catalogue|flyer|press)\b/;
const EXPANSION_WORDS =
  /\b(expansion|expansiones|expansao|extension|extensions|erweiterung|uitbreiding)\b/;

export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower-case, no accents, only letters/digits separated by single spaces. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function containsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Every significant word of `name` appears in the text (or the glued form does: "7wonders"). */
function nameMatches(text: string, name: string): boolean {
  if (!name) return false;
  const tokens = name.split(" ");
  const significant = tokens.filter((t) => !STOPWORDS.has(t));
  const required = significant.length > 0 ? significant : tokens;
  if (required.every((t) => containsWords(text, t))) return true;
  const glued = name.replace(/ /g, "");
  return glued.length >= 5 && text.replace(/ /g, "").includes(glued);
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

export function isRehostHost(host: string): boolean {
  return REHOST_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

const LANG_FROM_WORDS: [SearchLocale, RegExp][] = [
  ["es", /\b(espanol|castellano|spanish|reglamento|reglas|instrucciones)\b/],
  ["fr", /\b(francais|french|regles|regle|livret|notice)\b/],
  [
    "de",
    /\b(deutsch|german|spielregel|spielregeln|anleitung|spielanleitung)\b/,
  ],
  ["en", /\b(english|rulebook)\b/],
];

/** Language of the DOCUMENT, from the strongest signal available. */
export function detectLocale(c: Candidate): string | null {
  const url = new URL(c.url);
  const path = safeDecode(url.pathname).toLowerCase();

  // 1. explicit hints: a language folder (/es/), a language suffix (_es.pdf), words
  for (const code of SEARCH_LOCALES) {
    if (
      new RegExp(`/${code}(?:[-_][a-z]{2})?/`).test(path) ||
      new RegExp(`[_.\\-]${code}\\.[a-z0-9]{2,4}$`).test(path)
    )
      return code;
  }
  const words = normalizeText(`${c.title} ${path}`);
  for (const [code, re] of LANG_FROM_WORDS) if (re.test(words)) return code;

  // 2. the language the engine detected for the page
  const reported = c.language?.toLowerCase().slice(0, 2);
  if (reported) return reported;

  // 3. the language the query asked for
  return c.queryLocale;
}

function languageRank(locale: string | null): number {
  const i = SEARCH_LOCALES.indexOf(locale as SearchLocale);
  return i === -1 ? SEARCH_LOCALES.length : i;
}

/** One entry per document; the copy with the better language evidence wins. */
function dedupe(cands: Candidate[]): Map<string, Candidate> {
  const byUrl = new Map<string, Candidate>();
  for (const c of cands) {
    const url = normalizeManualUrl(c.url);
    if (!url) continue;
    const next = { ...c, url };
    const prev = byUrl.get(url);
    if (
      !prev ||
      (next.language && !prev.language) ||
      (!!next.language === !!prev.language &&
        languageRank(next.queryLocale) < languageRank(prev.queryLocale))
    )
      byUrl.set(url, next);
  }
  return byUrl;
}

export function rankCandidates(
  cands: Candidate[],
  game: GameIdentity,
): Ranked[] {
  const variants = [
    ...new Set([game.name, ...game.altNames].map(normalizeText)),
  ].filter(Boolean);
  const own = new Set(variants);
  const related = game.relatedNames
    .map(normalizeText)
    .filter((n) => n.length >= 4 && !own.has(n));
  const gamePublishers = new Set(
    knownPublishers(game.publishers).map((p) => p.name),
  );

  const out: Ranked[] = [];
  for (const c of dedupe(cands).values()) {
    const host = hostOf(c.url);
    if (isRehostHost(host)) continue;

    const title = stripHtml(c.title);
    const titleText = normalizeText(title);
    const urlText = normalizeText(safeDecode(new URL(c.url).pathname));
    const all = `${titleText} ${urlText}`;

    const inTitle = variants.some((v) => nameMatches(titleText, v));
    const inUrl = variants.some((v) => nameMatches(urlText, v));
    if (!inTitle && !inUrl) continue; // not about this game

    let score = inTitle ? 50 : 30;
    if (
      variants.some((v) =>
        nameMatches(normalizeText(stripHtml(c.description)), v),
      )
    )
      score += 4;

    // an expansion or a sequel is a different document
    const ownNameHasExpansionWord = variants.some((v) =>
      EXPANSION_WORDS.test(v),
    );
    if (
      !game.isExpansion &&
      !ownNameHasExpansionWord &&
      EXPANSION_WORDS.test(all)
    )
      score -= 25;
    if (related.some((r) => nameMatches(all, r))) score -= 25;

    // another edition: a printed year far from the game's
    if (game.year) {
      const years = [...all.matchAll(/\b(19[5-9]\d|20[0-3]\d)\b/g)].map((m) =>
        Number(m[1]),
      );
      if (years.length > 0)
        score += years.some((y) => Math.abs(y - game.year!) <= 1) ? 4 : -6;
    }

    score += RULES_WORDS.test(all) ? 10 : -10;
    if (NOISE_WORDS.test(all)) score -= 8;
    if (/\.pdf$/i.test(new URL(c.url).pathname)) score += 8;

    const publisher = publisherForHost(host);
    if (publisher) {
      score += 25;
      if (gamePublishers.has(publisher)) score += 10;
    }

    const locale = detectLocale(c);
    score += LANGUAGE_BONUS[locale ?? ""] ?? 0;

    out.push({
      url: c.url,
      title: title.slice(0, 200) || host,
      locale,
      publisher,
      host,
      isOfficial: publisher !== null,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.url.length - b.url.length);
}
