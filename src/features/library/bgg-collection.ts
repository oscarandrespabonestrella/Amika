// Pure. Reads the CSV that BoardGameGeek exports from a user's collection
// (Collection → Export). Runs in the browser: the file is never uploaded.
import { parseCsvRecords } from "@/lib/csv";
import type { LibraryStatus } from "./schemas";

export type CollectionRow = {
  bggId: string;
  name: string;
  status: LibraryStatus;
  rating: number | null;
};

export type CollectionParse =
  | { ok: true; rows: CollectionRow[]; skipped: number }
  | { ok: false; error: "not_bgg" | "empty" | "too_many" };

export const MAX_COLLECTION_ROWS = 2000;

const REQUIRED = ["objectid", "objectname", "own", "prevowned"] as const;

/** 7.5 → 8; 0 / blank / "N/A" → no rating. */
function toRating(raw: string | undefined): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(10, Math.max(1, Math.round(value)));
}

export function parseBggCollectionCsv(text: string): CollectionParse {
  const [header, ...records] = parseCsvRecords(text.replace(/^﻿/, ""));
  if (!header) return { ok: false, error: "empty" };

  const names = header.map((h) => h.trim().toLowerCase());
  const col = (name: string) => names.indexOf(name);
  const [iId, iName, iOwn, iPrev] = REQUIRED.map(col);
  if ([iId, iName, iOwn, iPrev].some((i) => i < 0)) {
    return { ok: false, error: "not_bgg" };
  }
  const iRating = col("rating");

  const rows: CollectionRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of records) {
    const bggId = r[iId]?.trim() ?? "";
    const name = r[iName]?.trim() ?? "";
    if (!/^\d{1,9}$/.test(bggId) || !name || seen.has(bggId)) {
      skipped++;
      continue;
    }
    const status: LibraryStatus | null =
      r[iOwn]?.trim() === "1"
        ? "owned"
        : r[iPrev]?.trim() === "1"
          ? "previously_owned"
          : null;
    if (!status) {
      skipped++; // wishlist / want-only rows: the app has no wishlist
      continue;
    }
    seen.add(bggId);
    rows.push({
      bggId,
      name,
      status,
      rating: iRating >= 0 ? toRating(r[iRating]) : null,
    });
  }

  if (rows.length === 0) return { ok: false, error: "empty" };
  if (rows.length > MAX_COLLECTION_ROWS) {
    return { ok: false, error: "too_many" };
  }
  return { ok: true, rows, skipped };
}
