import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { type AppLocale, routing } from "./routing";

/** Narrows a route param to a supported locale, or renders the 404 page. */
export function assertLocale(value: string): AppLocale {
  if (!hasLocale(routing.locales, value)) notFound();
  return value;
}
