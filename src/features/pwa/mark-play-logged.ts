import { markPlayLogged as mark, updateState } from "./install-state";

/** Call after the user logs a play: it unlocks the (deferred) install invitation. */
export function markPlayLogged(): void {
  updateState(mark);
}
