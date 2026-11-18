"use client";

import { Check, HardDriveDownload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { notifyManualsChanged, onManualsChanged } from "../offline/events";
import { createOfflineStore, type SaveInput } from "../offline/offline-store";
import { knownError } from "./error-text";

type Props = Omit<SaveInput, "locale" | "publisher"> & {
  locale: string | null;
  publisher: string | null;
};

type State = "checking" | "idle" | "saving" | "saved" | "unsupported";

/**
 * "Save for offline": keeps the PDF on THIS device (Cache Storage) so it opens with no internet.
 * Hidden where the browser cannot do it.
 */
export function SaveOfflineButton(props: Props) {
  const t = useTranslations("Manuals");
  const store = useMemo(() => createOfflineStore(), []);
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const { url } = props;

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const has = store.isSupported()
        ? await store.has(url).catch(() => false)
        : null;
      if (alive)
        setState(has === null ? "unsupported" : has ? "saved" : "idle");
    };
    void refresh();
    const off = onManualsChanged(() => void refresh());
    return () => {
      alive = false;
      off();
    };
  }, [store, url]);

  async function save() {
    setError(null);
    setState("saving");
    const result = await store.save(props);
    if (result.ok) {
      setState("saved");
      notifyManualsChanged();
    } else {
      setState("idle");
      setError(result.error);
    }
  }

  async function remove() {
    setError(null);
    await store.remove(url);
    setState("idle");
    notifyManualsChanged();
  }

  if (state === "checking" || state === "unsupported") return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {state === "saved" ? (
        <>
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <Check className="size-4" aria-hidden />
            {t("result.savedOffline")}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={remove}>
            {t("result.removeOffline")}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={state === "saving"}
          onClick={save}
        >
          <HardDriveDownload aria-hidden />
          {state === "saving" ? t("result.saving") : t("result.saveOffline")}
        </Button>
      )}
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {t(`errors.${knownError(error)}`)}
        </span>
      )}
    </span>
  );
}
