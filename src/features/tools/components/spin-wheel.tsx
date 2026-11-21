"use client";

import { LoaderPinwheel } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { PLAYER_NAME_MAX } from "@/features/players/client";
import { prefersReducedMotion } from "../feedback";
import { defaultRng, randomInt } from "../random";
import type { ToolRoster } from "../types";
import { useStoredState } from "../use-stored-state";
import { slicePath, targetRotation } from "../wheel";
import { ActionBar, primaryAction } from "./controls";
import { NamesEditor } from "./names-editor";
import { ToolFrame } from "./tool-frame";

const OPTIONS = z.array(z.string().min(1).max(PLAYER_NAME_MAX)).max(24);
const NO_OPTIONS: string[] = [];
const SPIN_MS = 4500;
const SIZE = 300;
const R = SIZE / 2;
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function sliceColor(i: number, n: number) {
  // With 5k+1 slices the last would touch the first in the same colour.
  return i === n - 1 && i % COLORS.length === 0
    ? COLORS[1]
    : COLORS[i % COLORS.length];
}

/** Your own options on a wheel; spin it for one random winner. */
export function SpinWheel({ roster }: { roster: ToolRoster }) {
  const t = useTranslations("Tools.wheel");
  const [options, setOptions] = useStoredState("wheel", OPTIONS, NO_OPTIONS);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const n = options.length;
  const canSpin = n >= 2 && !spinning;

  function spin() {
    if (!canSpin) return;
    const index = randomInt(n);
    const chosen = options[index];
    const instant = prefersReducedMotion();
    setWinner(null);
    setRotation((r) =>
      targetRotation(r, index, n, 5 + randomInt(3), defaultRng()),
    );
    if (instant) {
      setWinner(chosen);
      return;
    }
    setSpinning(true);
    timer.current = window.setTimeout(() => {
      setSpinning(false);
      setWinner(chosen);
    }, SPIN_MS);
  }

  function edit(next: string[]) {
    setWinner(null);
    setOptions(next);
  }

  function reset() {
    window.clearTimeout(timer.current);
    setSpinning(false);
    setWinner(null);
    setRotation(0);
  }

  const fontSize = n <= 8 ? 15 : n <= 14 ? 12 : 10;
  const maxChars = n <= 8 ? 14 : n <= 14 ? 12 : 10;

  return (
    <ToolFrame id="wheel" onReset={reset}>
      <div className="relative mx-auto w-full max-w-sm">
        {/* The pointer, fixed at the top while the wheel turns under it. */}
        <div
          aria-hidden
          className="absolute -top-1 left-1/2 z-10 size-0 -translate-x-1/2 border-x-[14px] border-t-[26px] border-x-transparent border-t-foreground drop-shadow"
        />
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-hidden
          style={{
            transform: `rotate(${rotation}deg)`,
            transitionDuration: spinning ? `${SPIN_MS}ms` : "0ms",
          }}
          className="w-full rounded-full transition-transform ease-[cubic-bezier(0.12,0.7,0.1,1)] motion-reduce:transition-none"
        >
          {n === 0 ? (
            <circle cx={R} cy={R} r={R - 1} className="fill-muted" />
          ) : (
            options.map((option, i) => {
              const angle = ((i + 0.5) * 360) / n;
              const label =
                option.length > maxChars
                  ? `${option.slice(0, maxChars - 1)}…`
                  : option;
              return (
                <g key={option}>
                  <path
                    d={slicePath(i, n, R)}
                    fill={sliceColor(i, n)}
                    stroke="var(--background)"
                    strokeWidth={2}
                  />
                  <text
                    transform={`rotate(${angle - 90} ${R} ${R})`}
                    x={SIZE - 14}
                    y={R}
                    textAnchor="end"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fontWeight={600}
                    fill="#fff"
                  >
                    {label}
                  </text>
                </g>
              );
            })
          )}
          <circle cx={R} cy={R} r={14} fill="var(--background)" />
        </svg>
      </div>

      <div aria-live="polite" className="min-h-16 text-center">
        {winner ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">{t("winner")}</p>
            <p className="text-3xl font-bold tracking-tight text-balance motion-safe:animate-[tools-pop_0.4s_ease-out]">
              {winner}
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-xl px-4"
              onClick={() => edit(options.filter((o) => o !== winner))}
            >
              {t("removeWinner", { name: winner })}
            </Button>
          </div>
        ) : n < 2 ? (
          <p className="text-sm text-muted-foreground">{t("needTwo")}</p>
        ) : null}
      </div>

      <NamesEditor
        names={options}
        onChange={edit}
        roster={roster}
        title={t("options")}
        placeholder={t("placeholder")}
      />

      <ActionBar>
        <Button
          type="button"
          size="lg"
          className={primaryAction}
          onClick={spin}
          disabled={!canSpin}
        >
          <LoaderPinwheel aria-hidden />
          {spinning ? t("spinning") : t("spin")}
        </Button>
      </ActionBar>
    </ToolFrame>
  );
}
