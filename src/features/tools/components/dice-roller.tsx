"use client";

import { Dices } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/utils";
import {
  DICE_TYPES,
  formatFormula,
  MAX_DICE,
  MAX_MODIFIER,
  MAX_SIDES,
  MIN_DICE,
  MIN_SIDES,
  rollDice,
  type DiceRoll,
} from "../dice";
import { prefersReducedMotion } from "../feedback";
import { randomInt, clamp } from "../random";
import { useStoredState } from "../use-stored-state";
import { ActionBar, chipClass, primaryAction, SettingRow } from "./controls";
import { ToolFrame } from "./tool-frame";

const SETTINGS = z.object({
  sides: z.number().int().min(MIN_SIDES).max(MAX_SIDES),
  count: z.number().int().min(MIN_DICE).max(MAX_DICE),
  modifier: z.number().int().min(-MAX_MODIFIER).max(MAX_MODIFIER),
  custom: z.boolean(),
});
type Settings = z.infer<typeof SETTINGS>;
const DEFAULTS: Settings = { sides: 6, count: 2, modifier: 0, custom: false };

const ROLL_MS = 600;
const HISTORY = 6;
const TILT = [-6, 4, -2, 7, -8, 3, -4, 6];

/** D4–D20 or any custom die, several at once, with a modifier. */
export function DiceRoller() {
  const t = useTranslations("Tools.dice");
  const [settings, setSettings] = useStoredState("dice", SETTINGS, DEFAULTS);
  const [result, setResult] = useState<DiceRoll | null>(null);
  const [shown, setShown] = useState<number[]>([]);
  const [rolling, setRolling] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const timers = useRef<{ tick?: number; end?: number }>({});

  useEffect(() => {
    const ids = timers.current;
    return () => {
      window.clearInterval(ids.tick);
      window.clearTimeout(ids.end);
    };
  }, []);

  function finish(roll: DiceRoll) {
    setResult(roll);
    setRolling(false);
    setHistory((h) =>
      [
        `${formatFormula(roll.values.length, roll.sides, roll.modifier)} = ${roll.total}`,
        ...h,
      ].slice(0, HISTORY),
    );
  }

  function roll() {
    if (rolling) return;
    const next = rollDice(settings.count, settings.sides, settings.modifier);
    if (prefersReducedMotion()) {
      finish(next);
      return;
    }
    setRolling(true);
    // The faces shuffle while the dice are "in the air"; the real roll is already drawn.
    timers.current.tick = window.setInterval(() => {
      setShown(
        Array.from(
          { length: settings.count },
          () => 1 + randomInt(settings.sides),
        ),
      );
    }, 70);
    timers.current.end = window.setTimeout(() => {
      window.clearInterval(timers.current.tick);
      finish(next);
    }, ROLL_MS);
  }

  function reset() {
    window.clearInterval(timers.current.tick);
    window.clearTimeout(timers.current.end);
    setSettings(DEFAULTS);
    setResult(null);
    setRolling(false);
    setHistory([]);
  }

  const patch = (next: Partial<Settings>) => {
    setSettings({ ...settings, ...next });
    setResult(null);
  };
  const formula = formatFormula(
    settings.count,
    settings.sides,
    settings.modifier,
  );
  const faces = rolling
    ? shown
    : (result?.values ?? Array.from({ length: settings.count }, () => 0));
  const modifier = result?.modifier ?? 0;

  return (
    <ToolFrame id="dice" onReset={reset}>
      <button
        type="button"
        onClick={roll}
        aria-label={t("rollTable")}
        className="flex min-h-72 flex-col items-center justify-center gap-5 rounded-3xl bg-primary p-6 text-primary-foreground shadow-inner outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="flex flex-wrap justify-center gap-3.5">
          {faces.map((value, i) => (
            <span
              key={i}
              aria-hidden
              style={{ rotate: `${TILT[i % TILT.length]}deg` }}
              className={cn(
                "grid size-16 place-items-center rounded-2xl bg-background text-2xl font-bold text-foreground tabular-nums shadow-[0_4px_0_var(--border),0_10px_18px_rgb(0_0_0/0.25)]",
                rolling &&
                  "motion-safe:animate-[tools-shake_0.3s_ease-in-out_infinite]",
              )}
            >
              {value || "?"}
            </span>
          ))}
        </div>
        <div aria-live="polite" className="flex flex-col items-center gap-1">
          <span className="text-sm opacity-80">{formula}</span>
          {result && !rolling ? (
            <>
              <span className="text-5xl leading-none font-bold tabular-nums">
                {result.total}
              </span>
              <span className="text-sm tabular-nums opacity-80">
                {result.values.join(" + ")}
                {modifier !== 0 &&
                  (modifier > 0
                    ? ` + ${modifier}`
                    : ` − ${Math.abs(modifier)}`)}
              </span>
            </>
          ) : (
            <span className="text-sm opacity-80">
              {rolling ? t("rolling") : t("tapToRoll")}
            </span>
          )}
        </div>
      </button>

      {history.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("last")}
          </span>
          <ul className="flex gap-2">
            {history.map((entry, i) => (
              <li
                key={`${i}-${entry}`}
                className="shrink-0 rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-secondary-foreground tabular-nums"
              >
                {entry}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        role="radiogroup"
        aria-label={t("type")}
        className="grid grid-cols-4 gap-1.5"
      >
        {DICE_TYPES.map((sides) => {
          const on = !settings.custom && settings.sides === sides;
          return (
            <button
              key={sides}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => patch({ custom: false, sides })}
              className={cn(chipClass(on), "rounded-xl")}
            >
              d{sides}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={settings.custom}
          onClick={() => patch({ custom: true })}
          className={cn(chipClass(settings.custom), "col-span-2 rounded-xl")}
        >
          {t("custom")}
        </button>
      </div>

      {settings.custom && (
        <SettingRow label={t("sides")}>
          <Stepper
            label={t("sides")}
            decreaseLabel={t("fewerSides")}
            increaseLabel={t("moreSides")}
            value={settings.sides}
            onChange={(v) =>
              v !== undefined &&
              patch({ sides: clamp(Math.trunc(v), MIN_SIDES, MAX_SIDES) })
            }
          />
        </SettingRow>
      )}
      <SettingRow label={t("count")}>
        <Stepper
          label={t("count")}
          decreaseLabel={t("fewer")}
          increaseLabel={t("more")}
          value={settings.count}
          onChange={(v) =>
            v !== undefined &&
            patch({ count: clamp(Math.trunc(v), MIN_DICE, MAX_DICE) })
          }
        />
      </SettingRow>
      <SettingRow label={t("modifier")} hint={t("modifierHint")}>
        <Stepper
          label={t("modifier")}
          decreaseLabel={t("lower")}
          increaseLabel={t("raise")}
          value={settings.modifier}
          onChange={(v) =>
            v !== undefined &&
            patch({
              modifier: clamp(Math.trunc(v), -MAX_MODIFIER, MAX_MODIFIER),
            })
          }
        />
      </SettingRow>

      <ActionBar>
        <Button
          type="button"
          size="lg"
          className={primaryAction}
          onClick={roll}
          disabled={rolling}
        >
          <Dices aria-hidden />
          {t("roll", { formula })}
        </Button>
      </ActionBar>
    </ToolFrame>
  );
}
