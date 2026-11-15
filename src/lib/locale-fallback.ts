/**
 * Picks the best row for a language: the requested locale, then the content's
 * original language, then English, then whatever exists.
 */
export function pickByLocale<T extends { locale: string }>(
  rows: T[],
  locale: string,
  originalLanguage = "en",
): T | null {
  for (const wanted of [locale, originalLanguage, "en"]) {
    const row = rows.find((r) => r.locale === wanted);
    if (row) return row;
  }
  return rows[0] ?? null;
}
