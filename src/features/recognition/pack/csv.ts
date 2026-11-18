// Pure. Reads BoardGameGeek's `boardgames_ranks.csv` data dump (ID, Name, Year, Rank, …).
// Relative (not "@/"): the pack scripts run this file outside the bundler's alias.
import { parseCsvRecords } from "../../../lib/csv";

export type RankedRow = {
  bggId: string;
  name: string;
  year: number | null;
  rank: number;
};

/** The rows ranked 1..count, sorted by rank. Rows without a rank or a numeric id are dropped. */
export function parseRanksCsv(text: string, count: number): RankedRow[] {
  if (count <= 0) return [];
  const [header, ...records] = parseCsvRecords(text);
  if (!header) return [];
  const col = (name: string) => header.indexOf(name);
  const [iId, iName, iYear, iRank] = ["ID", "Name", "Year", "Rank"].map(col);
  if (iId < 0 || iName < 0 || iRank < 0) return [];

  const rows: RankedRow[] = [];
  for (const r of records) {
    const bggId = r[iId]?.trim() ?? "";
    const name = r[iName]?.trim() ?? "";
    const rank = Number(r[iRank]);
    if (!/^\d{1,9}$/.test(bggId) || !name) continue;
    if (!Number.isInteger(rank) || rank < 1 || rank > count) continue;
    const year = iYear >= 0 ? Number(r[iYear]) : 0;
    rows.push({
      bggId,
      name,
      year: Number.isInteger(year) && year !== 0 ? year : null,
      rank,
    });
  }
  return rows.sort((a, b) => a.rank - b.rank);
}
