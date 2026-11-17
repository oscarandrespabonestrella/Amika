// Node only (used by scripts/build-reference-pack.mts): turns ranked games, their cover
// URLs and their vectors into the two files of the reference pack. Pure apart from the hash.
import { createHash } from "node:crypto";
import type { Vec } from "../embedding/rank";
import { encodePack } from "./format";
import type { PackManifest } from "./manifest";
import type { RankedRow } from "./csv";

export type PackEntry = {
  row: RankedRow;
  /** Full cover URL from BGG's API; null when the game has none. */
  coverUrl: string | null;
  /** The cover's CLIP vector; null when the cover could not be fetched or embedded. */
  vec: Vec | null;
};

export type SkippedEntry = {
  bggId: string;
  name: string;
  reason: "no cover" | "no vector";
};

/** Entries keep the order they are given in (rank order). Throws when nothing is usable. */
export function buildPack(entries: PackEntry[]): {
  manifest: PackManifest;
  bytes: Uint8Array;
  skipped: SkippedEntry[];
} {
  const skipped: SkippedEntry[] = [];
  const kept: { row: RankedRow; coverUrl: string; vec: Vec }[] = [];
  for (const e of entries) {
    if (!e.coverUrl)
      skipped.push({
        bggId: e.row.bggId,
        name: e.row.name,
        reason: "no cover",
      });
    else if (!e.vec)
      skipped.push({
        bggId: e.row.bggId,
        name: e.row.name,
        reason: "no vector",
      });
    else kept.push({ row: e.row, coverUrl: e.coverUrl, vec: e.vec });
  }
  if (kept.length === 0)
    throw new Error("empty pack: no game has a usable vector");

  const bytes = encodePack(kept.map((k) => k.vec));
  const hash8 = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  return {
    manifest: {
      version: hash8,
      model: "clip-vit-base-patch32",
      dim: 512,
      vectors: `vectors-${hash8}.bin`,
      games: kept.map((k) => ({
        bggId: k.row.bggId,
        name: k.row.name,
        year: k.row.year,
        rank: k.row.rank,
        coverUrl: k.coverUrl,
      })),
    },
    bytes,
    skipped,
  };
}
