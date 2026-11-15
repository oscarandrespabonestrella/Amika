"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { LOCALE_NAMES } from "@/i18n/locales";
import { usePathname, useRouter } from "@/i18n/navigation";
import { type AppLocale, routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { updatePreferences } from "../actions/update-preferences";

export function LocaleSelect() {
  const t = useTranslations("Settings");
  const current = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [saveFailed, setSaveFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(locale: AppLocale) {
    startTransition(async () => {
      const result = await updatePreferences({ locale });
      setSaveFailed(!result.ok);
      router.replace(pathname, { locale }); // language changes even if saving failed
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("language")}
        aria-busy={pending}
        className="grid grid-cols-3 gap-2"
      >
        {routing.locales.map((locale) => (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={current === locale}
            onClick={() => choose(locale)}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              current === locale
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {LOCALE_NAMES[locale]}
          </button>
        ))}
      </div>
      {saveFailed && (
        <p role="alert" className="text-sm text-destructive">
          {t("saveError")}
        </p>
      )}
    </div>
  );
}
