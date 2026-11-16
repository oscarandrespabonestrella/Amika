// Pure: types only plus a tiny runner. The extension point for recognizers: today every
// recognizer is local. An external (paid) one would declare `requiresConsent: true` and
// is never run unless its id was explicitly authorized by the user.
import type { Candidate } from "./merge";

export type RecognizerInput = {
  gtin?: string;
  lines?: string[];
};

export interface GameRecognizer {
  id: string;
  requiresConsent: boolean;
  recognize(input: RecognizerInput): Promise<Candidate[]>;
}

/** Runs the recognizers allowed to run; one that throws is skipped, never fatal. */
export async function runRecognizers(
  recognizers: GameRecognizer[],
  input: RecognizerInput,
  consent: ReadonlySet<string>,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const r of recognizers) {
    if (r.requiresConsent && !consent.has(r.id)) continue;
    try {
      out.push(...(await r.recognize(input)));
    } catch {
      // A failing recognizer must not hide the others' results.
    }
  }
  return out;
}
