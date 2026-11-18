"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  importBggCollectionBatchAction,
  type ImportBatchActionResult,
} from "../actions/library-actions";
import { parseBggCollectionCsv, type CollectionRow } from "../bgg-collection";

const MAX_BYTES = 2 * 1024 * 1024;
const BATCH = 20; // BGG's per-request id limit

type Props = {
  /** False while the BGG token is pending: the card explains it instead. */
  available: boolean;
};

type FileError = "not_bgg" | "empty" | "too_many" | "tooBig" | "unreadable";
type ActionError = Extract<ImportBatchActionResult, { ok: false }>["error"];
type Totals = { added: number; existing: number; notFound: string[] };

const EMPTY_TOTALS: Totals = { added: 0, existing: 0, notFound: [] };

export function BggCollectionImport({ available }: Props) {
  const t = useTranslations("Library.bggImport");
  const inputId = useId();
  const [rows, setRows] = useState<CollectionRow[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [fileError, setFileError] = useState<FileError | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [remaining, setRemaining] = useState<CollectionRow[]>([]);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [running, startImport] = useTransition();

  function reset() {
    setRows(null);
    setSkipped(0);
    setFileError(null);
    setError(null);
    setRemaining([]);
    setTotals(EMPTY_TOTALS);
    setStarted(false);
    setFinished(false);
  }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    if (file.size > MAX_BYTES) return setFileError("tooBig");
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setFileError("unreadable");
    }
    const parsed = parseBggCollectionCsv(text);
    if (!parsed.ok) return setFileError(parsed.error);
    setRows(parsed.rows);
    setSkipped(parsed.skipped);
  }

  /** Sends the queue in sequential batches; stops (keeping the rest) on the first error. */
  function run(queue: CollectionRow[]) {
    setError(null);
    setStarted(true);
    setRemaining(queue);
    startImport(async () => {
      let left = queue;
      while (left.length > 0) {
        const batch = left.slice(0, BATCH);
        const result = await importBggCollectionBatchAction(
          batch.map(({ bggId, status, rating }) => ({ bggId, status, rating })),
        );
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const missing = new Set(result.failed);
        const names = batch
          .filter((row) => missing.has(row.bggId))
          .map((row) => row.name);
        setTotals((prev) => ({
          added: prev.added + result.added,
          existing: prev.existing + result.existing,
          notFound: [...prev.notFound, ...names],
        }));
        left = left.slice(batch.length);
        setRemaining(left);
      }
      setFinished(true);
    });
  }

  const total = rows?.length ?? 0;
  const done = total - remaining.length;
  const owned = rows?.filter((r) => r.status === "owned").length ?? 0;
  const paused = started && !running && !finished && remaining.length > 0;

  return (
    <section
      aria-labelledby="bgg-import-title"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
          <FileUp className="size-5" aria-hidden />
        </span>
        <div>
          <h2 id="bgg-import-title" className="font-semibold">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("body")}</p>
        </div>
      </div>

      {!available ? (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          {t("unavailable")}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              {t("choose")}
            </label>
            <input
              id={inputId}
              type="file"
              accept=".csv,text/csv"
              disabled={running}
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = ""; // allow picking the same file again
              }}
              className="text-sm file:mr-3 file:h-10 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:text-sm file:font-medium"
            />
            <p className="text-xs text-muted-foreground">{t("howTo")}</p>
          </div>

          <div aria-live="polite" className="flex flex-col gap-3">
            {fileError && (
              <p role="alert" className="text-sm text-destructive">
                {t(`fileErrors.${fileError}`)}
              </p>
            )}

            {rows && !started && (
              <>
                <p className="text-sm">
                  {t("preview", {
                    count: total,
                    owned,
                    previous: total - owned,
                  })}
                  {skipped > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      {t("skipped", { count: skipped })}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("keepsExisting")}
                </p>
                <Button
                  type="button"
                  size="lg"
                  className="h-11 self-start"
                  onClick={() => run(rows)}
                >
                  {t("import", { count: total })}
                </Button>
              </>
            )}

            {started && !finished && (
              <p className="flex items-center gap-2 text-sm">
                {running && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                {t("progress", { done, total })}
              </p>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t(`errors.${error}`)}
              </p>
            )}

            {paused && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 self-start"
                onClick={() => run(remaining)}
              >
                {t("continue", { count: remaining.length })}
              </Button>
            )}

            {finished && (
              <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
                <p className="text-sm font-medium">{t("doneTitle")}</p>
                <p className="text-sm">
                  {t("doneSummary", {
                    added: totals.added,
                    existing: totals.existing,
                  })}
                </p>
                {totals.notFound.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    <p>{t("notFound", { count: totals.notFound.length })}</p>
                    <p className="mt-1 text-xs">{totals.notFound.join(", ")}</p>
                  </div>
                )}
                <Link
                  href="/library"
                  className="self-start rounded-lg py-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("openLibrary")}
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
