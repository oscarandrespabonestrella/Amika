import { describe, expect, it, vi } from "vitest";
import { handleCoverRequest, type CoverDeps } from "./cover-request";

const GAME = "00000000-0000-4000-8000-0000000000a1";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function deps(over: Partial<CoverDeps> = {}) {
  return {
    userId: vi.fn(async () => "user_1" as string | null),
    findCoverUrl: vi.fn(
      async () => "https://cf.geekdo-images.com/x/pic1.jpg" as string | null,
    ),
    isAllowed: vi.fn(() => true),
    fetchCover: vi.fn(
      async () => new Uint8Array([1, 2, 3]) as Uint8Array | null,
    ),
    toJpeg: vi.fn(async () => JPEG as Uint8Array | null),
    ...over,
  } as CoverDeps & Record<keyof CoverDeps, ReturnType<typeof vi.fn>>;
}

describe("handleCoverRequest", () => {
  it("returns the cover as a JPEG with private caching and nosniff", async () => {
    const res = await handleCoverRequest(GAME, deps());
    expect(res).toMatchObject({ status: 200 });
    if (res.status !== 200) throw new Error("unreachable");
    expect(res.body).toBe(JPEG);
    expect(res.headers["Content-Type"]).toBe("image/jpeg");
    expect(res.headers["Cache-Control"]).toBe("private, max-age=604800");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Content-Length"]).toBe(String(JPEG.length));
  });

  it("is 401 without a session, before looking at anything else", async () => {
    const d = deps({ userId: vi.fn(async () => null) });
    for (const id of [GAME, "not-a-uuid", ""]) {
      expect(await handleCoverRequest(id, d)).toEqual({ status: 401 });
    }
    expect(d.findCoverUrl).not.toHaveBeenCalled();
    expect(d.fetchCover).not.toHaveBeenCalled();
  });

  it("is 404 for a malformed id without touching the database or the network", async () => {
    const d = deps();
    for (const id of ["nope", "123", "'; drop table games;--", GAME + "x"]) {
      expect(await handleCoverRequest(id, d)).toEqual({ status: 404 });
    }
    expect(d.findCoverUrl).not.toHaveBeenCalled();
    expect(d.fetchCover).not.toHaveBeenCalled();
  });

  it("a game that is missing, not visible to the user or without a cover is the SAME 404", async () => {
    const d = deps({ findCoverUrl: vi.fn(async () => null) });
    expect(await handleCoverRequest(GAME, d)).toEqual({ status: 404 });
    expect(d.fetchCover).not.toHaveBeenCalled();
  });

  it("a cover on a host that is not allowed is 404 and is never fetched", async () => {
    const d = deps({
      findCoverUrl: vi.fn(async () => "https://169.254.169.254/latest"),
      isAllowed: vi.fn(() => false),
    });
    expect(await handleCoverRequest(GAME, d)).toEqual({ status: 404 });
    expect(d.fetchCover).not.toHaveBeenCalled();
  });

  it("is 502 when the upstream fetch fails or the image cannot be decoded", async () => {
    expect(
      await handleCoverRequest(
        GAME,
        deps({ fetchCover: vi.fn(async () => null) }),
      ),
    ).toEqual({ status: 502 });
    expect(
      await handleCoverRequest(GAME, deps({ toJpeg: vi.fn(async () => null) })),
    ).toEqual({ status: 502 });
  });

  it("never echoes the cover URL or any error text", async () => {
    const res = await handleCoverRequest(
      GAME,
      deps({ fetchCover: vi.fn(async () => null) }),
    );
    expect(JSON.stringify(res)).not.toContain("geekdo");
  });
});
