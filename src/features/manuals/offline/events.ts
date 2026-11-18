// Several buttons and lists can show the same saved manual at once. They tell each other
// when the saved set changes (same tab only: the Cache Storage itself is shared).

const EVENT = "amika-manuals-changed";

export function notifyManualsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** Subscribe; returns the unsubscribe function. */
export function onManualsChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
