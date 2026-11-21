"use client";

import { useSyncExternalStore, type RefObject } from "react";

function subscribe(listener: () => void) {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
}

const noop = () => () => {};

/**
 * Fullscreen for one element. `supported` is false where the browser cannot do it
 * (iPhone Safari), so the button is simply not shown there.
 */
export function useFullscreen(target: RefObject<HTMLElement | null>) {
  const supported = useSyncExternalStore(
    noop,
    () => document.fullscreenEnabled === true,
    () => false,
  );
  const active = useSyncExternalStore(
    subscribe,
    () =>
      target.current !== null && document.fullscreenElement === target.current,
    () => false,
  );
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await target.current?.requestFullscreen();
    } catch {
      // refused by the browser: nothing to do
    }
  }
  return { supported, active, toggle };
}
