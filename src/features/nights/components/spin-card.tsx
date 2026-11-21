"use client";

import { Dices } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { spin, type Ranked } from "../rank";
import { ReasonBadges } from "./reason-badges";

const SPIN_MS = 900;
const TICK_MS = 90;

/** Picks one game of the shortlist at random; the result is announced politely. */
export function SpinCard({
  candidates,
  groupId,
  votes,
  playHref: playHrefFor,
}: {
  candidates: Ranked[];
  groupId?: string;
  /** Votes per game id: they weigh in the draw (saved nights). */
  votes?: Record<string, number>;
  /** Overrides the "Play this" target; return null to hide the link. */
  playHref?: (gameId: string) => string | null;
}) {
  const t = useTranslations("Nights.spin");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [shown, setShown] = useState<Ranked | null>(null);
  const [spinning, setSpinning] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((id) => window.clearTimeout(id));
    },
    [],
  );

  // The shortlist changes with the filters: an old result that dropped out is gone.
  const picked = candidates.find((c) => c.gameId === pickedId) ?? null;
  const disabled = candidates.length === 0 || spinning;

  function run() {
    const winner = spin(
      candidates.map((c) => ({
        id: c.gameId,
        score: c.score,
        votes: votes?.[c.gameId] ?? 0,
      })),
      Math.random,
    );
    if (winner === null) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) {
      setPickedId(winner);
      return;
    }
    setSpinning(true);
    setPickedId(null);
    let i = 0;
    for (let at = 0; at < SPIN_MS; at += TICK_MS) {
      timers.current.push(
        window.setTimeout(() => {
          setShown(candidates[i++ % candidates.length]);
        }, at),
      );
    }
    timers.current.push(
      window.setTimeout(() => {
        setPickedId(winner);
        setSpinning(false);
      }, SPIN_MS),
    );
  }

  const display = spinning ? shown : picked;
  const playHref = picked
    ? playHrefFor
      ? playHrefFor(picked.gameId)
      : `/games/${picked.gameId}/plays/new${groupId ? `?group=${groupId}` : ""}`
    : null;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      {display && (
        <div
          className={cn(
            "flex items-center gap-4",
            spinning && "motion-safe:opacity-70",
          )}
          aria-hidden={spinning}
        >
          <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-tint text-tint-foreground">
            {display.coverUrl ? (
              // External hotlinked image (BGG): next/image optimization is not applicable.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={display.coverUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="size-full object-cover"
              />
            ) : (
              <Dices className="size-8" aria-hidden />
            )}
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">
              {t("resultLabel")}
            </span>
            <span className="text-2xl font-semibold tracking-tight text-balance">
              {display.name}
            </span>
            {!spinning && <ReasonBadges reasons={display.reasons} />}
          </div>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {picked && !spinning ? t("result", { name: picked.name }) : ""}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          size="lg"
          className="h-11 px-5"
          variant={picked ? "outline" : "default"}
          disabled={disabled}
          onClick={run}
        >
          {spinning ? t("spinning") : picked ? t("again") : t("action")}
        </Button>
        {playHref && !spinning && (
          <Link
            href={playHref}
            className={cn(buttonVariants({ size: "lg" }), "h-11 px-5")}
          >
            {t("playThis")}
          </Link>
        )}
      </div>
    </div>
  );
}
