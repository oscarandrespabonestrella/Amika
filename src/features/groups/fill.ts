import { normalizePlayerName } from "../players/normalize";

export type FillRow = { playerId: string | null; name: string };
export type GroupMember = { id: string; name: string };

export type GroupFill = {
  /** Empty rows that take a member, in row order. */
  fillIndexes: { rowIndex: number; member: GroupMember }[];
  /** Members that need a new row. */
  append: GroupMember[];
};

/**
 * What adding a group does to a match's rows: members already present (same player, or
 * a typed name that normalizes the same) are skipped; the rest go into the empty rows
 * first (no player and no name), then into new rows. Pure: it never changes the group.
 */
export function groupFill(
  rows: readonly FillRow[],
  members: readonly GroupMember[],
): GroupFill {
  const presentIds = new Set(
    rows.map((r) => r.playerId).filter((id): id is string => id !== null),
  );
  const presentNames = new Set(
    rows
      .filter((r) => r.name.trim() !== "")
      .map((r) => normalizePlayerName(r.name)),
  );
  const missing = members.filter(
    (m) =>
      !presentIds.has(m.id) && !presentNames.has(normalizePlayerName(m.name)),
  );
  const emptyRows = rows.flatMap((r, rowIndex) =>
    r.playerId === null && r.name.trim() === "" ? [rowIndex] : [],
  );

  return {
    fillIndexes: emptyRows
      .slice(0, missing.length)
      .map((rowIndex, i) => ({ rowIndex, member: missing[i] })),
    append: missing.slice(emptyRows.length),
  };
}
