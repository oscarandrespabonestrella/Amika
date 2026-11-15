/** A game as returned by an external source, normalized (see sources/). */
export type ExternalSource = "bgg";
export type GameKind = "base" | "expansion";
export const TERM_TYPES = [
  "category",
  "mechanic",
  "designer",
  "publisher",
] as const;
export type TermType = (typeof TERM_TYPES)[number];
export type RelationType = "expansion_of" | "has_expansion";

export type ExternalSearchHit = {
  source: ExternalSource;
  externalId: string;
  name: string;
  kind: GameKind;
  yearPublished: number | null;
};

export type ExternalTerm = { type: TermType; externalId: string; name: string };
export type ExternalRelation = {
  type: RelationType;
  externalId: string;
  name: string;
};

export type ExternalGame = {
  source: ExternalSource;
  externalId: string;
  language: string;
  kind: GameKind;
  name: string;
  originalName: string | null;
  description: string | null;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlaytime: number | null;
  maxPlaytime: number | null;
  minAge: number | null;
  coverUrl: string | null;
  terms: ExternalTerm[];
  relations: ExternalRelation[];
};

/** Row shown in search results. */
export type GameSummary = {
  id: string;
  name: string;
  kind: GameKind;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlaytime: number | null;
  maxPlaytime: number | null;
  coverUrl: string | null;
  isCustom: boolean;
};
