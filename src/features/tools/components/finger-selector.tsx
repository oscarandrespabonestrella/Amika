"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { vibrate } from "../feedback";
import { randomInt } from "../random";
import { ToolFrame } from "./tool-frame";

type Finger = { id: number; x: number; y: number; color: string };

const COUNTDOWN_MS = 3000;
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--success)",
  "var(--destructive)",
  "var(--primary)",
];

/**
 * Everyone keeps a finger on the screen; after three still seconds one is chosen.
 * The live fingers are kept in refs (pointer events fire faster than renders) and
 * mirrored to state for drawing.
 */
export function FingerSelector() {
  const t = useTranslations("Tools.finger");
  const live = useRef(new Map<number, Finger>());
  const winnerRef = useRef<number | null>(null);
  const colorIndex = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const [fingers, setFingers] = useState<Finger[]>([]);
  const [winner, setWinner] = useState<number | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const sync = () => setFingers([...live.current.values()]);

  /** (Re)starts the countdown whenever the set of fingers changes. */
  function schedule() {
    window.clearTimeout(timer.current);
    if (winnerRef.current !== null || live.current.size < 2) return;
    timer.current = window.setTimeout(() => {
      const ids = [...live.current.keys()];
      if (ids.length < 2) return;
      const chosen = ids[randomInt(ids.length)];
      winnerRef.current = chosen;
      setWinner(chosen);
      vibrate(200);
    }, COUNTDOWN_MS);
  }

  function reset() {
    window.clearTimeout(timer.current);
    live.current.clear();
    winnerRef.current = null;
    colorIndex.current = 0;
    setWinner(null);
    setFingers([]);
  }

  function down(event: React.PointerEvent<HTMLDivElement>) {
    // Once someone is picked, new fingers wait for the next round.
    if (winnerRef.current !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = event.currentTarget.getBoundingClientRect();
    live.current.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      color: COLORS[colorIndex.current++ % COLORS.length],
    });
    sync();
    schedule();
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    const finger = live.current.get(event.pointerId);
    if (!finger) return;
    const box = event.currentTarget.getBoundingClientRect();
    live.current.set(event.pointerId, {
      ...finger,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
    sync();
  }

  function up(event: React.PointerEvent<HTMLDivElement>) {
    if (!live.current.delete(event.pointerId)) return;
    if (live.current.size === 0) {
      // Everyone let go: the next round starts clean.
      winnerRef.current = null;
      colorIndex.current = 0;
      setWinner(null);
    }
    sync();
    schedule();
  }

  const counting = winner === null && fingers.length >= 2;
  const signature = fingers.map((f) => f.id).join(",");

  return (
    <ToolFrame id="finger" onReset={reset}>
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(event) => event.preventDefault()}
        className="relative min-h-[55dvh] flex-1 touch-none overflow-hidden rounded-3xl border border-border bg-card select-none"
      >
        <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-8 text-center text-lg font-medium text-pretty text-muted-foreground">
          {winner !== null
            ? t("liftToReset")
            : fingers.length === 0
              ? t("prompt")
              : fingers.length === 1
                ? t("needMore")
                : t("hold")}
        </p>

        {fingers.map((finger) => {
          const isWinner = finger.id === winner;
          return (
            <span
              key={finger.id}
              aria-hidden
              style={{
                left: finger.x,
                top: finger.y,
                backgroundColor: finger.color,
                borderColor: finger.color,
              }}
              className={cn(
                "pointer-events-none absolute -translate-1/2 rounded-full border-4 bg-clip-padding transition-[width,height,opacity] duration-300",
                isWinner ? "size-40 opacity-100" : "size-20 opacity-90",
                winner !== null && !isWinner && "opacity-15",
                !isWinner && winner === null && "motion-safe:animate-pulse",
              )}
            />
          );
        })}

        {counting && (
          <div className="pointer-events-none absolute inset-x-6 bottom-6 h-2 overflow-hidden rounded-full bg-muted">
            <div
              key={signature}
              className="h-full origin-left animate-[tools-fill_3s_linear_forwards] rounded-full bg-primary"
            />
          </div>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {winner !== null ? t("picked") : ""}
      </p>
    </ToolFrame>
  );
}
