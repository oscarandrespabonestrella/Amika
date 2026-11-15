import { describe, expect, it } from "vitest";
import { routing } from "./routing";
import en from "./messages/en.json";
import es from "./messages/es.json";
import fr from "./messages/fr.json";

const CATALOGS = { en, es, fr } as const;

type Json = string | { [key: string]: Json };

function flatten(node: Json, prefix = ""): Record<string, string> {
  if (typeof node === "string") return { [prefix]: node };
  return Object.entries(node).reduce<Record<string, string>>(
    (acc, [key, value]) => ({
      ...acc,
      ...flatten(value, prefix ? `${prefix}.${key}` : key),
    }),
    {},
  );
}

describe("i18n catalogs", () => {
  const reference = flatten(en);

  it("has a catalog for every configured locale", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...routing.locales].sort());
  });

  it.each(["es", "fr"] as const)(
    "%s has exactly the same keys as en",
    (locale) => {
      expect(Object.keys(flatten(CATALOGS[locale])).sort()).toEqual(
        Object.keys(reference).sort(),
      );
    },
  );

  it.each(["en", "es", "fr"] as const)("%s has no empty strings", (locale) => {
    const empty = Object.entries(flatten(CATALOGS[locale])).filter(
      ([, value]) => value.trim() === "",
    );
    expect(empty).toEqual([]);
  });
});
