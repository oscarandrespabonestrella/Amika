"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { ImportRelationButton } from "./import-relation-button";

export type ExpansionItem = {
  key: string;
  name: string;
  /** Local game id when it is already in the catalog. */
  gameId: string | null;
  externalId: string | null;
  /** The user has it in their library. */
  owned: boolean;
};

/** More than this and the list gets a filter and a "Show all" fold. */
const FOLD = 8;
const FILTER_FROM = 12;

/**
 * The expansions of a game, grouped under it: the ones in the user's library first, then the
 * rest of the catalog, with a filter and "Show all" for games that have hundreds (Catan).
 */
export function ExpansionsList({
  items,
  bggAvailable,
  onImported,
}: {
  items: readonly ExpansionItem[];
  bggAvailable: boolean;
  onImported?: (gameId: string) => Promise<{ ok: boolean }>;
}) {
  const t = useTranslations("Game");
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);

  if (items.length === 0)
    return <p className="text-muted-foreground">{t("expansionsTab.none")}</p>;

  const needle = query.trim().toLowerCase();
  const matching = items
    .filter((item) => item.name.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.owned) - Number(a.owned));
  const folded = !all && needle === "" && matching.length > FOLD;
  const shown = folded ? matching.slice(0, FOLD) : matching;

  return (
    <div className="flex flex-col gap-3">
      {items.length >= FILTER_FROM && (
        <label className="flex h-11 items-center gap-2 rounded-xl border border-input px-3 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="sr-only">{t("expansionsTab.filter")}</span>
          <input
            type="search"
            value={query}
            placeholder={t("expansionsTab.filter")}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </label>
      )}

      {shown.length === 0 ? (
        <p className="text-muted-foreground">{t("expansionsTab.noMatch")}</p>
      ) : (
        <ul
          aria-label={t("relations.has_expansion")}
          className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card"
        >
          {shown.map((item) => (
            <li
              key={item.key}
              className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
            >
              {item.gameId ? (
                <Link
                  href={`/games/${item.gameId}`}
                  className="min-w-0 flex-1 font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {item.name}
                </Link>
              ) : (
                <span className="min-w-0 flex-1">
                  {item.name}{" "}
                  <span className="text-sm text-muted-foreground">
                    ({t("notInCatalog")})
                  </span>
                </span>
              )}
              {item.owned && <Badge>{t("expansionsTab.owned")}</Badge>}
              {item.gameId && !item.owned && onImported && (
                <ImportRelationButton
                  gameId={item.gameId}
                  available
                  onImported={onImported}
                />
              )}
              {!item.gameId && item.externalId && (
                <ImportRelationButton
                  externalId={item.externalId}
                  available={bggAvailable}
                  onImported={onImported}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {(folded || (all && needle === "" && matching.length > FOLD)) && (
        <button
          type="button"
          onClick={() => setAll((value) => !value)}
          aria-expanded={all}
          className="inline-flex h-11 w-fit items-center rounded-lg px-1 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {all
            ? t("expansionsTab.showFewer")
            : t("expansionsTab.showAll", { count: matching.length })}
        </button>
      )}
    </div>
  );
}
