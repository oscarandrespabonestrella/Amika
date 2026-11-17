import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GameKind } from "../types";

/**
 * For the expansions in a list, the id of the game each one expands (when that game is in the
 * catalog). Reads both sides of the relation: the expansion's own `expansion_of` and the base
 * game's `has_expansion`, and resolves games imported later through their external id.
 */
export async function findExpansionParents(
  games: readonly { id: string; kind: GameKind }[],
): Promise<Map<string, string>> {
  const parents = new Map<string, string>();
  const expansionIds = games
    .filter((g) => g.kind === "expansion")
    .map((g) => g.id);
  if (expansionIds.length === 0) return parents;
  const baseIds = games.filter((g) => g.kind === "base").map((g) => g.id);
  const supabase = createSupabaseServerClient();

  const [own, inverse] = await Promise.all([
    supabase
      .from("game_relations")
      .select("game_id, related_game_id, related_external_id")
      .eq("type", "expansion_of")
      .in("game_id", expansionIds),
    baseIds.length > 0
      ? supabase
          .from("game_relations")
          .select("game_id, related_game_id, related_external_id")
          .eq("type", "has_expansion")
          .in("game_id", baseIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (own.error) throw own.error;
  if (inverse.error) throw inverse.error;

  // Relations to games imported after the relation was stored: resolve by external id.
  const externalIds = [...(own.data ?? []), ...(inverse.data ?? [])]
    .filter((r) => !r.related_game_id && r.related_external_id)
    .map((r) => r.related_external_id as string);
  const resolved = new Map<string, string>();
  if (externalIds.length > 0) {
    const { data, error } = await supabase
      .from("game_external_ids")
      .select("game_id, external_id")
      .in("external_id", externalIds);
    if (error) throw error;
    for (const row of data ?? []) resolved.set(row.external_id, row.game_id);
  }
  const target = (r: {
    related_game_id: string | null;
    related_external_id: string | null;
  }) =>
    r.related_game_id ??
    (r.related_external_id ? resolved.get(r.related_external_id) : undefined);

  for (const r of own.data ?? []) {
    const parent = target(r);
    if (parent) parents.set(r.game_id, parent);
  }
  // has_expansion on the base game: related game is the expansion.
  for (const r of inverse.data ?? []) {
    const child = target(r);
    if (child && expansionIds.includes(child) && !parents.has(child))
      parents.set(child, r.game_id);
  }
  return parents;
}
