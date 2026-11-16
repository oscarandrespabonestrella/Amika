import { describe, expect, it, vi } from "vitest";
import type { Candidate } from "./merge";
import { runRecognizers, type GameRecognizer } from "./recognizer";

const cand = (name: string): Candidate => ({
  gameId: name,
  externalId: null,
  name,
  score: 0.5,
  reasons: ["title"],
});

const make = (
  id: string,
  requiresConsent: boolean,
  result: Candidate[] | Error,
): GameRecognizer & { recognize: ReturnType<typeof vi.fn> } => ({
  id,
  requiresConsent,
  recognize: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});

describe("runRecognizers", () => {
  it("runs local recognizers and returns their candidates", async () => {
    const local = make("local", false, [cand("A")]);
    const out = await runRecognizers([local], { lines: ["x"] }, new Set());
    expect(out).toEqual([cand("A")]);
    expect(local.recognize).toHaveBeenCalledWith({ lines: ["x"] });
  });

  it("NEVER calls a consent-requiring recognizer without consent", async () => {
    const external = make("external", true, [cand("B")]);
    const out = await runRecognizers([external], { lines: ["x"] }, new Set());
    expect(out).toEqual([]);
    expect(external.recognize).not.toHaveBeenCalled();
  });

  it("calls it when its id was consented to", async () => {
    const external = make("external", true, [cand("B")]);
    const out = await runRecognizers(
      [external],
      { lines: ["x"] },
      new Set(["external"]),
    );
    expect(out).toEqual([cand("B")]);
  });

  it("a consent for another id does not authorize it", async () => {
    const external = make("external", true, [cand("B")]);
    await runRecognizers([external], {}, new Set(["something-else"]));
    expect(external.recognize).not.toHaveBeenCalled();
  });

  it("survives a recognizer that throws", async () => {
    const bad = make("bad", false, new Error("boom"));
    const good = make("good", false, [cand("C")]);
    const out = await runRecognizers([bad, good], {}, new Set());
    expect(out).toEqual([cand("C")]);
  });
});
