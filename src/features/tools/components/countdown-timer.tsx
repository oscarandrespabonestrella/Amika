"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/utils";
import { formatClock, splitSeconds, toSeconds } from "../countdown";
import { beep, primeAudio, vibrate } from "../feedback";
import { clamp } from "../random";
import { useStoredState } from "../use-stored-state";
import {
  ActionBar,
  chipClass,
  primaryAction,
  SectionLabel,
  SettingRow,
  SwitchRow,
} from "./controls";
import { ToolFrame } from "./tool-frame";

const SETTINGS = z.object({
  seconds: z.number().int().min(1).max(36000),
  sound: z.boolean(),
  vibration: z.boolean(),
  warn: z.boolean(),
});
type Settings = z.infer<typeof SETTINGS>;
const DEFAULTS: Settings = {
  seconds: 60,
  sound: true,
  vibration: true,
  warn: true,
};
const PRESETS = [30, 60, 120, 300, 600];
const WARN_AT = 10;
const MAX_MINUTES = 599;

type Status = "idle" | "running" | "paused" | "done";

/** A countdown with presets, any duration, and a sound/vibration alert. */
export function CountdownTimer() {
  const t = useTranslations("Tools.countdown");
  const [settings, setSettings] = useStoredState(
    "countdown",
    SETTINGS,
    DEFAULTS,
  );
  const [status, setStatus] = useState<Status>("idle");
  // While running, the end is a clock time (so a throttled tab does not drift);
  // while paused, what is left.
  const [endAt, setEndAt] = useState(0);
  const [left, setLeft] = useState(0);
  const [now, setNow] = useState(0);
  const warned = useRef(false);

  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      const remaining = (endAt - time) / 1000;
      const { sound, vibration, warn } = settings;
      if (remaining <= 0) {
        setStatus("done");
        setLeft(0);
        if (sound) beep(3, 660);
        if (vibration) vibrate([300, 150, 300, 150, 300]);
      } else if (warn && !warned.current && remaining <= WARN_AT) {
        warned.current = true;
        if (sound) beep(1, 880);
        if (vibration) vibrate(100);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [status, endAt, settings]);

  const remaining =
    status === "running"
      ? Math.max(0, (endAt - now) / 1000)
      : status === "idle"
        ? settings.seconds
        : left;
  const ratio = status === "idle" ? 1 : remaining / settings.seconds;

  function start() {
    primeAudio();
    const time = Date.now();
    const from = status === "paused" ? left : settings.seconds;
    if (status !== "paused") warned.current = false;
    // A short countdown is already inside the warning window: no extra beep for it.
    if (from <= WARN_AT) warned.current = true;
    setNow(time);
    setEndAt(time + from * 1000);
    setStatus("running");
  }

  function pause() {
    setLeft(Math.max(0, (endAt - Date.now()) / 1000));
    setStatus("paused");
  }

  function reset() {
    setStatus("idle");
    setLeft(0);
  }

  function setSeconds(seconds: number) {
    reset();
    setSettings({ ...settings, seconds: clamp(seconds, 1, 36000) });
  }

  const { h, m, s } = splitSeconds(settings.seconds);
  const minutes = h * 60 + m;
  const running = status === "running";
  const editable = status === "idle";
  const R = 96;
  const C = 2 * Math.PI * R;

  return (
    <ToolFrame id="countdown" onReset={reset}>
      <div
        className={cn(
          "flex flex-col items-center gap-4 rounded-3xl border border-border bg-card px-4 py-8",
          status === "done" &&
            "border-destructive bg-destructive/10 motion-safe:animate-pulse",
        )}
      >
        <div className="relative grid size-60 place-items-center">
          <svg
            viewBox="0 0 220 220"
            aria-hidden
            className="absolute inset-0 -rotate-90"
          >
            <circle
              cx={110}
              cy={110}
              r={R}
              fill="none"
              strokeWidth={10}
              className="stroke-muted"
            />
            <circle
              cx={110}
              cy={110}
              r={R}
              fill="none"
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - ratio)}
              className={cn(
                "transition-[stroke-dashoffset] duration-200 ease-linear",
                status === "done" ? "stroke-destructive" : "stroke-primary",
              )}
            />
          </svg>
          <p
            role="timer"
            aria-label={t("remaining")}
            className="text-5xl font-bold tracking-tight tabular-nums"
          >
            {formatClock(remaining)}
          </p>
        </div>
        <p
          aria-live="assertive"
          className="min-h-6 text-lg font-semibold text-destructive"
        >
          {status === "done" ? t("timesUp") : ""}
        </p>
      </div>

      {editable && (
        <>
          <section
            aria-labelledby="cd-duration"
            className="flex flex-col gap-3"
          >
            <SectionLabel id="cd-duration">{t("duration")}</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={settings.seconds === preset}
                  onClick={() => setSeconds(preset)}
                  className={chipClass(settings.seconds === preset)}
                >
                  {formatClock(preset)}
                </button>
              ))}
            </div>
            <SettingRow label={t("minutes")}>
              <Stepper
                label={t("minutes")}
                decreaseLabel={t("fewerMinutes")}
                increaseLabel={t("moreMinutes")}
                value={minutes}
                onChange={(v) =>
                  v !== undefined &&
                  setSeconds(
                    toSeconds(0, clamp(Math.trunc(v), 0, MAX_MINUTES), s) || 1,
                  )
                }
              />
            </SettingRow>
            <SettingRow label={t("seconds")}>
              <Stepper
                label={t("seconds")}
                decreaseLabel={t("fewerSeconds")}
                increaseLabel={t("moreSeconds")}
                value={s}
                onChange={(v) =>
                  v !== undefined &&
                  setSeconds(
                    toSeconds(0, minutes, clamp(Math.trunc(v), 0, 59)) || 1,
                  )
                }
              />
            </SettingRow>
          </section>

          <section aria-labelledby="cd-alerts" className="flex flex-col gap-2">
            <SectionLabel id="cd-alerts">{t("alerts")}</SectionLabel>
            <SwitchRow
              label={t("sound")}
              checked={settings.sound}
              onChange={(sound) => setSettings({ ...settings, sound })}
            />
            <SwitchRow
              label={t("vibration")}
              hint={t("vibrationHint")}
              checked={settings.vibration}
              onChange={(vibration) => setSettings({ ...settings, vibration })}
            />
            <SwitchRow
              label={t("warn", { seconds: WARN_AT })}
              checked={settings.warn}
              onChange={(warn) => setSettings({ ...settings, warn })}
            />
          </section>
        </>
      )}

      <ActionBar>
        {status === "done" || status === "paused" ? (
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="h-12 gap-2 rounded-xl px-5 text-base"
            onClick={reset}
          >
            <RotateCcw aria-hidden />
            {t("resetTimer")}
          </Button>
        ) : null}
        {status !== "done" && (
          <Button
            type="button"
            size="lg"
            className={primaryAction}
            onClick={running ? pause : start}
          >
            {running ? <Pause aria-hidden /> : <Play aria-hidden />}
            {running
              ? t("pause")
              : status === "paused"
                ? t("resume")
                : t("start")}
          </Button>
        )}
      </ActionBar>
    </ToolFrame>
  );
}
