// Pure: safe for the browser. This only IMITATES `public.normalize_player_name` so the
// picker can tell that "ana " is the Ana already in the roster; the database decides.

/**
 * The identity of a player name: accents stripped, lower-cased, any run of whitespace
 * collapsed to one space, trimmed. "Ana", "ana ", " ANA" and "Aná" are one player.
 */
export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
