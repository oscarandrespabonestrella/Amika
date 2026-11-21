"use client";

import { ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { toggleNightVoteAction } from "../actions/night-actions";
import { toNightError, type NightErrorCode } from "../error-codes";

type Optimistic = { base: string; mine: boolean; votes: number };

/**
 * Toggles my vote. The change shows at once; on an error it rolls back. The
 * optimistic value is only used while the server data is still the one it was
 * computed from, so a refresh (or a poll) takes over without flicker.
 */
export function VoteButton({
  nightGameId,
  name,
  votes,
  mine,
  disabled,
  onError,
  onDone,
}: {
  nightGameId: string;
  name: string;
  votes: number;
  mine: boolean;
  disabled?: boolean;
  onError: (code: NightErrorCode | null) => void;
  onDone: () => void;
}) {
  const t = useTranslations("Nights.detail");
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  const [pending, startTransition] = useTransition();

  const base = `${mine}:${votes}`;
  const shown = optimistic?.base === base ? optimistic : { mine, votes };

  function toggle() {
    onError(null);
    setOptimistic({
      base,
      mine: !shown.mine,
      votes: shown.votes + (shown.mine ? -1 : 1),
    });
    startTransition(async () => {
      const result = await toggleNightVoteAction(nightGameId);
      if (result.ok) onDone();
      else {
        setOptimistic(null);
        onError(toNightError(result.error));
      }
    });
  }

  return (
    <button
      type="button"
      aria-pressed={shown.mine}
      aria-label={t("voteFor", { name })}
      disabled={disabled || pending}
      onClick={toggle}
      className={cn(
        "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
        shown.mine
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-muted",
      )}
    >
      <ThumbsUp className="size-4" aria-hidden />
      <span aria-hidden>{shown.votes}</span>
    </button>
  );
}
