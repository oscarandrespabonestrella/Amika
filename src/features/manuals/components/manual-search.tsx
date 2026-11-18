"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { searchManualsAction } from "../actions/manual-actions";
import type { ManualResult } from "../types";
import { knownError } from "./error-text";
import { ManualResultItem } from "./manual-result-item";

type Props = { gameId: string; gameName: string; isAdmin: boolean };

type View =
  | { kind: "idle" }
  | { kind: "results"; results: ManualResult[] }
  | { kind: "empty" }
  | { kind: "error"; code: string };

/** The «Buscar manual» button and its dialog. Only the game id leaves the browser. */
export function ManualSearch({ gameId, gameName, isAdmin }: Props) {
  const t = useTranslations("Manuals");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<View>({ kind: "idle" });

  function search() {
    startTransition(async () => {
      const outcome = await searchManualsAction({ gameId });
      if (outcome.ok) setView({ kind: "results", results: outcome.results });
      else if (outcome.error === "not_found") setView({ kind: "empty" });
      else setView({ kind: "error", code: outcome.error });
    });
  }

  function open() {
    dialog.current?.showModal();
    if (view.kind === "idle") search();
  }

  return (
    <>
      <Button type="button" onClick={open}>
        <Search aria-hidden />
        {t("search.button")}
      </Button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        // a click on the backdrop lands on the <dialog> element itself
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
        className="m-auto max-h-[85dvh] w-[min(44rem,calc(100vw-2rem))] rounded-2xl border border-border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <div className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {t("search.title", { game: gameName })}
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => dialog.current?.close()}
            >
              {t("search.close")}
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">{t("search.intro")}</p>

          <div aria-live="polite" className="flex flex-col gap-3">
            {pending && (
              <p className="text-muted-foreground">{t("search.searching")}</p>
            )}

            {!pending && view.kind === "results" && (
              <ul
                aria-label={t("search.results")}
                className="flex flex-col gap-3"
              >
                {view.results.map((result) => (
                  <ManualResultItem
                    key={result.url}
                    result={result}
                    gameId={gameId}
                    gameName={gameName}
                    isAdmin={isAdmin}
                  />
                ))}
              </ul>
            )}

            {!pending && view.kind === "empty" && (
              <div className="rounded-xl border border-dashed border-border p-4">
                <p className="font-medium">{t("search.emptyTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("search.emptyHint")}
                </p>
              </div>
            )}

            {!pending && view.kind === "error" && (
              <p role="alert" className="text-destructive">
                {view.code === "unavailable" && (
                  <span className="font-medium">
                    {t("search.unavailableTitle")}.{" "}
                  </span>
                )}
                {t(`errors.${knownError(view.code)}`)}
              </p>
            )}
          </div>

          {/* A finished search is cached for every user, so repeating it only helps after a
              failure that may pass (not after results, "nothing found", or a spent quota). */}
          {view.kind === "error" &&
            (view.code === "failed" || view.code === "rate_limited") && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={search}
                >
                  {t("search.retry")}
                </Button>
              </div>
            )}

          <p className="text-xs text-muted-foreground">
            {t("search.copyright")}
          </p>
        </div>
      </dialog>
    </>
  );
}
