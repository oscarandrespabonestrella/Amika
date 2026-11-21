"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ZodType } from "zod";

// Simple per-device settings in localStorage (ADR-045 does the same for the install
// banner). Reads are validated with a schema, so an old or hand-edited value falls back
// to the default instead of breaking a tool. If storage is blocked (private mode), the
// value lives in memory for the session. Callers pass module-level `schema`/`fallback`.

const PREFIX = "amika.tools.";
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: unknown }>();
const inMemory = new Map<string, unknown>();

function read<T>(key: string, schema: ZodType<T>, fallback: T): T {
  if (inMemory.has(key)) return inMemory.get(key) as T;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // storage unavailable: keep the default
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value = fallback;
  if (raw !== null) {
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) value = parsed.data;
    } catch {
      // corrupt JSON: keep the default
    }
  }
  cache.set(key, { raw, value });
  return value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** `useState` that survives reloads. The server and first client render use `fallback`. */
export function useStoredState<T>(
  name: string,
  schema: ZodType<T>,
  fallback: T,
): readonly [T, (next: T | ((previous: T) => T)) => void] {
  const key = PREFIX + name;
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, schema, fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: T | ((previous: T) => T)) => {
      const previous = read(key, schema, fallback);
      const resolved =
        typeof next === "function"
          ? (next as (previous: T) => T)(previous)
          : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
        inMemory.delete(key);
      } catch {
        inMemory.set(key, resolved);
      }
      listeners.forEach((listener) => listener());
    },
    [key, schema, fallback],
  );
  return [value, set] as const;
}
