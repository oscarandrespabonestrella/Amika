"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { MODEL_DOWNLOAD_MB, PACK_DOWNLOAD_MB } from "../embedding/activation";
import { useRecognitionSetup } from "../live/use-activation";

/** Opt-in card, shared by the games page and Settings. Off by default, per device. */
export function ActivationCard({
  setup,
}: {
  setup: ReturnType<typeof useRecognitionSetup>;
}) {
  const t = useTranslations("Recognition.live");
  const pct = setup.progress === null ? null : Math.round(setup.progress * 100);
  return (
    <div className="flex flex-col gap-3" data-testid="recognition-activation">
      <p className="text-sm text-muted-foreground">{t("activation.intro")}</p>
      <p className="text-sm font-medium">
        {t("activation.warning", {
          mb: MODEL_DOWNLOAD_MB,
          packMb: PACK_DOWNLOAD_MB,
        })}
      </p>
      <p className="text-sm text-muted-foreground">{t("activation.privacy")}</p>
      {setup.installing ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <span>
            {pct === null
              ? t("activation.downloading")
              : t("activation.progress", { pct })}
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={setup.cancel}
          >
            {t("activation.cancel")}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          className="h-11 self-start"
          onClick={() => void setup.install()}
        >
          {t("activation.enable", {
            totalMb: MODEL_DOWNLOAD_MB + PACK_DOWNLOAD_MB,
          })}
        </Button>
      )}
      {setup.error && (
        <p role="alert" className="text-sm text-destructive">
          {t("activation.failed")}
        </p>
      )}
    </div>
  );
}

/** Settings section: enable (with the warning) or disable and free the space. */
export function RecognitionSettings() {
  const t = useTranslations("Recognition.live");
  const setup = useRecognitionSetup();
  if (!setup.ready) return null;
  return (
    <div className="flex flex-col gap-3">
      {setup.active ? (
        <>
          <p className="text-sm">
            {t("settings.on", { mb: MODEL_DOWNLOAD_MB })}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 self-start"
            onClick={() => void setup.remove()}
          >
            {t("settings.remove")}
          </Button>
        </>
      ) : (
        <ActivationCard setup={setup} />
      )}
    </div>
  );
}
