"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  installModel,
  isEnabled,
  modelStatus,
  removeModel,
  setEnabled,
} from "../embedding/activation";

export type Setup = {
  /** false until the browser state has been read (avoids a flash of the wrong card). */
  ready: boolean;
  /** Opted in on this device AND the model is installed. */
  active: boolean;
  installing: boolean;
  /** 0..1, or null while unknown. */
  progress: number | null;
  error: boolean;
  install(): Promise<void>;
  cancel(): void;
  /** Turns the feature off on this device and deletes the downloaded model. */
  remove(): Promise<void>;
};

/** The per-device opt-in: nothing downloads until `install()` is called by a user action. */
export function useRecognitionSetup(): Setup {
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const on = isEnabled() && (await modelStatus()) === "installed";
      if (!alive) return;
      setActive(on);
      setReady(true);
    })();
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const install = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(false);
    setInstalling(true);
    setProgress(null);
    try {
      await installModel(
        (p) =>
          setProgress(p.total > 0 ? Math.min(1, p.loaded / p.total) : null),
        controller.signal,
      );
      setEnabled(true);
      setActive(true);
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === "AbortError";
      if (!cancelled) setError(true);
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const remove = useCallback(async () => {
    setEnabled(false);
    await removeModel();
    setActive(false);
  }, []);

  return {
    ready,
    active,
    installing,
    progress,
    error,
    install,
    cancel,
    remove,
  };
}
