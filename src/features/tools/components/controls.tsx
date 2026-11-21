import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The pill look of an option chip (die type, preset, group shortcut…). */
export function chipClass(selected = false) {
  return cn(
    "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
    selected
      ? "border-foreground bg-foreground font-semibold text-background"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

/** A small uppercase section label, as in the rest of the app. */
export function SectionLabel({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <h2
      id={id}
      className="m-0 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {children}
    </h2>
  );
}

/** A label (and optional hint) on the left, its control on the right. */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

/** A labelled on/off switch, in the same style as the "live" switch of the match form. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-muted-foreground">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="relative h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full border border-border bg-muted transition-colors outline-none before:absolute before:top-0.5 before:left-0.5 before:size-5 before:rounded-full before:bg-foreground before:transition-transform before:content-[''] checked:border-primary checked:bg-primary checked:before:translate-x-5 checked:before:bg-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </label>
  );
}

/**
 * The tool's main action, kept in reach: on a phone it rides above the bottom
 * navigation (same as "Save" in the match form), in fullscreen it sits at the edge.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 -mx-4 flex gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur in-data-[fullscreen=true]:bottom-0 md:bottom-0 md:mx-0 md:rounded-2xl md:border">
      {children}
    </div>
  );
}

export const primaryAction =
  "h-12 flex-1 gap-2 rounded-xl px-6 text-base [&_svg:not([class*='size-'])]:size-5";
