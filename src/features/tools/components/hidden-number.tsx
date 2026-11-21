"use client";

import { Eye, EyeOff, Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/utils";
import { checkRange, drawNumbers, RANGE_LIMIT } from "../hidden-number";
import { NO_NAMES, PLAYER_NAMES } from "../names";
import { clamp } from "../random";
import type { ToolRoster } from "../types";
import { useStoredState } from "../use-stored-state";
import {
  ActionBar,
  primaryAction,
  SectionLabel,
  SettingRow,
  SwitchRow,
} from "./controls";
import { NamesEditor } from "./names-editor";
import { ToolFrame } from "./tool-frame";

const SETTINGS = z.object({
  min: z.number().int().min(-RANGE_LIMIT).max(RANGE_LIMIT),
  max: z.number().int().min(-RANGE_LIMIT).max(RANGE_LIMIT),
  unique: z.boolean(),
  players: z.number().int().min(1).max(24),
});
type Settings = z.infer<typeof SETTINGS>;
const DEFAULTS: Settings = { min: 1, max: 100, unique: true, players: 2 };

/**
 * One secret number per player (or a single one), hidden until its owner taps it.
 * Useful for "who is closest", secret-role games or any number only you may see.
 */
export function HiddenNumber({ roster }: { roster: ToolRoster }) {
  const t = useTranslations("Tools.hidden");
  const [settings, setSettings] = useStoredState(
    "hidden-number",
    SETTINGS,
    DEFAULTS,
  );
  const [names, setNames] = useStoredState("players", PLAYER_NAMES, NO_NAMES);
  const [numbers, setNumbers] = useState<number[]>([]);
  const [revealed, setRevealed] = useState<boolean[]>([]);

  // With names listed there is one number per name; otherwise the stepper decides.
  const count = names.length > 0 ? names.length : settings.players;
  const problem = checkRange(
    count,
    settings.min,
    settings.max,
    settings.unique,
  );
  const labelFor = (i: number) => names[i] ?? t("player", { number: i + 1 });

  function draw() {
    const next = drawNumbers(
      count,
      settings.min,
      settings.max,
      settings.unique,
    );
    if (!next) return;
    setNumbers(next);
    setRevealed(next.map(() => false));
  }

  function patch(next: Partial<Settings>) {
    setSettings({ ...settings, ...next });
    setNumbers([]);
  }

  const allShown = revealed.length > 0 && revealed.every(Boolean);

  return (
    <ToolFrame
      id="hidden"
      onReset={() => {
        setNumbers([]);
        setRevealed([]);
      }}
      fullscreen={false}
    >
      {numbers.length > 0 && (
        <section aria-labelledby="hn-result" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel id="hn-result">{t("result")}</SectionLabel>
            <Button
              type="button"
              variant="ghost"
              className="h-9 gap-1.5 px-2.5"
              onClick={() => setRevealed(numbers.map(() => !allShown))}
            >
              {allShown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {allShown ? t("hideAll") : t("revealAll")}
            </Button>
          </div>
          <ul className="grid grid-cols-2 gap-3">
            {numbers.map((value, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-pressed={revealed[i]}
                  onClick={() =>
                    setRevealed((r) => r.map((v, j) => (j === i ? !v : v)))
                  }
                  className={cn(
                    "flex min-h-28 w-full flex-col items-center justify-center gap-1 rounded-2xl border p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    revealed[i]
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-muted",
                  )}
                >
                  <span className="max-w-full truncate text-sm text-muted-foreground">
                    {labelFor(i)}
                  </span>
                  {revealed[i] ? (
                    <span className="text-4xl font-bold tabular-nums motion-safe:animate-[tools-pop_0.25s_ease-out]">
                      {value}
                    </span>
                  ) : (
                    <>
                      <span
                        aria-hidden
                        className="text-4xl font-bold tracking-widest text-muted-foreground"
                      >
                        ••
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("tapToReveal")}
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="hn-range" className="flex flex-col gap-3">
        <SectionLabel id="hn-range">{t("range")}</SectionLabel>
        <SettingRow label={t("min")}>
          <Stepper
            label={t("min")}
            decreaseLabel={t("lowerMin")}
            increaseLabel={t("raiseMin")}
            value={settings.min}
            invalid={problem === "empty"}
            onChange={(v) =>
              v !== undefined &&
              patch({
                min: clamp(Math.trunc(v), -RANGE_LIMIT, RANGE_LIMIT),
              })
            }
          />
        </SettingRow>
        <SettingRow label={t("max")}>
          <Stepper
            label={t("max")}
            decreaseLabel={t("lowerMax")}
            increaseLabel={t("raiseMax")}
            value={settings.max}
            invalid={problem === "empty"}
            onChange={(v) =>
              v !== undefined &&
              patch({
                max: clamp(Math.trunc(v), -RANGE_LIMIT, RANGE_LIMIT),
              })
            }
          />
        </SettingRow>
        {names.length === 0 && (
          <SettingRow label={t("players")} hint={t("playersHint")}>
            <Stepper
              label={t("players")}
              decreaseLabel={t("fewer")}
              increaseLabel={t("more")}
              value={settings.players}
              onChange={(v) =>
                v !== undefined &&
                patch({ players: clamp(Math.trunc(v), 1, 24) })
              }
            />
          </SettingRow>
        )}
        <SwitchRow
          label={t("unique")}
          hint={t("uniqueHint")}
          checked={settings.unique}
          onChange={(unique) => patch({ unique })}
        />
        {problem !== "ok" && (
          <p role="alert" className="text-sm text-destructive">
            {t(problem === "empty" ? "badRange" : "tooSmall")}
          </p>
        )}
      </section>

      <NamesEditor
        names={names}
        onChange={(next) => {
          setNames(next);
          setNumbers([]);
        }}
        roster={roster}
        title={t("names")}
        placeholder={t("placeholder")}
      />

      <ActionBar>
        <Button
          type="button"
          size="lg"
          className={primaryAction}
          onClick={draw}
          disabled={problem !== "ok"}
        >
          <Shuffle aria-hidden />
          {numbers.length > 0 ? t("again") : t("draw", { count })}
        </Button>
      </ActionBar>
    </ToolFrame>
  );
}
