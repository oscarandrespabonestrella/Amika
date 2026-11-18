"use client";

import { Download, Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { promptInstall, useInstallState } from "../install-store";
import {
  type InstallState,
  EMPTY_STATE,
  dismiss,
  recordVisit,
  shouldPrompt,
  snooze,
  updateState,
} from "../install-state";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Deferred invitation to install: only after a few visits on different days or right after
 * the first logged play, never on the first visit. "Not now" snoozes it; "Don't ask again"
 * silences it (Settings keeps offering the install).
 */
export function InstallBanner() {
  const t = useTranslations("Pwa.banner");
  const { canPrompt, installed, ios } = useInstallState();
  const [state, setState] = useState<InstallState>(EMPTY_STATE);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const at = Date.now();
    // Reading localStorage + counting today's visit can only happen on the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(updateState((s) => recordVisit(s, at)));
    setNow(at);
  }, []);

  if (now === 0 || installed || !(canPrompt || ios)) return null;
  if (!shouldPrompt(state, now)) return null;

  function later() {
    setState(updateState((s) => snooze(s, Date.now())));
  }
  function never() {
    setState(updateState(dismiss));
  }
  async function install() {
    const accepted = await promptInstall();
    if (!accepted) later();
  }

  return (
    <section
      aria-label={t("label")}
      className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-lg md:inset-x-auto md:right-6 md:bottom-6 md:w-96"
    >
      <div>
        <h2 className="font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">
          {ios && !canPrompt ? t("iosHint") : t("hint")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canPrompt ? (
          <button
            type="button"
            onClick={install}
            className={`${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`}
          >
            <Download className="size-4" aria-hidden />
            {t("install")}
          </button>
        ) : (
          <span className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
            <Share className="size-4" aria-hidden />
            {t("iosStep")}
          </span>
        )}
        <button
          type="button"
          onClick={later}
          className={`${BUTTON} border border-border hover:bg-muted`}
        >
          {t("later")}
        </button>
        <button
          type="button"
          onClick={never}
          className={`${BUTTON} text-muted-foreground hover:bg-muted`}
        >
          {t("never")}
        </button>
      </div>
    </section>
  );
}
