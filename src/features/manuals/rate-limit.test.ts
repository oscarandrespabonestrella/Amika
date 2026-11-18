import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONTHLY_CALL_LIMIT,
  isSearchOverLimit,
  SEARCH_LIMITS,
  startOfMonthUtc,
  wouldExceedBudget,
} from "./rate-limit";

describe("monthly budget", () => {
  it("the default cap leaves a margin under a 1000-call plan", () => {
    expect(DEFAULT_MONTHLY_CALL_LIMIT).toBeLessThan(1000);
  });

  it("allows a search that lands exactly on the cap and refuses the next one", () => {
    expect(wouldExceedBudget(795, 5, 800)).toBe(false);
    expect(wouldExceedBudget(796, 5, 800)).toBe(true);
    expect(wouldExceedBudget(800, 1, 800)).toBe(true);
    expect(wouldExceedBudget(0, 5, 800)).toBe(false);
  });

  it("the quota window starts at the first instant of the UTC month", () => {
    expect(
      startOfMonthUtc(new Date("2026-11-30T23:59:59Z")).toISOString(),
    ).toBe("2026-11-01T00:00:00.000Z");
    expect(
      startOfMonthUtc(new Date("2026-12-01T00:00:00Z")).toISOString(),
    ).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("per-user search limits", () => {
  it("one user needs many days of live searches to reach the monthly cap", () => {
    // 10 live searches a day x 5 calls = 50 calls a day: 800 takes 16 days
    expect(SEARCH_LIMITS.perDay * 5 * 16).toBeGreaterThanOrEqual(800);
  });

  it("refuses at the per-minute and per-day limits", () => {
    expect(isSearchOverLimit({ lastMinute: 2, lastDay: 9 })).toBe(false);
    expect(isSearchOverLimit({ lastMinute: 3, lastDay: 0 })).toBe(true);
    expect(isSearchOverLimit({ lastMinute: 0, lastDay: 10 })).toBe(true);
  });
});
