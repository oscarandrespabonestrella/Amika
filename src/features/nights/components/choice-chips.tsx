"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ChipOption<V extends string | number> = {
  value: V;
  label: ReactNode;
  /** Secondary text after the label, dimmed (e.g. a group's player count). */
  extra?: ReactNode;
  /** Accessible name when the label alone is not clear. */
  ariaLabel?: string;
};

/** The pill look shared by option chips and chip-shaped links. */
export function chipClass(selected = false) {
  return cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
    selected
      ? "border-foreground bg-foreground font-semibold text-background"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

/** A small uppercase section label, as in the redesign. */
export function SectionLabel({
  id,
  children,
  as: Tag = "h2",
}: {
  id?: string;
  children: ReactNode;
  as?: "h2" | "h3" | "span";
}) {
  return (
    <Tag
      id={id}
      className="m-0 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {children}
    </Tag>
  );
}

/**
 * One choice among pills (toggle buttons: `aria-pressed`, so each is reachable with
 * Tab and reads as on/off). `trailing` adds extra pills such as a link.
 */
export function ChoiceChips<V extends string | number>({
  labelledBy,
  options,
  value,
  onChange,
  trailing,
  disabled,
}: {
  labelledBy: string;
  options: readonly ChipOption<V>[];
  value: V;
  onChange: (value: V) => void;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={on}
            aria-label={option.ariaLabel}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={chipClass(on)}
          >
            {option.label}
            {option.extra !== undefined && (
              <span className="opacity-70">{option.extra}</span>
            )}
          </button>
        );
      })}
      {trailing}
    </div>
  );
}
