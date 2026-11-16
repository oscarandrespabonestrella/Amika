// Pure: safe for the browser. This only IMITATES `public.normalize_player_name` so the
// picker can tell that "ana " is the Ana already in the roster; the database decides.
// It must never be MORE aggressive than the database: it strips only the Latin combining
// diacritics (U+0300..U+036F), not every combining mark (a Devanagari or Thai vowel sign
// is part of the name). Letters like ø, ł, æ that unaccent folds are NOT folded here: the
// database then reports the clash (see mapSavePlayError).

/**
 * The identity of a player name: accents stripped, lower-cased, any run of whitespace
 * collapsed to one space, trimmed. "Ana", "ana ", " ANA" and "Aná" are one player.
 */
export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
