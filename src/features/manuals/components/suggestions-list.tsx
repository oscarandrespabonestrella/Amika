"use client";

import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  reviewManualSuggestionAction,
  withdrawManualSuggestionAction,
  type ManualActionResult,
} from "../actions/manual-actions";
import type { SuggestionView } from "../services/manual-store";
import { DownloadLink } from "./download-link";
import { knownError } from "./error-text";
import { fileUrl, languageLabel } from "./format";

type Props = { items: SuggestionView[]; isAdmin: boolean };

function Item({ item, isAdmin }: { item: SuggestionView; isAdmin: boolean }) {
  const t = useTranslations("Manuals");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(work: () => Promise<ManualActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-col gap-1.5">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
        >
          <span className="[overflow-wrap:anywhere]">{item.title}</span>
          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
        </a>
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Badge
            variant={item.status === "pending" ? "outline" : "destructive"}
          >
            {item.status === "pending"
              ? t("proposals.pending")
              : t("proposals.rejected")}
          </Badge>
          {item.locale && (
            <Badge variant="outline" lang={item.locale}>
              {languageLabel(item.locale, locale)}
            </Badge>
          )}
          {item.isOfficial && (
            <Badge variant="secondary">{t("result.official")}</Badge>
          )}
          {item.publisher && <span>{item.publisher}</span>}
          <span>{t("result.source", { host: item.sourceHost })}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DownloadLink href={fileUrl.suggestion(item.id)} />
        {isAdmin && item.status === "pending" && (
          <>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() =>
                  reviewManualSuggestionAction({
                    id: item.id,
                    decision: "publish",
                  }),
                )
              }
            >
              {t("proposals.publish")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() =>
                  reviewManualSuggestionAction({
                    id: item.id,
                    decision: "reject",
                  }),
                )
              }
            >
              {t("proposals.reject")}
            </Button>
          </>
        )}
        {(isAdmin || (item.mine && item.status === "pending")) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => withdrawManualSuggestionAction(item.id))}
          >
            {t("proposals.withdraw")}
          </Button>
        )}
      </div>

      <div aria-live="polite" className="text-sm">
        {error && (
          <span role="alert" className="text-destructive">
            {t(`errors.${knownError(error)}`)}
          </span>
        )}
      </div>
    </li>
  );
}

/** Proposals of a game: the author's own, and for administrators the whole review queue. */
export function SuggestionsList({ items, isAdmin }: Props) {
  const t = useTranslations("Manuals");
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">
        {isAdmin ? t("proposals.reviewTitle") : t("proposals.title")}
      </h3>
      {!isAdmin && (
        <p className="text-sm text-muted-foreground">{t("proposals.hint")}</p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <Item key={item.id} item={item} isAdmin={isAdmin} />
        ))}
      </ul>
    </div>
  );
}
