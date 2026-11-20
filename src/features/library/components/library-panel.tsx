"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  removeLibraryItemAction,
  saveLibraryItemAction,
  type LibraryActionResult,
} from "../actions/library-actions";
import {
  LIBRARY_STATUSES,
  type LibraryInput,
  type LibraryStatus,
} from "../schemas";
import type { LibraryItem } from "../services/library-service";

type Props = { gameId: string; item: LibraryItem | null };
type ErrorCode = Extract<LibraryActionResult, { ok: false }>["error"];

const RATINGS = Array.from({ length: 10 }, (_, i) => i + 1);

export function LibraryPanel({ gameId, item }: Props) {
  const t = useTranslations("Game.library");
  const [error, setError] = useState<ErrorCode | null>(null);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [notesSaved, setNotesSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(changes: Omit<LibraryInput, "gameId">, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await saveLibraryItemAction({ gameId, ...changes });
      if (result.ok) after?.();
      else setError(result.error);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeLibraryItemAction(gameId);
      if (result.ok) {
        setConfirmRemove(false);
        setNotes("");
      } else {
        setError(result.error);
      }
    });
  }

  // Not in the library yet: the two ways of adding it, as one compact segmented row.
  if (!item) {
    return (
      <section aria-labelledby="library-title" className="flex flex-col gap-2">
        <h2 id="library-title" className="sr-only">
          {t("addTitle")}
        </h2>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1">
          {LIBRARY_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              disabled={pending}
              onClick={() => save({ status })}
              // Both options look the same: none is selected until the user picks one.
              className="min-h-10 rounded-lg px-3 text-sm text-foreground/80 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
            >
              {t(`add.${status}`)}
            </button>
          ))}
        </div>
        <Feedback error={error} />
      </section>
    );
  }

  return (
    <section aria-labelledby="library-title" className="flex flex-col gap-3">
      <h2 id="library-title" className="sr-only">
        {t("title")}
      </h2>

      <div className="flex gap-2">
        <div
          role="group"
          aria-label={t("status")}
          className="grid flex-1 grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1"
        >
          {LIBRARY_STATUSES.map((status: LibraryStatus) => (
            <button
              key={status}
              type="button"
              aria-pressed={item.status === status}
              disabled={pending}
              onClick={() => item.status !== status && save({ status })}
              className={cn(
                "min-h-10 rounded-lg px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
                item.status === status
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "text-foreground/80 hover:bg-muted hover:text-foreground",
              )}
            >
              {t(`statusOption.${status}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={t("favorite")}
          aria-pressed={item.isFavorite}
          disabled={pending}
          onClick={() => save({ isFavorite: !item.isFavorite })}
          className="grid size-12 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 aria-pressed:text-warning"
        >
          <Star
            className={cn("size-5", item.isFavorite && "fill-current")}
            aria-hidden
          />
        </button>
      </div>

      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <span>
            {t("rating")} · {t("notes")}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {item.rating ? t("ratingValue", { n: item.rating }) : ""}
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rating">{t("rating")}</Label>
            <NativeSelect
              id="rating"
              className="h-11 w-40"
              value={item.rating ?? ""}
              disabled={pending}
              onChange={(event) =>
                save({
                  rating:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                })
              }
            >
              <option value="">{t("noRating")}</option>
              {RATINGS.map((n) => (
                <option key={n} value={n}>
                  {t("ratingValue", { n })}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="library-notes">{t("notes")}</Label>
            <Textarea
              id="library-notes"
              rows={4}
              maxLength={2000}
              value={notes}
              placeholder={t("notesPlaceholder")}
              onChange={(event) => {
                setNotes(event.target.value);
                setNotesSaved(false);
              }}
            />
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-10"
                disabled={pending || notes.trim() === (item.notes ?? "")}
                onClick={() =>
                  save({ notes: notes.trim() === "" ? null : notes }, () =>
                    setNotesSaved(true),
                  )
                }
              >
                {pending ? t("saving") : t("saveNotes")}
              </Button>
              <span aria-live="polite" className="text-sm text-success">
                {notesSaved && t("saved")}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            {!confirmRemove ? (
              <Button
                type="button"
                variant="ghost"
                className="h-10"
                disabled={pending}
                onClick={() => setConfirmRemove(true)}
              >
                {t("remove")}
              </Button>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("removeConfirm")}
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-10"
                  disabled={pending}
                  onClick={remove}
                >
                  {t("removeYes")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  disabled={pending}
                  onClick={() => setConfirmRemove(false)}
                >
                  {t("removeNo")}
                </Button>
              </>
            )}
          </div>
        </div>
      </details>

      <Feedback error={error} />
    </section>
  );
}

function Feedback({ error }: { error: ErrorCode | null }) {
  const t = useTranslations("Game.library");
  return (
    <div aria-live="polite">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
