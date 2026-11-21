"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { toggleNightVoteAction } from "../actions/night-actions";
import { toNightError, type NightErrorCode } from "../error-codes";
import { GameThumb } from "./game-thumb";

type Optimistic = { base: string; mine: boolean; votes: number };

/**
 * A game of the night as one big vote toggle: a bar behind it shows its share of the
 * votes. The change shows at once and rolls back on an error; the optimistic value is
 * only used while the server data is the one it was computed from, so a refresh (or a
 * poll) takes over without flicker.
 */
export function VoteButton({
  nightGameId,
  name,
  coverUrl,
  votes,
  mine,
  totalVotes,
  subtitle,
  disabled,
  onError,
  onDone,
}: {
  nightGameId: string;
  name: string;
  coverUrl: string | null;
  votes: number;
  mine: boolean;
  /** All votes of the night, for the bar's width. */
  totalVotes: number;
  /** Who voted, badges… */
  subtitle: ReactNode;
  disabled?: boolean;
  onError: (code: NightErrorCode | null) => void;
  onDone: () => void;
}) {
  const t = useTranslations("Nights.detail");
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  const [pending, startTransition] = useTransition();

  const base = `${mine}:${votes}`;
  const shown = optimistic?.base === base ? optimistic : { mine, votes };
  const total = Math.max(totalVotes + (shown.votes - votes), shown.votes, 1);
  const pct = Math.round((shown.votes / total) * 100);

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
      aria-describedby={`votes-${nightGameId}`}
      disabled={disabled || pending}
      onClick={toggle}
      className={cn(
        "relative flex min-h-16 w-full items-center gap-3 overflow-hidden rounded-2xl border-[1.5px] bg-card px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
        shown.mine ? "border-primary" : "border-border",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 transition-[width] motion-reduce:transition-none",
          shown.mine ? "bg-primary/15" : "bg-muted",
        )}
        style={{ width: `${pct}%` }}
      />
      <GameThumb coverUrl={coverUrl} className="relative size-10 rounded-lg" />
      <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold break-words">{name}</span>
        <span
          id={`votes-${nightGameId}`}
          className="text-xs text-muted-foreground"
        >
          {subtitle}
        </span>
      </span>
      <span aria-hidden className="relative text-base font-bold tabular-nums">
        {shown.votes}
      </span>
    </button>
  );
}
