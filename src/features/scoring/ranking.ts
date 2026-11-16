// Pure: no React, no Supabase (safe for the browser too).

/** A sheet offered for a new match, as ranked by the database (`sheet_rankings`). */
export type RankedSheet = {
  id: string;
  isMine: boolean;
  verified: boolean;
  /** Wilson lower bound of the latest version's votes; 0 when nobody voted. */
  score: number;
  uses: number;
  updatedAt: string;
};

/**
 * The sheet to preselect for a new match. `sheets` arrive in ranking order
 * (verified, score, uses). In order of preference:
 * 1. the sheet the user used in their latest match, if it is still offered;
 * 2. the best-ranked community sheet that is verified or has a positive score;
 * 3. the user's own most recently updated sheet;
 * 4. the first community sheet, even unproven;
 * 5. none.
 */
export function pickDefaultSheet(
  sheets: readonly RankedSheet[],
  lastUsedSheetId: string | null,
): string | null {
  if (lastUsedSheetId !== null && sheets.some((s) => s.id === lastUsedSheetId))
    return lastUsedSheetId;

  const community = sheets.filter((s) => !s.isMine);
  const proven = community.find((s) => s.verified || s.score > 0);
  if (proven) return proven.id;

  const mine = sheets
    .filter((s) => s.isMine)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (mine.length > 0) return mine[0].id;

  return community[0]?.id ?? null;
}
