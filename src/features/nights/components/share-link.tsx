"use client";

import { useLocale, useFormatter, useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  createNightLinkAction,
  revokeNightLinkAction,
} from "../actions/night-actions";
import { toNightError, type NightErrorCode } from "../error-codes";
import { SectionLabel } from "./choice-chips";

const subscribeNothing = () => () => {};
const canShareSnapshot = () => typeof navigator.share === "function";
const noShareOnServer = () => false;

/**
 * Host only: the public link. The token only exists in the response that creates the
 * link, so after a reload only "active until" and Regenerate/Revoke remain.
 */
export function ShareLink({
  nightId,
  title,
  linkExpiresAt,
  disabled,
  onError,
  onDone,
}: {
  nightId: string;
  title: string;
  linkExpiresAt: string | null;
  disabled?: boolean;
  onError: (code: NightErrorCode | null) => void;
  onDone: () => void;
}) {
  const t = useTranslations("Nights.detail.share");
  const locale = useLocale();
  const format = useFormatter();
  const [fresh, setFresh] = useState<{ url: string; expiresAt: string } | null>(
    null,
  );
  const [revoked, setRevoked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const canShare = useSyncExternalStore(
    subscribeNothing,
    canShareSnapshot,
    noShareOnServer,
  );

  const expiresAt = revoked ? null : (fresh?.expiresAt ?? linkExpiresAt);
  // The link is valid until 00:00 UTC of the stated instant: show the last day.
  const lastDay = expiresAt
    ? format.dateTime(new Date(Date.parse(expiresAt) - 1), {
        dateStyle: "medium",
        timeZone: "UTC",
      })
    : null;

  function create() {
    onError(null);
    startTransition(async () => {
      const result = await createNightLinkAction(nightId);
      if (!result.ok) {
        onError(toNightError(result.error));
        return;
      }
      setFresh({
        url: `${window.location.origin}/${locale}/n/${result.token}`,
        expiresAt: result.expiresAt,
      });
      setRevoked(false);
      setCopied(false);
      onDone();
    });
  }

  function revoke() {
    onError(null);
    startTransition(async () => {
      const result = await revokeNightLinkAction(nightId);
      if (!result.ok) {
        onError(toNightError(result.error));
        return;
      }
      setFresh(null);
      setRevoked(true);
      onDone();
    });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function share(url: string) {
    try {
      await navigator.share({ title, url });
    } catch {
      // Cancelled by the user: nothing to do.
    }
  }

  return (
    <section
      aria-labelledby="share-title"
      className="flex scroll-mt-20 flex-col gap-3 rounded-2xl border border-border bg-card p-4"
    >
      <SectionLabel id="share-title">{t("title")}</SectionLabel>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <p className="text-sm font-medium">{t("warning")}</p>

      {fresh && !revoked && (
        <div className="flex flex-col gap-2">
          <input
            readOnly
            value={fresh.url}
            aria-label={t("urlLabel")}
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-11 px-4"
              onClick={() => copy(fresh.url)}
            >
              {copied ? t("copied") : t("copy")}
            </Button>
            {canShare && (
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                onClick={() => share(fresh.url)}
              >
                {t("share")}
              </Button>
            )}
          </div>
          <p aria-live="polite" className="sr-only">
            {copied ? t("copied") : ""}
          </p>
        </div>
      )}

      {lastDay && (
        <p className="text-sm text-muted-foreground">
          {t("active", { date: lastDay })}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {expiresAt ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              disabled={disabled || pending}
              onClick={create}
            >
              {t("regenerate")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              disabled={disabled || pending}
              onClick={revoke}
            >
              {t("revoke")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            className="h-11 px-4"
            disabled={disabled || pending}
            onClick={create}
          >
            {t("create")}
          </Button>
        )}
      </div>
      {expiresAt && (
        <p className="text-xs text-muted-foreground">{t("regenerateHint")}</p>
      )}
    </section>
  );
}
