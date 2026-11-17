"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type StepperProps = {
  id?: string;
  /** Accessible name of the number field (the buttons carry their own labels). */
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
};

const button =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-secondary-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * A whole-number field with − and + buttons for the thumb. It keeps its own text while
 * typing (a half-typed "-" is not an error) and reports any parseable number (even a
 * fraction, so the scoring engine can flag it) or `undefined` when empty. An empty field
 * counts as 0 for the buttons.
 */
export function Stepper({
  id,
  label,
  decreaseLabel,
  increaseLabel,
  value,
  onChange,
  invalid,
  describedBy,
  className,
}: StepperProps) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  // The value changed from outside (another row was removed, the sheet was swapped): follow it.
  const parsed = text.trim() === "" ? undefined : Number(text);
  const outOfSync = !Number.isNaN(parsed) && parsed !== value;
  const shown = outOfSync ? (value === undefined ? "" : String(value)) : text;

  function set(next: number | undefined) {
    setText(next === undefined ? "" : String(next));
    onChange(next);
  }
  const base = Number.isFinite(value) ? Math.trunc(value as number) : 0;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        className={button}
        aria-label={decreaseLabel}
        onClick={() => set(base - 1)}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={shown}
        placeholder="0"
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          if (raw.trim() === "") onChange(undefined);
          else {
            const n = Number(raw);
            if (!Number.isNaN(n)) onChange(n);
          }
        }}
        className="h-11 w-16 min-w-0 [appearance:textfield] rounded-xl border border-input bg-transparent text-center text-lg font-semibold tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        className={button}
        aria-label={increaseLabel}
        onClick={() => set(base + 1)}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
