"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  deleteFaqAction,
  deleteImageAction,
  deleteResourceAction,
  deleteRulesSummaryAction,
  type GameCenterResult,
} from "../actions/game-center-actions";

export type RemoveTarget =
  | { type: "resource" | "image" | "faq"; id: string }
  | { type: "rules"; gameId: string; locale: string };

/** Two-step delete (admins, or the author of a pending suggestion). */
export function RemoveButton({
  target,
  label,
}: {
  target: RemoveTarget;
  label: string;
}) {
  const t = useTranslations("GameCenter");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      let result: GameCenterResult;
      if (target.type === "rules")
        result = await deleteRulesSummaryAction(target.gameId, target.locale);
      else if (target.type === "resource")
        result = await deleteResourceAction(target.id);
      else if (target.type === "image")
        result = await deleteImageAction(target.id);
      else result = await deleteFaqAction(target.id);
      if (!result.ok) setError(result.error);
      setConfirming(false);
    });
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9"
        aria-label={label}
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden />
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="h-9"
        disabled={pending}
        onClick={remove}
      >
        {t("admin.confirm")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        {t("admin.cancel")}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {t(`errors.${error as "failed"}`)}
        </span>
      )}
    </span>
  );
}
