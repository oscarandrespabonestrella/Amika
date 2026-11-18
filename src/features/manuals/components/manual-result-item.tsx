"use client";

import { ExternalLink, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  proposeManualAction,
  type ManualActionResult,
} from "../actions/manual-actions";
import type { ManualResult } from "../types";
import { DownloadLink } from "./download-link";
import { knownError } from "./error-text";
import { fileUrl, languageLabel, proposalLocale, sizeParts } from "./format";
import { SaveOfflineButton } from "./save-offline-button";

type Props = {
  result: ManualResult;
  gameId: string;
  gameName: string;
  isAdmin: boolean;
};

type Added = "no" | "added" | "proposed";

export function ManualResultItem({ result, gameId, gameName, isAdmin }: Props) {
  const t = useTranslations("Manuals");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState<Added>(
    result.alreadyAdded ? "added" : result.alreadyProposed ? "proposed" : "no",
  );
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"added" | "proposed" | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const outcome: ManualActionResult = await proposeManualAction({
        gameId,
        url: result.url,
        title: result.title,
        locale: proposalLocale(result.locale),
      });
      if (outcome.ok) {
        const state = outcome.published ? "added" : "proposed";
        setAdded(state);
        setFeedback(state);
      } else if (outcome.error === "already_added") setAdded("added");
      else if (outcome.error === "already_proposed") setAdded("proposed");
      else setError(outcome.error);
    });
  }

  const [sizeKey, sizeValue] = result.sizeBytes
    ? sizeParts(result.sizeBytes)
    : [null, null];
  const source = result.downloadToken
    ? fileUrl.token(result.downloadToken)
    : null;

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-col gap-1.5">
        <p className="font-medium text-pretty [overflow-wrap:anywhere]">
          {result.title}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          {result.locale && (
            <Badge variant="outline" lang={result.locale}>
              {languageLabel(result.locale, locale)}
            </Badge>
          )}
          {result.isOfficial && (
            <Badge variant="secondary">{t("result.official")}</Badge>
          )}
          {result.publisher && <span>{result.publisher}</span>}
          <span>{t("result.source", { host: result.sourceHost })}</span>
          {sizeKey && sizeValue && (
            <span>{t(`result.${sizeKey}`, { size: sizeValue })}</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="default" size="sm">
          <a href={result.url} target="_blank" rel="noopener noreferrer">
            {t("result.open")}
            <ExternalLink aria-hidden />
          </a>
        </Button>

        {added === "added" && (
          <Badge variant="secondary">{t("result.added")}</Badge>
        )}
        {added === "proposed" && (
          <Badge variant="outline">{t("result.proposed")}</Badge>
        )}
        {added === "no" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={add}
          >
            <Plus aria-hidden />
            {pending
              ? t("result.adding")
              : isAdmin
                ? t("result.add")
                : t("result.propose")}
          </Button>
        )}

        {source && (
          <>
            <DownloadLink href={source} />
            <SaveOfflineButton
              source={source}
              url={result.url}
              gameId={gameId}
              gameName={gameName}
              title={result.title}
              locale={proposalLocale(result.locale)}
              publisher={result.publisher}
            />
          </>
        )}
      </div>

      <div aria-live="polite" className="text-sm">
        {feedback && (
          <span className="text-success">
            {feedback === "added"
              ? t("result.addedOk")
              : t("result.proposedOk")}
          </span>
        )}
        {error && (
          <span role="alert" className="text-destructive">
            {t(`errors.${knownError(error)}`)}
          </span>
        )}
      </div>
    </li>
  );
}
