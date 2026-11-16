import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 7a-2 retired OCR and perceptual image hashes. Nothing under src/ or scripts/ may
// mention them again (the migrations and the decision records are not scanned: they are
// history). A hit usually means a half-removed feature or something quietly revived.
const RETIRED = [
  "tesseract",
  "dhash",
  "game_image_hashes",
  "match_game_images",
  "save_photo_hash",
  "upsert_cover_hash",
  "savePhotoHash",
  "saveCoverHash",
  "hashCover",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("retired recognition code", () => {
  const sources = ["src", "scripts"]
    .flatMap((d) => files(d))
    .filter((p) => /\.(tsx?|mts|mjs|cjs|json|css)$/.test(p));

  it.each(RETIRED)("%s appears nowhere in src/ or scripts/", (term) => {
    const hits = sources.filter((p) =>
      readFileSync(p, "utf8").toLowerCase().includes(term.toLowerCase()),
    );
    expect(hits).toEqual([]);
  });
});
