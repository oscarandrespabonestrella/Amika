"use client";

import { Dices } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { spin, type Ranked } from "../rank";
import { GameThumb, gameMeta } from "./game-thumb";
import { ReasonBadges } from "./reason-badges";

const SPIN_MS = 900;
const TICK_MS = 90;

export type SpinState = {
  /** The game on show: cycling while spinning, then the winner. */
  display: Ranked | null;
  picked: Ranked | null;
  spinning: boolean;
  run: () => void;
};

/** Draws one game of `candidates` (votes weigh in on saved nights), with a short animation. */
export function useSpin(
  candidates: Ranked[],
  votes?: Record<string, number>,
): SpinState {
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

  function run() {
    if (spinning) return;
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

  return { display: spinning ? shown : picked, picked, spinning, run };
}

/** The "Tonight you play" card: the drawn game, play it or spin again. */
export function SpinResult({
  state,
  playHref,
}: {
  state: SpinState;
  /** Where "Let's play" goes; null hides it. */
  playHref: string | null;
}) {
  const t = useTranslations("Nights.spin");
  const { display, picked, spinning, run } = state;
  return (
    <>
      <p aria-live="polite" className="sr-only">
        {picked && !spinning ? t("result", { name: picked.name }) : ""}
      </p>
      {display && (
        <section
          aria-label={t("resultLabel")}
          className="flex flex-col gap-3.5 rounded-2xl border border-primary/50 bg-primary/10 p-4"
        >
          <div
            className={cn(
              "flex items-center gap-3.5",
              spinning && "motion-safe:opacity-70",
            )}
            aria-hidden={spinning}
          >
            <GameThumb coverUrl={display.coverUrl} className="size-21" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm text-muted-foreground">
                {t("resultLabel")}
              </p>
              <p className="text-2xl font-bold tracking-tight text-balance">
                {display.name}
              </p>
              {!spinning && (
                <>
                  {gameMeta(display) && (
                    <p className="text-sm text-muted-foreground">
                      {gameMeta(display)}
                    </p>
                  )}
                  <ReasonBadges reasons={display.reasons} />
                </>
              )}
            </div>
          </div>
          {!spinning && (
            <div className="flex gap-2">
              {playHref && (
                <Link
                  href={playHref}
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "h-11 flex-1 px-4",
                  )}
                >
                  {t("playThis")}
                </Link>
              )}
              <button
                type="button"
                onClick={run}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 flex-1 px-4",
                )}
              >
                {t("again")}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** The big spin action (the sticky bar of the picker, or inline on a night). */
export function SpinButton({
  state,
  count,
  className,
}: {
  state: SpinState;
  count: number;
  className?: string;
}) {
  const t = useTranslations("Nights.spin");
  return (
    <button
      type="button"
      onClick={state.run}
      disabled={count === 0 || state.spinning}
      className={cn(
        buttonVariants({ size: "lg" }),
        "h-13 w-full gap-2.5 rounded-2xl text-base",
        className,
      )}
    >
      <Dices className="size-5" aria-hidden />
      {state.spinning
        ? t("spinning")
        : count === 0
          ? t("noneFit")
          : t("action", { count })}
    </button>
  );
}

/** Saved nights: result and spin together, weighted by votes. */
export function SpinCard({
  candidates,
  votes,
  playHref,
}: {
  candidates: Ranked[];
  votes?: Record<string, number>;
  playHref: (gameId: string) => string | null;
}) {
  const state = useSpin(candidates, votes);
  return (
    <div className="flex flex-col gap-3">
      <SpinResult
        state={state}
        playHref={state.picked ? playHref(state.picked.gameId) : null}
      />
      {!state.picked && <SpinButton state={state} count={candidates.length} />}
    </div>
  );
}
