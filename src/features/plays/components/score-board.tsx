"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Stepper } from "@/components/ui/stepper";
import {
  CategoryInput,
  type Definition,
  type FieldErrorCode,
  type ScoreValue,
} from "@/features/scoring/client";
import { cn } from "@/lib/utils";

type Scorable = Exclude<Definition["categories"][number], { type: "derived" }>;

export type BoardRow = {
  uid: number;
  /** The player's name, or "Player n" while it is still empty. */
  label: string;
  values: Record<string, ScoreValue | undefined>;
  manual: number | undefined;
  errors: Record<string, FieldErrorCode | undefined>;
};

type Props = {
  /** The sheet, or null for "no sheet: enter totals". */
  definition: Definition | null;
  rows: readonly BoardRow[];
  onValue: (uid: number, key: string, value: ScoreValue | undefined) => void;
  onManual: (uid: number, value: number | undefined) => void;
};

/**
 * Scores one category at a time for every player (the way score-pad apps do it): tabs pick
 * the category, each player gets the control for its type. Derived categories are computed,
 * so they have no tab. Without a sheet there is a single list of totals.
 */
export function ScoreBoard({ definition, rows, onValue, onManual }: Props) {
  const t = useTranslations("Plays.form");
  const ts = useTranslations("Scoring");
  const [activeKey, setActiveKey] = useState<string | null>(null);

  if (definition === null) {
    return (
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.uid}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3"
          >
            <span className="min-w-0 truncate font-medium">{row.label}</span>
            <Stepper
              label={t("manualFor", { player: row.label })}
              decreaseLabel={t("decrease", { label: row.label })}
              increaseLabel={t("increase", { label: row.label })}
              value={row.manual}
              invalid={row.errors.manual !== undefined}
              onChange={(n) => onManual(row.uid, n)}
            />
            {row.errors.manual && (
              <p className="w-full text-sm text-destructive">
                {ts(`fieldErrors.${row.errors.manual}`)}
              </p>
            )}
          </li>
        ))}
      </ul>
    );
  }

  const categories = definition.categories.filter(
    (c): c is Scorable => c.type !== "derived",
  );
  const active =
    categories.find((c) => c.key === activeKey) ?? categories[0] ?? null;
  if (active === null) return null;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={t("categoriesLabel")}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4"
      >
        {categories.map((category) => {
          const selected = category.key === active.key;
          const hasError = rows.some(
            (row) => row.errors[category.key] !== undefined,
          );
          return (
            <button
              key={category.key}
              id={`cat-tab-${category.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="cat-panel"
              onClick={() => setActiveKey(category.key)}
              className={cn(
                "relative min-h-11 shrink-0 px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                selected
                  ? "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {category.label}
              {hasError && (
                <span
                  aria-hidden
                  className="absolute top-2 right-1 size-1.5 rounded-full bg-destructive"
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        id="cat-panel"
        role="tabpanel"
        aria-labelledby={`cat-tab-${active.key}`}
      >
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const error = row.errors[active.key];
            const stacked = active.type === "set_bonus";
            return (
              <li
                key={`${row.uid}-${active.key}`}
                className={cn(
                  "rounded-2xl border border-border bg-card p-3",
                  stacked
                    ? "flex flex-col gap-3"
                    : "flex flex-wrap items-center justify-between gap-3",
                )}
              >
                <span className="min-w-0 truncate font-medium">
                  {row.label}
                </span>
                <CategoryInput
                  category={active}
                  subject={row.label}
                  value={row.values[active.key]}
                  invalid={error !== undefined}
                  describedBy={
                    error ? `err-${row.uid}-${active.key}` : undefined
                  }
                  onChange={(value) => onValue(row.uid, active.key, value)}
                />
                {error && (
                  <p
                    id={`err-${row.uid}-${active.key}`}
                    className="w-full text-sm text-destructive"
                  >
                    {ts(`fieldErrors.${error}`)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
