"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OFFLINE_PAGE, FILE_PREFIX } from "../offline/constants";
import { onManualsChanged, notifyManualsChanged } from "../offline/events";
import { createOfflineStore, type SavedManual } from "../offline/offline-store";
import { languageLabel, sizeParts } from "./format";

/** The manuals of this game kept on this device (no network needed to open them). */
export function SavedManualsList({ gameId }: { gameId: string }) {
  const t = useTranslations("Manuals");
  const locale = useLocale();
  const store = useMemo(() => createOfflineStore(), []);
  const [items, setItems] = useState<SavedManual[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const all = await store.list().catch(() => []);
      if (alive) setItems(all.filter((m) => m.gameId === gameId));
    };
    void refresh();
    const off = onManualsChanged(() => void refresh());
    return () => {
      alive = false;
      off();
    };
  }, [store, gameId]);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">
        {t("saved.title")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("saved.hint")}</p>
      <ul className="flex flex-col gap-2">
        {items.map((m) => {
          const [sizeKey, sizeValue] = sizeParts(m.sizeBytes);
          return (
            <li
              key={m.key}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
            >
              <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
                {m.title}
              </span>
              {m.locale && (
                <Badge variant="outline" lang={m.locale}>
                  {languageLabel(m.locale, locale)}
                </Badge>
              )}
              {m.sizeBytes > 0 && (
                <span className="text-sm text-muted-foreground">
                  {t(`result.${sizeKey}`, { size: sizeValue })}
                </span>
              )}
              <Button asChild size="sm">
                <a
                  href={`${FILE_PREFIX}${m.key}`}
                  target="_blank"
                  rel="noopener"
                >
                  {t("saved.open")}
                </a>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await store.remove(m.url);
                  notifyManualsChanged();
                }}
              >
                {t("saved.remove")}
              </Button>
            </li>
          );
        })}
      </ul>
      <a
        href={OFFLINE_PAGE}
        className="w-fit text-sm text-primary underline-offset-4 hover:underline"
      >
        {t("saved.offlineList")}
      </a>
    </div>
  );
}
