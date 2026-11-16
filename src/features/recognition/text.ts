// Pure: no imports. Text helpers for matching OCR output against game titles.

const MAX_LINE = 80;
const MIN_CONFIDENCE = 50;
const MIN_ALNUM = 3;

/** Accent-free, lower-case, letters and digits separated by single spaces. */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  return set;
}

/** 0–1 trigram (Jaccard) similarity of two titles after normalization; 0 if either is empty. */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  const ta = trigrams(na);
  const tb = trigrams(nb);
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / (ta.size + tb.size - common);
}

export type OcrLine = { text: string; confidence: number; height: number };

const alnumCount = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;

/**
 * Keeps the lines worth searching for: confident enough, with real letters or digits,
 * at most 80 characters, no duplicates (by normalized text), biggest print first.
 */
export function cleanOcrLines(lines: OcrLine[], max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const ranked = lines
    .filter(
      (l) => l.confidence >= MIN_CONFIDENCE && alnumCount(l.text) >= MIN_ALNUM,
    )
    .sort((a, b) => b.height - a.height || b.confidence - a.confidence);
  for (const l of ranked) {
    const text = l.text.trim().slice(0, MAX_LINE).trim();
    const key = normalizeTitle(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}
