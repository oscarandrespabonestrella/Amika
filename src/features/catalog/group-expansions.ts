import type { GameKind } from "./types";

export type ExpansionGroup<T extends { id: string; kind: GameKind }> = {
  item: T;
  /** Expansions that hang from `item`, in the order they came in. */
  expansions: T[];
};

/**
 * An expansion can point at several games (BGG lists sibling expansions and other editions of
 * the base). Picks the one it should hang from: a BASE game that is in the list. Anything else
 * (only expansions, or bases that are not in the list) gives no parent, so the expansion stays
 * at the top level instead of being nested under another expansion.
 */
export function pickExpansionParent(
  candidates: Iterable<string>,
  items: readonly { id: string; kind: GameKind }[],
): string | null {
  const baseIds = new Set(
    items.filter((item) => item.kind === "base").map((item) => item.id),
  );
  const wanted = new Set(candidates);
  // Respect the list order when several bases qualify.
  for (const item of items) {
    if (wanted.has(item.id) && baseIds.has(item.id)) return item.id;
  }
  return null;
}

/**
 * Groups a list of games so each expansion sits under its base game. An expansion is nested
 * only when its base game is ALSO in the list and is itself shown at the top level; anything
 * else (base missing, unknown, a chain of expansions) stays where it is so nothing disappears.
 * `parentOf` maps an expansion id to the id of the game it expands.
 */
export function groupExpansions<T extends { id: string; kind: GameKind }>(
  items: readonly T[],
  parentOf: ReadonlyMap<string, string>,
): ExpansionGroup<T>[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const nestedUnder = (item: T): string | null => {
    if (item.kind !== "expansion") return null;
    const parent = parentOf.get(item.id);
    if (!parent || parent === item.id) return null;
    const parentItem = byId.get(parent);
    // Only a top-level game can hold expansions (one level of nesting).
    return parentItem && nestedUnder(parentItem) === null ? parent : null;
  };

  const groups = new Map<string, ExpansionGroup<T>>();
  const order: ExpansionGroup<T>[] = [];
  for (const item of items) {
    if (nestedUnder(item) === null) {
      const group = { item, expansions: [] as T[] };
      groups.set(item.id, group);
      order.push(group);
    }
  }
  for (const item of items) {
    const parent = nestedUnder(item);
    if (parent !== null) groups.get(parent)?.expansions.push(item);
  }
  return order;
}
