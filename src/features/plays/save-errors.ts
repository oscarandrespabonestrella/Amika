// Pure: maps what the database says when `save_play` fails to what we tell the user.

export type SaveError =
  "not_found" | "limit" | "players_limit" | "duplicate_player";

/**
 * - 23505: a player twice in one match (the unique `(play_id, player_id)`). The browser
 *   only imitates the database's name normalization, so two names it considers
 *   different ("Søren"/"Soren") can still be the same player here.
 * - P0001: a cap trigger; the roster cap ("too many players") is not the match cap.
 * - 42501 / 23503 / P0002: not visible or not yours.
 * Anything else is unexpected (null: the caller rethrows).
 */
export function mapSavePlayError(
  code: string | undefined,
  message: string | undefined,
): SaveError | null {
  if (code === "23505") return "duplicate_player";
  if (code === "P0001")
    return message === "too many players" ? "players_limit" : "limit";
  if (code === "42501" || code === "23503" || code === "P0002")
    return "not_found";
  return null;
}
