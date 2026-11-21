import { z } from "zod";
import {
  normalizePlayerName,
  PLAYER_NAME_MAX,
} from "@/features/players/client";

export const MAX_NAMES = 24;

/** The players at the table, saved on the device and shared by several tools. */
export const PLAYER_NAMES = z
  .array(z.string().min(1).max(PLAYER_NAME_MAX))
  .max(MAX_NAMES);
export const NO_NAMES: string[] = [];

/**
 * Adds `incoming` to `current`: trimmed, cut to the player-name limit, without
 * duplicates (same identity as the roster: "ana" = "Aná") and up to `max`.
 */
export function addNames(
  current: readonly string[],
  incoming: readonly string[],
  max: number = MAX_NAMES,
): string[] {
  const seen = new Set(current.map(normalizePlayerName));
  const out = [...current];
  for (const raw of incoming) {
    const name = raw.trim().slice(0, PLAYER_NAME_MAX);
    const key = normalizePlayerName(name);
    if (!key || seen.has(key) || out.length >= max) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
