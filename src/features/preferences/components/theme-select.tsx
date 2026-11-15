"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore, useTransition } from "react";
import { cn } from "@/lib/utils";
import { updatePreferences } from "../actions/update-preferences";
import { THEMES } from "../schemas";

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

const subscribe = () => () => {};

export function ThemeSelect() {
  const t = useTranslations("Settings");
  const { theme, setTheme } = useTheme();
  const [saveFailed, setSaveFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  // The stored theme is only known on the client: avoid a hydration mismatch.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? "system") : null;

  function choose(value: (typeof THEMES)[number]) {
    setTheme(value); // applies instantly and is stored on this device
    startTransition(async () => {
      const result = await updatePreferences({ theme: value });
      setSaveFailed(!result.ok);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("theme.label")}
        aria-busy={pending}
        className="grid grid-cols-3 gap-2"
      >
        {THEMES.map((value) => {
          const Icon = ICONS[value];
          return (
            <button
              key={value}
              type="button"
              aria-pressed={current === value}
              onClick={() => choose(value)}
              className={cn(
                "flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                current === value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(`theme.${value}`)}
            </button>
          );
        })}
      </div>
      {saveFailed && (
        <p role="alert" className="text-sm text-destructive">
          {t("saveError")}
        </p>
      )}
    </div>
  );
}
