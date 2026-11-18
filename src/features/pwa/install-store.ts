"use client";

import { useSyncExternalStore } from "react";

// Module-level store: `beforeinstallprompt` can fire before any component that wants it
// has mounted, so it is captured once (by ServiceWorkerRegister) and shared.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallSnapshot = {
  /** The browser offered a native install prompt. */
  canPrompt: boolean;
  installed: boolean;
  /** iOS Safari: no prompt API, the user must use Share → Add to Home Screen. */
  ios: boolean;
};

const SERVER_SNAPSHOT: InstallSnapshot = {
  canPrompt: false,
  installed: false,
  ios: false,
};

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let snapshot: InstallSnapshot = SERVER_SNAPSHOT;
let started = false;
const listeners = new Set<() => void>();

function detectStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function detectIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function publish() {
  snapshot = {
    canPrompt: deferred !== null,
    installed,
    ios: detectIOS(),
  };
  listeners.forEach((l) => l());
}

/** Idempotent: wires the browser events once. */
export function startInstallTracking(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  installed = detectStandalone();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    publish();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    publish();
  });
  publish();
}

function subscribe(listener: () => void) {
  startInstallTracking();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallState(): InstallSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
}

/** Opens the native prompt. Returns true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null; // a prompt can only be used once
  publish();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
