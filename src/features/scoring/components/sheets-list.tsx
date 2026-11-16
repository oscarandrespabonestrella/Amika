"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import {
  copySheetAction,
  deleteSheetAction,
  type ScoringResult,
} from "../actions/sheet-actions";
import type { SheetSummary } from "../services/sheet-service";
import { PublishToggle } from "./publish-toggle";

type ErrorCode = Extract<ScoringResult, { ok: false }>["error"];

export function SheetsList({
  gameId,
  sheets,
  canPublish,
}: {
  gameId: string;
  sheets: SheetSummary[];
  /** False when the game is the user's own custom game: its sheets stay private. */
  canPublish: boolean;
}) {
  const t = useTranslations("Scoring");
  const tb = useTranslations("Community.badges");
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function copy(sheet: SheetSummary) {
    setError(null);
    startTransition(async () => {
      const result = await copySheetAction(sheet.id);
      if (result.ok) router.push(`/games/${gameId}/sheets/${result.sheetId}`);
      else setError(result.error);
    });
  }

  function remove(sheet: SheetSummary) {
    setError(null);
    startTransition(async () => {
      const result = await deleteSheetAction(sheet.id);
      if (result.ok) setConfirming(null);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={t("listLabel")} className="flex flex-col gap-3">
        {sheets.map((sheet) => (
          <li
            key={sheet.id}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/games/${gameId}/sheets/${sheet.id}`}
                className="inline-flex min-h-11 min-w-0 items-center rounded-md text-base font-semibold break-words text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {sheet.title}
              </Link>
              <Badge variant="secondary">
                {t("version", { n: sheet.latestVersion })}
              </Badge>
              <Badge variant="outline">{sheet.locale.toUpperCase()}</Badge>
              <Badge variant="outline">
                {tb(sheet.visibility === "public" ? "public" : "private")}
              </Badge>
              {sheet.verified && <Badge>{tb("verified")}</Badge>}
              {sheet.disabled && (
                <Badge variant="destructive">{tb("disabled")}</Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {confirming === sheet.id ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("deleteConfirm")}
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() => remove(sheet)}
                  >
                    {t("deleteYes")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() => setConfirming(null)}
                  >
                    {t("deleteNo")}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() => copy(sheet)}
                  >
                    {pending ? t("copying") : t("copy")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() => setConfirming(sheet.id)}
                  >
                    {t("delete")}
                  </Button>
                </>
              )}
            </div>
            <PublishToggle
              sheetId={sheet.id}
              visibility={sheet.visibility}
              canPublish={canPublish}
            />
          </li>
        ))}
      </ul>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${error}`)}
          </p>
        )}
      </div>
    </div>
  );
}
