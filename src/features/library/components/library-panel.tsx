"use client";

import { BookmarkPlus, Star } from "lucide-react";
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

  const heading = (
    <h2
      id="library-title"
      className="flex items-center gap-2 text-lg font-semibold tracking-tight"
    >
      <BookmarkPlus className="size-5 text-primary" aria-hidden />
      {item ? t("title") : t("addTitle")}
    </h2>
  );

  // Not in the library yet: the two ways of adding it.
  if (!item) {
    return (
      <section
        aria-labelledby="library-title"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
      >
        {heading}
        <div className="flex flex-wrap gap-3">
          {LIBRARY_STATUSES.map((status) => (
            <Button
              key={status}
              type="button"
              size="lg"
              variant={status === "owned" ? "default" : "outline"}
              className="h-11"
              disabled={pending}
              onClick={() => save({ status })}
            >
              {t(`add.${status}`)}
            </Button>
          ))}
        </div>
        <Feedback error={error} />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="library-title"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5"
    >
      {heading}

      <div className="flex flex-col gap-2">
        <span id="status-label" className="text-sm font-medium">
          {t("status")}
        </span>
        <div
          role="group"
          aria-labelledby="status-label"
          className="grid grid-cols-2 gap-2"
        >
          {LIBRARY_STATUSES.map((status: LibraryStatus) => (
            <button
              key={status}
              type="button"
              aria-pressed={item.status === status}
              disabled={pending}
              onClick={() => item.status !== status && save({ status })}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
                item.status === status
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(`statusOption.${status}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <button
          type="button"
          aria-pressed={item.isFavorite}
          disabled={pending}
          onClick={() => save({ isFavorite: !item.isFavorite })}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
            item.isFavorite
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Star
            className={cn("size-4", item.isFavorite && "fill-current")}
            aria-hidden
          />
          {t("favorite")}
        </button>

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
                  event.target.value === "" ? null : Number(event.target.value),
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

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
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
