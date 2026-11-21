import { describe, expect, it } from "vitest";
import { formatClock, splitSeconds, toSeconds } from "./countdown";

describe("formatClock", () => {
  it("formats minutes and hours", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
  });
  it("rounds a running fraction up so 0:00 only shows at the end", () => {
    expect(formatClock(0.2)).toBe("0:01");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("toSeconds / splitSeconds", () => {
  it("round-trips", () => {
    expect(splitSeconds(toSeconds(1, 2, 5))).toEqual({ h: 1, m: 2, s: 5 });
  });
  it("ignores negatives and NaN, and caps the total", () => {
    expect(toSeconds(-1, Number.NaN, 30)).toBe(30);
    expect(toSeconds(500, 0, 0)).toBe(99 * 3600 + 59 * 60 + 59);
  });
});
