/** A language code in the viewer's language ("es" -> "Spanish"); the raw code if unknown. */
export function languageLabel(code: string, uiLocale: string): string {
  try {
    return (
      new Intl.DisplayNames([uiLocale], { type: "language" }).of(code) ??
      code.toUpperCase()
    );
  } catch {
    return code.toUpperCase();
  }
}

/** [message key, value] for a byte count, in MB from 1 MB up and in KB below. */
export function sizeParts(bytes: number): ["size" | "sizeKb", string] {
  if (bytes >= 1024 * 1024) return ["size", (bytes / (1024 * 1024)).toFixed(1)];
  return ["sizeKb", String(Math.max(1, Math.round(bytes / 1024)))];
}

/** The proxy URL that streams a PDF, for a stored manual or a signed search result. */
export const fileUrl = {
  resource: (id: string) =>
    `/api/manuals/file?resource=${encodeURIComponent(id)}`,
  suggestion: (id: string) =>
    `/api/manuals/file?suggestion=${encodeURIComponent(id)}`,
  token: (token: string) =>
    `/api/manuals/file?token=${encodeURIComponent(token)}`,
};

/** Locale to store with a proposal: two letters, or null. */
export function proposalLocale(locale: string | null): string | null {
  const code = locale?.slice(0, 2).toLowerCase() ?? "";
  return /^[a-z]{2}$/.test(code) ? code : null;
}
