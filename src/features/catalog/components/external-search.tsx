"use client";

import { Globe, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import {
  importGameAction,
  searchExternalAction,
} from "../actions/catalog-actions";
import type { SearchHit } from "../services/import-service";

type Props = {
  /** Current text of the search box. The parent re-mounts this on change (key). */
  query: string;
  /** False while the BGG token is pending: the section explains it instead. */
  available: boolean;
  /**
   * Looks up which catalog games the user already has in their library. Injected by the
   * page (the library module depends on the catalog, not the other way round).
   */
  lookupLibrary?: (gameIds: string[]) => Promise<Record<string, LibraryMark>>;
};

type LibraryMark = { status: string };

const STORE_KEY = "games-external-search";

type ErrorCode =
  | "unauthenticated"
  | "invalid"
  | "unavailable"
  | "rate_limited"
  | "not_found"
  | "failed";

export function ExternalSearch({ query, available, lookupLibrary }: Props) {
  const t = useTranslations("Games");
  const tLibrary = useTranslations("Library.badge");
  const router = useRouter();
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [owned, setOwned] = useState<Record<string, LibraryMark>>({});
  const [error, setError] = useState<ErrorCode | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  const text = query.trim();
  const canSearch = available && text.length >= 2;

  // A failed lookup only loses the chips: the results themselves still show.
  const fetchMarks = useCallback(
    async (list: SearchHit[]): Promise<Record<string, LibraryMark>> => {
      const known = list.flatMap((h) => (h.gameId ? [h.gameId] : []));
      if (!lookupLibrary || known.length === 0) return {};
      return lookupLibrary(known).catch(() => ({}));
    },
    [lookupLibrary],
  );

  // Coming back to the page (back button, menu): show the last BGG results for this text.
  useEffect(() => {
    let cancelled = false;
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { query?: string; hits?: SearchHit[] };
      if (saved.query !== text || !Array.isArray(saved.hits)) return;
      const restored = saved.hits;
      // Library state may have changed since: refresh the chips, then show the results.
      void fetchMarks(restored).then((marks) => {
        if (cancelled) return;
        setOwned(marks);
        setHits(restored);
      });
    } catch {
      // Storage unavailable or corrupt: just start without results.
    }
    return () => {
      cancelled = true;
    };
  }, [text, fetchMarks]);

  function remember(list: SearchHit[]) {
    try {
      sessionStorage.setItem(
        STORE_KEY,
        JSON.stringify({ query: text, hits: list }),
      );
    } catch {
      // Not remembering is fine.
    }
  }

  function search() {
    startSearch(async () => {
      setError(null);
      const result = await searchExternalAction(text);
      if (result.ok) {
        setOwned(await fetchMarks(result.hits));
        setHits(result.hits);
        remember(result.hits);
      } else setError(result.error);
    });
  }

  function add(hit: SearchHit) {
    setAddingId(hit.externalId);
    startAdd(async () => {
      setError(null);
      const result = await importGameAction(hit.externalId);
      if (result.ok) {
        // It is in the catalog now: when the user comes back it shows "Open", not "Add".
        if (hits) {
          remember(
            hits.map((h) =>
              h.externalId === hit.externalId
                ? { ...h, gameId: result.gameId }
                : h,
            ),
          );
        }
        router.push(`/games/${result.gameId}`);
      } else {
        setAddingId(null);
        setError(result.error);
      }
    });
  }

  return (
    <section
      aria-labelledby="bgg-title"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
          <Globe className="size-5" aria-hidden />
        </span>
        <div>
          <h2 id="bgg-title" className="font-semibold">
            {t("bgg.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("bgg.body")}</p>
        </div>
      </div>

      {!available ? (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          {t("bgg.unavailable")}
        </p>
      ) : (
        <>
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="h-11 self-start"
            disabled={!canSearch || searching}
            onClick={search}
          >
            {searching ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                {t("bgg.searching")}
              </>
            ) : (
              t("bgg.button", { query: text || "…" })
            )}
          </Button>
          {!canSearch && (
            <p className="text-sm text-muted-foreground">
              {t("bgg.needsQuery")}
            </p>
          )}
        </>
      )}

      <div aria-live="polite" className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${error}`)}
          </p>
        )}

        {hits && hits.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("bgg.none")}</p>
        )}

        {hits && hits.length > 0 && (
          <>
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("bgg.results")}
            </h3>
            <ul className="flex flex-col gap-2">
              {hits.map((hit) => (
                <li
                  key={hit.externalId}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-medium">{hit.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                      {hit.yearPublished && <span>{hit.yearPublished}</span>}
                      {hit.kind === "expansion" && (
                        <Badge variant="secondary">{t("kind.expansion")}</Badge>
                      )}
                      {hit.gameId && owned[hit.gameId] && (
                        <Badge
                          variant={
                            owned[hit.gameId].status === "owned"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {tLibrary(
                            owned[hit.gameId].status === "owned"
                              ? "owned"
                              : "previously_owned",
                          )}
                        </Badge>
                      )}
                    </span>
                  </span>
                  {hit.gameId ? (
                    <Link
                      href={`/games/${hit.gameId}`}
                      className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t("bgg.open")}
                    </Link>
                  ) : (
                    <Button
                      type="button"
                      className="h-10 shrink-0"
                      disabled={adding}
                      onClick={() => add(hit)}
                    >
                      {addingId === hit.externalId
                        ? t("bgg.adding")
                        : t("bgg.add")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t("bgg.attribution")}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
