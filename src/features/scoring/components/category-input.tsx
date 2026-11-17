"use client";

import { useTranslations } from "next-intl";
import { NativeSelect } from "@/components/ui/native-select";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/utils";
import { updateCounters } from "../draft";
import type { Category } from "../engine/definition";
import type { ScoreValue } from "../engine/evaluate";

type Props = {
  category: Exclude<Category, { type: "derived" }>;
  /** Names the controls for assistive tech: the category plus whose points these are. */
  subject: string;
  value: ScoreValue | undefined;
  onChange: (value: ScoreValue | undefined) => void;
  invalid?: boolean;
  describedBy?: string;
};

/** Up to this many options are shown as buttons; more go in a list. */
const MAX_SEGMENTED = 4;

const SWITCH =
  "relative h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full border border-border bg-muted transition-colors outline-none checked:border-primary checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50 before:absolute before:top-0.5 before:left-0.5 before:size-5 before:rounded-full before:bg-foreground before:transition-transform before:content-[''] checked:before:translate-x-5 checked:before:bg-primary-foreground";

/**
 * One scoring control for ONE player and ONE category, picked by the category type:
 * numbers get − / + steppers, a yes/no is a switch, a choice is a segmented control (or a
 * list when long) and a set bonus is one stepper per item of the set. Used by the match
 * form's category-by-category scoreboard; the value shapes are the engine's, unchanged.
 */
export function CategoryInput({
  category,
  subject,
  value,
  onChange,
  invalid,
  describedBy,
}: Props) {
  const t = useTranslations("Plays.form");
  const ts = useTranslations("Scoring");
  const name = `${category.label} – ${subject}`;

  switch (category.type) {
    case "boolean":
      return (
        <input
          type="checkbox"
          role="switch"
          aria-label={name}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          className={SWITCH}
        />
      );
    case "choice": {
      const current = typeof value === "string" ? value : "";
      if (category.options.length > MAX_SEGMENTED)
        return (
          <NativeSelect
            aria-label={name}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-11 w-44"
            value={current}
            onChange={(event) =>
              onChange(
                event.target.value === "" ? undefined : event.target.value,
              )
            }
          >
            <option value="">{ts("fields.none")}</option>
            {category.options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        );
      return (
        <div
          role="group"
          aria-label={name}
          className="flex flex-wrap justify-end gap-1 rounded-xl border border-border bg-muted p-1"
        >
          {category.options.map((option) => {
            const on = option.key === current;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? undefined : option.key)}
                className={cn(
                  "min-h-9 rounded-lg px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  on
                    ? "bg-secondary font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "set_bonus": {
      const record =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? value
          : {};
      return (
        <div role="group" aria-label={name} className="flex flex-col gap-2">
          {category.inputs.map((input) => (
            <div
              key={input.key}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-sm text-muted-foreground">
                {input.label}
              </span>
              <Stepper
                label={`${input.label} – ${subject}`}
                decreaseLabel={t("decrease", { label: input.label })}
                increaseLabel={t("increase", { label: input.label })}
                value={record[input.key]}
                invalid={invalid}
                onChange={(n) =>
                  onChange(
                    updateCounters(
                      category.inputs.map((i) => i.key),
                      record,
                      input.key,
                      n,
                    ),
                  )
                }
              />
            </div>
          ))}
        </div>
      );
    }
    default:
      return (
        <Stepper
          label={name}
          decreaseLabel={t("decrease", { label: name })}
          increaseLabel={t("increase", { label: name })}
          value={typeof value === "number" ? value : undefined}
          invalid={invalid}
          describedBy={describedBy}
          onChange={onChange}
        />
      );
  }
}
