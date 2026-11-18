// Pure logic (no React, no DOM) for *when* to invite the user to install the app.
// The invitation is deferred on purpose: never on the first visit.

export const INSTALL_STORAGE_KEY = "amika.pwa.install";
export const VISITS_NEEDED = 3;
export const SNOOZE_DAYS = 14;

export type InstallState = {
  /** Distinct local days (YYYY-MM-DD) the app was opened; capped at VISITS_NEEDED. */
  visitDays: string[];
  playLogged: boolean;
  /** Epoch ms until which the banner stays hidden ("Not now"). */
  snoozedUntil: number | null;
  /** "Don't ask again". Settings still offers the install. */
  dismissed: boolean;
};

export const EMPTY_STATE: InstallState = {
  visitDays: [],
  playLogged: false,
  snoozedUntil: null,
  dismissed: false,
};

function dayKey(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function recordVisit(state: InstallState, now: number): InstallState {
  const today = dayKey(now);
  if (
    state.visitDays.includes(today) ||
    state.visitDays.length >= VISITS_NEEDED
  )
    return state;
  return { ...state, visitDays: [...state.visitDays, today] };
}

export function markPlayLogged(state: InstallState): InstallState {
  return state.playLogged ? state : { ...state, playLogged: true };
}

export function snooze(
  state: InstallState,
  now: number,
  days = SNOOZE_DAYS,
): InstallState {
  return { ...state, snoozedUntil: now + days * 24 * 60 * 60 * 1000 };
}

export function dismiss(state: InstallState): InstallState {
  return { ...state, dismissed: true };
}

export function shouldPrompt(state: InstallState, now: number): boolean {
  if (state.dismissed) return false;
  if (state.snoozedUntil !== null && now < state.snoozedUntil) return false;
  return state.visitDays.length >= VISITS_NEEDED || state.playLogged;
}

/** Tolerates missing/corrupt data: anything unexpected falls back to the empty state. */
export function parseState(raw: string | null): InstallState {
  if (!raw) return EMPTY_STATE;
  try {
    const v = JSON.parse(raw) as Partial<InstallState>;
    return {
      visitDays: Array.isArray(v.visitDays)
        ? v.visitDays
            .filter((d): d is string => typeof d === "string")
            .slice(0, VISITS_NEEDED)
        : [],
      playLogged: v.playLogged === true,
      snoozedUntil: typeof v.snoozedUntil === "number" ? v.snoozedUntil : null,
      dismissed: v.dismissed === true,
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function loadState(): InstallState {
  try {
    return parseState(localStorage.getItem(INSTALL_STORAGE_KEY));
  } catch {
    return EMPTY_STATE;
  }
}

export function saveState(state: InstallState): void {
  try {
    localStorage.setItem(INSTALL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode): the invitation just won't persist.
  }
}

/** Read-modify-write helper used by the UI. */
export function updateState(
  fn: (s: InstallState) => InstallState,
): InstallState {
  const next = fn(loadState());
  saveState(next);
  return next;
}
