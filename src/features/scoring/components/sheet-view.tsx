"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { copySheetAction, type ScoringResult } from "../actions/sheet-actions";
import type { CommunitySheet } from "../services/community-service";
import type { SheetDetail } from "../services/sheet-service";
import { SheetBadges } from "./community-sheets";
import { ScorePreview } from "./score-preview";

/**
 * A sheet that is not the viewer's: read-only, with a "try it" preview and a Copy
 * button. Never shows who wrote it.
 */
export function SheetView({
  gameId,
  sheet,
  stats,
}: {
  gameId: string;
  sheet: SheetDetail;
  stats: CommunitySheet | null;
}) {
  const t = useTranslations("Community.sheetView");
  const tc = useTranslations("Community");
  const tt = useTranslations("Scoring.types");
  const ts = useTranslations("Scoring");
  const router = useRouter();
  const [error, setError] = useState<
    Extract<ScoringResult, { ok: false }>["error"] | null
  >(null);
  const [pending, startTransition] = useTransition();

  function copy() {
    setError(null);
    startTransition(async () => {
      const result = await copySheetAction(sheet.id);
      if (result.ok) router.push(`/games/${gameId}/sheets/${result.sheetId}`);
      else setError(result.error);
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link
        href={`/games/${gameId}/sheets`}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>

      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight break-words">
          {sheet.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {t("version", { n: sheet.latestVersion })}
          </Badge>
          <Badge variant="secondary">{sheet.locale.toUpperCase()}</Badge>
          {stats ? (
            <SheetBadges sheet={stats} />
          ) : (
            sheet.verified && <Badge>{tc("badges.verified")}</Badge>
          )}
        </div>
        <p className="text-muted-foreground">{t("readOnly")}</p>
        {sheet.disabled && (
          <p role="status" className="text-sm text-destructive">
            {t("disabledNote")}
          </p>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        {!sheet.disabled && (
          <Button
            type="button"
            className="h-11 px-5"
            disabled={pending}
            onClick={copy}
          >
            {pending ? tc("copying") : tc("copy")}
          </Button>
        )}
        <div aria-live="polite">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {ts(`errors.${error}`)}
            </p>
          )}
        </div>
      </div>

      <section
        aria-labelledby="view-categories"
        className="flex flex-col gap-3"
      >
        <h2
          id="view-categories"
          className="text-lg font-semibold tracking-tight"
        >
          {t("categories")}
        </h2>
        <ul className="flex flex-col gap-2">
          {sheet.definition.categories.map((category) => (
            <li
              key={category.key}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2"
            >
              <span className="min-w-0 font-medium break-words">
                {category.label}
              </span>
              <Badge variant="outline">{tt(category.type)}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <ScorePreview definition={sheet.definition} />
    </div>
  );
}
