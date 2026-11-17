"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type GameTab = {
  id: string;
  label: string;
  /** Shown next to the label ("Matches 8"). */
  count?: number;
  content: ReactNode;
};

type Props = { tabs: readonly GameTab[]; label: string };

/**
 * Overview · Matches · Expansions · Sheets. Every panel is rendered on the server and stays in
 * the page; only the active one is shown. `?tab=` picks the tab on arrival and follows the
 * user's choice (without a navigation), so a tab can be linked to.
 */
export function GameTabs({ tabs, label }: Props) {
  const [active, setActive] = useState(() => {
    if (typeof window === "undefined") return tabs[0].id;
    const wanted = new URLSearchParams(window.location.search).get("tab");
    return tabs.some((tab) => tab.id === wanted) ? wanted! : tabs[0].id;
  });
  const current = tabs.some((tab) => tab.id === active) ? active : tabs[0].id;

  function choose(id: string) {
    setActive(id);
    const url = new URL(window.location.href);
    if (id === tabs[0].id) url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label={label}
        className="-mx-4 flex gap-5 overflow-x-auto border-b border-border px-4"
      >
        {tabs.map((tab) => {
          const selected = tab.id === current;
          return (
            <button
              key={tab.id}
              id={`game-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`game-panel-${tab.id}`}
              onClick={() => choose(tab.id)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1.5 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                selected
                  ? "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`game-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`game-tab-${tab.id}`}
          hidden={tab.id !== current}
          className="flex flex-col gap-8"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
