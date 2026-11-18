"use client";

import { Download, Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { promptInstall, useInstallState } from "../install-store";

/** Always-available install option (ignores "don't ask again" on the banner). */
export function InstallSettings() {
  const t = useTranslations("Pwa.settings");
  const { canPrompt, installed, ios } = useInstallState();

  if (installed) return <p className="text-sm">{t("installed")}</p>;

  if (canPrompt) {
    return (
      <button
        type="button"
        onClick={() => void promptInstall()}
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Download className="size-4" aria-hidden />
        {t("install")}
      </button>
    );
  }

  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      {ios && <Share className="mt-0.5 size-4 shrink-0" aria-hidden />}
      {ios ? t("ios") : t("manual")}
    </p>
  );
}
