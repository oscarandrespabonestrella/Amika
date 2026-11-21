"use client";

import { useEffect, useRef } from "react";

/** Calls `fn` every `ms` while the tab is visible (a hidden tab does not poll). */
export function usePoll(fn: () => void, ms = 10_000) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") latest.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
}
