import { describe, expect, it, vi } from "vitest";
import { coverEndpoint, fetchCoverFrame } from "./frames";

describe("coverEndpoint", () => {
  it("sends catalog games to /api/covers/<uuid> and pack games to /api/covers/pack/<bggId>", () => {
    const uuid = "00000000-0000-4000-8000-0000000000a1";
    expect(coverEndpoint(uuid)).toBe(`/api/covers/${uuid}`);
    expect(coverEndpoint("bgg:224517")).toBe("/api/covers/pack/224517");
  });

  it("encodes anything odd so it cannot change the path", () => {
    expect(coverEndpoint("bgg:1/../2")).toBe("/api/covers/pack/1%2F..%2F2");
  });
});

describe("fetchCoverFrame", () => {
  it("requests the pack endpoint for a bgg: id and fails clearly on a non-OK answer", async () => {
    const fetchStub = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      fetchCoverFrame("bgg:224517", fetchStub as unknown as typeof fetch),
    ).rejects.toThrow(/bgg:224517.*404/);
    expect(fetchStub).toHaveBeenCalledWith("/api/covers/pack/224517", {
      credentials: "same-origin",
    });
  });
});
