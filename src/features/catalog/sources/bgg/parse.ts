import { XMLParser } from "fast-xml-parser";
import type {
  ExternalGame,
  ExternalRelation,
  ExternalSearchHit,
  ExternalTerm,
  TermType,
} from "../../types";
import { BggError } from "./errors";

/** Pure functions: XML text in, normalized domain objects out. No I/O. */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false, // keep text as text (a description like "2025" stays a string)
  processEntities: true,
  isArray: (name) => name === "item" || name === "name" || name === "link",
});

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const asNodes = (value: unknown): Node[] =>
  Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [];
const attr = (node: Node, name: string): string | undefined => {
  const value = node[`@_${name}`];
  return typeof value === "string" ? value : undefined;
};
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

function parseXml(xml: string): Node {
  if (xml.length > 2_000_000)
    throw new BggError("invalid_response", "response too large");
  try {
    const parsed: unknown = parser.parse(xml);
    return isNode(parsed) ? parsed : {};
  } catch {
    throw new BggError("invalid_response", "malformed XML");
  }
}

// --- text helpers -----------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  deg: "°",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  auml: "ä",
  aring: "å",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  oacute: "ó",
  ocirc: "ô",
  ouml: "ö",
  uacute: "ú",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  ntilde: "ñ",
  ccedil: "ç",
  szlig: "ß",
  Eacute: "É",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
};

/** BGG double-encodes descriptions (`&amp;#10;`): decode the second layer here. */
export function decodeHtmlEntities(input: string): string {
  return input.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
    (match, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body[1] === "x"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

function cleanDescription(raw: string | undefined): string | null {
  if (!raw) return null;
  const clean = decodeHtmlEntities(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20_000);
  return clean === "" ? null : clean;
}

const clamp = (value: string, max: number) => value.trim().slice(0, max);

function positiveInt(value: string | undefined, max: number): number | null {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 && n <= max ? n : null;
}

/** min must not exceed max, otherwise the database CHECK would reject the row. */
function range(
  min: number | null,
  max: number | null,
): [number | null, number | null] {
  return min !== null && max !== null && min > max ? [min, min] : [min, max];
}

function httpsUrl(value: string | undefined): string | null {
  const url = value?.trim();
  return url && url.length <= 500 && url.startsWith("https://") ? url : null;
}

// --- search -----------------------------------------------------------------

function primaryName(item: Node): string | null {
  const names = asNodes(item.name);
  const chosen = names.find((n) => attr(n, "type") === "primary") ?? names[0];
  const value = chosen && attr(chosen, "value");
  return value ? clamp(value, 200) || null : null;
}

export function parseSearchResponse(xml: string): ExternalSearchHit[] {
  const root = parseXml(xml);
  if (root.errors)
    throw new BggError("upstream", "BGG returned an error document");
  const items = asNodes(isNode(root.items) ? root.items.item : undefined);

  const hits: ExternalSearchHit[] = [];
  for (const item of items) {
    const externalId = attr(item, "id");
    const name = primaryName(item);
    if (!externalId || !/^\d{1,9}$/.test(externalId) || !name) continue;
    const year = attr(
      asNodes(item.yearpublished)[0] ?? (item.yearpublished as Node) ?? {},
      "value",
    );
    hits.push({
      source: "bgg",
      externalId,
      name,
      kind: attr(item, "type") === "boardgameexpansion" ? "expansion" : "base",
      yearPublished: yearOrNull(year),
    });
  }
  return hits;
}

function yearOrNull(value: string | undefined): number | null {
  if (value === undefined || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= 1000 && year <= 2100 ? year : null;
}

// --- thing ------------------------------------------------------------------

const TERM_BY_LINK: Record<string, { type: TermType; cap: number }> = {
  boardgamecategory: { type: "category", cap: 30 },
  boardgamemechanic: { type: "mechanic", cap: 30 },
  boardgamedesigner: { type: "designer", cap: 20 },
  boardgamepublisher: { type: "publisher", cap: 20 },
};

const valueOf = (item: Node, tag: string): string | undefined => {
  const node = item[tag];
  return isNode(node) ? attr(node, "value") : undefined;
};

export function parseThingResponse(xml: string): ExternalGame {
  const root = parseXml(xml);
  if (root.errors)
    throw new BggError("upstream", "BGG returned an error document");
  const item = asNodes(isNode(root.items) ? root.items.item : undefined)[0];
  if (!item) throw new BggError("not_found");
  return parseThingItem(item);
}

/**
 * Every valid item of a multi-id `thing` response. A malformed item is dropped (the caller
 * sees it missing) instead of failing the whole batch.
 */
export function parseThingItems(xml: string): ExternalGame[] {
  const root = parseXml(xml);
  if (root.errors)
    throw new BggError("upstream", "BGG returned an error document");
  const games: ExternalGame[] = [];
  for (const item of asNodes(
    isNode(root.items) ? root.items.item : undefined,
  )) {
    try {
      games.push(parseThingItem(item));
    } catch (error) {
      if (!(error instanceof BggError)) throw error;
    }
  }
  return games;
}

function parseThingItem(item: Node): ExternalGame {
  const externalId = attr(item, "id");
  const name = primaryName(item);
  if (!externalId || !/^\d{1,9}$/.test(externalId) || !name) {
    throw new BggError("invalid_response", "item without id or name");
  }

  const [minPlayers, maxPlayers] = range(
    positiveInt(valueOf(item, "minplayers"), 999),
    positiveInt(valueOf(item, "maxplayers"), 999),
  );
  const [minPlaytime, maxPlaytime] = range(
    positiveInt(valueOf(item, "minplaytime"), 10_000),
    positiveInt(valueOf(item, "maxplaytime"), 10_000),
  );
  const minAgeRaw = positiveInt(valueOf(item, "minage"), 99);

  const terms: ExternalTerm[] = [];
  const relations: ExternalRelation[] = [];
  const perType: Partial<Record<TermType, number>> = {};
  const seen = new Set<string>();

  for (const link of asNodes(item.link)) {
    const linkType = attr(link, "type") ?? "";
    const id = attr(link, "id");
    const value = attr(link, "value");
    if (!id || !/^\d{1,9}$/.test(id) || !value) continue;

    const termSpec = TERM_BY_LINK[linkType];
    if (termSpec) {
      const key = `${termSpec.type}:${id}`;
      const count = perType[termSpec.type] ?? 0;
      if (seen.has(key) || count >= termSpec.cap) continue;
      seen.add(key);
      perType[termSpec.type] = count + 1;
      terms.push({
        type: termSpec.type,
        externalId: id,
        name: clamp(value, 200),
      });
    } else if (linkType === "boardgameexpansion" && relations.length < 100) {
      const type =
        attr(link, "inbound") === "true" ? "expansion_of" : "has_expansion";
      const key = `${type}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relations.push({ type, externalId: id, name: clamp(value, 200) });
    }
  }

  return {
    source: "bgg",
    externalId,
    language: "en",
    kind: attr(item, "type") === "boardgameexpansion" ? "expansion" : "base",
    name,
    originalName: null,
    description: cleanDescription(text(item.description)),
    yearPublished: yearOrNull(valueOf(item, "yearpublished")),
    minPlayers,
    maxPlayers,
    minPlaytime,
    maxPlaytime,
    minAge: minAgeRaw,
    coverUrl: httpsUrl(text(item.image)) ?? httpsUrl(text(item.thumbnail)),
    terms,
    relations,
  };
}
