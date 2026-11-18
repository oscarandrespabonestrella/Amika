"use client";

import { useEffect } from "react";
import { startInstallTracking } from "../install-store";

/** Registers the minimal service worker and starts capturing the install prompt. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    startInstallTracking();
    if (process.env.NODE_ENV !== "production") return; // avoid a stale SW while developing
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Not installable without it, but the app itself keeps working.
      });
  }, []);
  return null;
}
