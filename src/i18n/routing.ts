import { defineRouting } from "next-intl/routing";

/**
 * To add a language: add its code here, a `messages/<code>.json` file,
 * its endonym in `locales.ts` and its Clerk localization in the locale layout.
 */
export const routing = defineRouting({
  locales: ["en", "es", "fr"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];
