"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  publishSheetAction,
  unpublishSheetAction,
  type CommunityResult,
} from "../actions/community-actions";

type ErrorCode = Extract<CommunityResult, { ok: false }>["error"];

/** Publish or unpublish one of the user's sheets, with an inline confirmation. */
export function PublishToggle({
  sheetId,
  visibility,
  canPublish,
}: {
  sheetId: string;
  visibility: "private" | "public";
  /** False for sheets of the user's own custom games: they can never be shared. */
  canPublish: boolean;
}) {
  const t = useTranslations("Community");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const isPublic = visibility === "public";

  if (!canPublish && !isPublic)
    return (
      <p className="text-sm text-muted-foreground">{t("publish.customGame")}</p>
    );

  function run() {
    setError(null);
    startTransition(async () => {
      const result = isPublic
        ? await unpublishSheetAction(sheetId)
        : await publishSheetAction(sheetId);
      if (result.ok) setConfirming(false);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {!confirming ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-fit px-4"
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          {isPublic ? t("publish.unpublish") : t("publish.button")}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            {isPublic
              ? t("publish.confirmUnpublish")
              : t("publish.confirmPublish")}
          </p>
          <Button
            type="button"
            className="h-11 px-4"
            disabled={pending}
            onClick={run}
          >
            {isPublic ? t("publish.yesUnpublish") : t("publish.yesPublish")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            {t("publish.no")}
          </Button>
        </div>
      )}
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
