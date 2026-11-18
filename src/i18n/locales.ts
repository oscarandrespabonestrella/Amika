import type { AppLocale } from "./routing";

/** Each language is shown in its own language (endonym), never translated. */
export const LOCALE_NAMES: Record<AppLocale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  pt: "Português",
};
