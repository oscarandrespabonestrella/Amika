import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE,
  dismiss,
  markPlayLogged,
  parseState,
  recordVisit,
  shouldPrompt,
  snooze,
} from "./install-state";

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date(2026, 10, 18, 12).getTime();

describe("install-state", () => {
  it("does not prompt on a fresh state", () => {
    expect(shouldPrompt(EMPTY_STATE, t0)).toBe(false);
  });

  it("counts the same day only once", () => {
    let s = recordVisit(EMPTY_STATE, t0);
    s = recordVisit(s, t0 + 1000);
    expect(s.visitDays).toHaveLength(1);
  });

  it("prompts from the 3rd distinct day", () => {
    let s = recordVisit(EMPTY_STATE, t0);
    s = recordVisit(s, t0 + DAY);
    expect(shouldPrompt(s, t0 + DAY)).toBe(false);
    s = recordVisit(s, t0 + 2 * DAY);
    expect(shouldPrompt(s, t0 + 2 * DAY)).toBe(true);
  });

  it("prompts right after a play is logged", () => {
    expect(shouldPrompt(markPlayLogged(EMPTY_STATE), t0)).toBe(true);
  });

  it("snoozing hides it for 14 days", () => {
    const s = snooze(markPlayLogged(EMPTY_STATE), t0);
    expect(shouldPrompt(s, t0 + 13 * DAY)).toBe(false);
    expect(shouldPrompt(s, t0 + 14 * DAY)).toBe(true);
  });

  it("dismissing hides it for good", () => {
    const s = dismiss(markPlayLogged(EMPTY_STATE));
    expect(shouldPrompt(s, t0 + 365 * DAY)).toBe(false);
  });

  it("parseState tolerates garbage", () => {
    expect(parseState(null)).toEqual(EMPTY_STATE);
    expect(parseState("{not json")).toEqual(EMPTY_STATE);
    expect(
      parseState('{"visitDays":[1,"2026-01-01"],"playLogged":"x"}'),
    ).toEqual({
      ...EMPTY_STATE,
      visitDays: ["2026-01-01"],
    });
  });
});
