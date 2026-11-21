"use client";

import { Coins, Crown, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "../feedback";
import { randomInt } from "../random";
import { ActionBar, primaryAction } from "./controls";
import { ToolFrame } from "./tool-frame";

type Side = "heads" | "tails";
const FLIP_MS = 1200;
const HISTORY = 10;

const face =
  "absolute inset-0 grid place-items-center rounded-full border-8 [backface-visibility:hidden]";

export function CoinFlip() {
  const t = useTranslations("Tools.coin");
  // Cumulative rotation: a multiple of 360 shows heads, 180 more shows tails.
  const [rotation, setRotation] = useState(0);
  const [side, setSide] = useState<Side | null>(null);
  const [flipping, setFlipping] = useState(false);
  const [history, setHistory] = useState<Side[]>([]);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function flip() {
    if (flipping) return;
    const next: Side = randomInt(2) === 0 ? "heads" : "tails";
    const showing: Side = side ?? "heads";
    const instant = prefersReducedMotion();
    setRotation((r) => r + 1800 + (next === showing ? 0 : 180));
    const done = () => {
      setSide(next);
      setFlipping(false);
      setHistory((h) => [next, ...h].slice(0, HISTORY));
    };
    if (instant) {
      done();
      return;
    }
    setFlipping(true);
    timer.current = window.setTimeout(done, FLIP_MS);
  }

  function reset() {
    window.clearTimeout(timer.current);
    setRotation(0);
    setSide(null);
    setFlipping(false);
    setHistory([]);
  }

  const heads = history.filter((s) => s === "heads").length;
  const tails = history.length - heads;

  return (
    <ToolFrame id="coin" onReset={reset}>
      <div className="flex flex-col items-center gap-6 rounded-3xl border border-border bg-card px-4 py-10">
        <div style={{ perspective: 800 }}>
          <button
            type="button"
            onClick={flip}
            disabled={flipping}
            aria-label={t("flip")}
            style={{
              transform: `rotateY(${rotation}deg)`,
              transformStyle: "preserve-3d",
              transitionDuration: `${FLIP_MS}ms`,
            }}
            className="relative block size-44 rounded-full transition-transform ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
          >
            <span
              className={cn(
                face,
                "border-warning-foreground/30 bg-warning text-warning-foreground",
              )}
            >
              <span className="flex flex-col items-center gap-1">
                <Crown className="size-12" aria-hidden />
                <span className="text-lg font-bold">{t("heads")}</span>
              </span>
            </span>
            <span
              className={cn(
                face,
                "[transform:rotateY(180deg)] border-border bg-secondary text-secondary-foreground",
              )}
            >
              <span className="flex flex-col items-center gap-1">
                <Star className="size-12" aria-hidden />
                <span className="text-lg font-bold">{t("tails")}</span>
              </span>
            </span>
          </button>
        </div>
        <p
          aria-live="polite"
          className="min-h-9 text-3xl font-bold tracking-tight"
        >
          {flipping ? "" : side ? t(side) : t("tapToFlip")}
        </p>
      </div>

      {history.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground tabular-nums">
            {t("score", { heads, tails })}
          </p>
          <ul aria-label={t("history")} className="flex flex-wrap gap-2">
            {history.map((entry, i) => (
              <li
                key={i}
                className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground"
              >
                {t(entry)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ActionBar>
        <Button
          type="button"
          size="lg"
          className={primaryAction}
          onClick={flip}
          disabled={flipping}
        >
          <Coins aria-hidden />
          {t("flip")}
        </Button>
      </ActionBar>
    </ToolFrame>
  );
}
