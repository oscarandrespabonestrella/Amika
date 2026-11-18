"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  /** The game card (its link). */
  card: ReactNode;
  /** The expansion items shown when the toggle is open. */
  expansions: ReactNode[];
  /** Short visible label, e.g. "3 exp". */
  label: string;
  /** Full accessible name, e.g. "3 expansions". */
  ariaLabel: string;
};

/**
 * Overlays a "{n} exp" button on the bottom-right of the card (next to the pills). It is a
 * sibling of the link, not a child, so the markup stays valid.
 */
export function ExpansionsToggle({
  card,
  expansions,
  label,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  return (
    <>
      <div className="relative">
        {card}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          onClick={() => setOpen((v) => !v)}
          className="absolute right-3 bottom-3 inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {label}
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>
      {open && (
        <ul
          id={listId}
          className="mt-1 ml-4 flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2"
        >
          {expansions}
        </ul>
      )}
    </>
  );
}
