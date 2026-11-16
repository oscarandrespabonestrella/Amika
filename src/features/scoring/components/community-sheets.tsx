"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { copySheetAction, type ScoringResult } from "../actions/sheet-actions";
import type { CommunitySheet } from "../services/community-service";

/** Votes, reports and use counts as small badges (never who wrote the sheet). */
export function SheetBadges({ sheet }: { sheet: CommunitySheet }) {
  const t = useTranslations("Community.badges");
  const unrated = sheet.upVotes + sheet.flagVotes === 0;
  return (
    <>
      {sheet.verified && <Badge>{t("verified")}</Badge>}
      {sheet.disabled && <Badge variant="destructive">{t("disabled")}</Badge>}
      {unrated ? (
        <Badge variant="outline">{t("unrated")}</Badge>
      ) : (
        <>
          <Badge variant="outline">{t("up", { n: sheet.upVotes })}</Badge>
          {sheet.flagVotes > 0 && (
            <Badge variant="outline">
              {t("flags", { n: sheet.flagVotes })}
            </Badge>
          )}
        </>
      )}
      {sheet.uses > 0 && (
        <Badge variant="outline">{t("uses", { n: sheet.uses })}</Badge>
      )}
    </>
  );
}

/** Other players' sheets for a game, best first, each one viewable and copyable. */
export function CommunitySheets({
  gameId,
  sheets,
}: {
  gameId: string;
  sheets: CommunitySheet[];
}) {
  const t = useTranslations("Community");
  const ts = useTranslations("Scoring");
  const router = useRouter();
  const [error, setError] = useState<
    Extract<ScoringResult, { ok: false }>["error"] | null
  >(null);
  const [pending, startTransition] = useTransition();

  function copy(sheetId: string) {
    setError(null);
    startTransition(async () => {
      const result = await copySheetAction(sheetId);
      if (result.ok) router.push(`/games/${gameId}/sheets/${result.sheetId}`);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={t("listLabel")} className="flex flex-col gap-3">
        {sheets.map((sheet) => (
          <li
            key={sheet.sheetId}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/games/${gameId}/sheets/${sheet.sheetId}`}
                className="inline-flex min-h-11 min-w-0 items-center rounded-md text-base font-semibold break-words text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {sheet.title}
              </Link>
              <Badge variant="secondary">{sheet.locale.toUpperCase()}</Badge>
              <SheetBadges sheet={sheet} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/games/${gameId}/sheets/${sheet.sheetId}`}
                className="inline-flex h-11 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {t("view")}
              </Link>
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                disabled={pending}
                onClick={() => copy(sheet.sheetId)}
              >
                {pending ? t("copying") : t("copy")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {ts(`errors.${error}`)}
          </p>
        )}
      </div>
    </div>
  );
}
