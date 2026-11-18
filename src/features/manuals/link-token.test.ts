import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { LINK_TTL_MS, signManualLink, verifyManualLink } =
  await import("./link-token");

const SECRET = "s".repeat(40);
const link = {
  url: "https://a.example/rules.pdf",
  gameId: "game-1",
  userId: "user_1",
};

describe("manual link token", () => {
  it("round-trips a valid token", () => {
    const token = signManualLink(link, SECRET, 1000);
    expect(verifyManualLink(token, SECRET, 2000)).toEqual(link);
  });

  it("expires after the TTL", () => {
    const token = signManualLink(link, SECRET, 1000);
    expect(verifyManualLink(token, SECRET, 1000 + LINK_TTL_MS + 1)).toBeNull();
  });

  it("rejects another secret", () => {
    const token = signManualLink(link, SECRET, 1000);
    expect(verifyManualLink(token, "x".repeat(40), 2000)).toBeNull();
  });

  it("rejects a tampered payload (different url, same signature)", () => {
    const token = signManualLink(link, SECRET, 1000);
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        u: "https://evil.example/x.pdf",
        g: "game-1",
        s: "user_1",
        e: 9e15,
      }),
    ).toString("base64url");
    expect(verifyManualLink(`${forged}.${signature}`, SECRET, 2000)).toBeNull();
  });

  it.each(["", "abc", "a.b.c", ".", "a."])("rejects malformed %j", (token) => {
    expect(verifyManualLink(token, SECRET, 2000)).toBeNull();
  });
});
