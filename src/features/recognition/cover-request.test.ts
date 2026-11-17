import { describe, expect, it, vi } from "vitest";
import {
  handleCoverRequest,
  handlePackCoverRequest,
  type CoverDeps,
  type PackCoverDeps,
} from "./cover-request";

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

describe("handlePackCoverRequest", () => {
  const PACK_URL = "https://cf.geekdo-images.com/x/pic224517.jpg";
  function packDeps(over: Partial<PackCoverDeps> = {}) {
    return {
      userId: vi.fn(async () => "user_1" as string | null),
      packCoverUrl: vi.fn((id: string) =>
        id === "224517" ? PACK_URL : (null as string | null),
      ),
      isAllowed: vi.fn(() => true),
      fetchCover: vi.fn(
        async () => new Uint8Array([1, 2, 3]) as Uint8Array | null,
      ),
      toJpeg: vi.fn(async () => JPEG as Uint8Array | null),
      ...over,
    } as PackCoverDeps & Record<keyof PackCoverDeps, ReturnType<typeof vi.fn>>;
  }

  it("returns the manifest cover as a JPEG with the same headers as a catalog cover", async () => {
    const d = packDeps();
    const res = await handlePackCoverRequest("224517", d);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    expect(res.body).toBe(JPEG);
    expect(res.headers["Content-Type"]).toBe("image/jpeg");
    expect(res.headers["Cache-Control"]).toBe("private, max-age=604800");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(d.fetchCover).toHaveBeenCalledWith(PACK_URL);
  });

  it("is 401 without a session, before looking at anything else", async () => {
    const d = packDeps({ userId: vi.fn(async () => null) });
    for (const id of ["224517", "../1", ""])
      expect(await handlePackCoverRequest(id, d)).toEqual({ status: 401 });
    expect(d.packCoverUrl).not.toHaveBeenCalled();
    expect(d.fetchCover).not.toHaveBeenCalled();
  });

  it("is 404 for ids that are not 1-9 digits, without a lookup or a fetch", async () => {
    const d = packDeps();
    for (const id of [
      "abc",
      "../1",
      "%2e%2e",
      "1/2",
      "12345678901",
      "-1",
      "1 ",
      "1e3",
      "",
      "__proto__",
    ])
      expect(await handlePackCoverRequest(id, d), id).toEqual({ status: 404 });
    expect(d.packCoverUrl).not.toHaveBeenCalled();
    expect(d.fetchCover).not.toHaveBeenCalled();
  });

  it("is the same 404 for a well-formed id that is not in the pack", async () => {
    const d = packDeps();
    expect(await handlePackCoverRequest("999999999", d)).toEqual({
      status: 404,
    });
    expect(d.fetchCover).not.toHaveBeenCalled();
  });

  it("is 404 when the manifest URL is not an allowed cover host, and never fetches it", async () => {
    const d = packDeps({ isAllowed: vi.fn(() => false) });
    expect(await handlePackCoverRequest("224517", d)).toEqual({ status: 404 });
    expect(d.fetchCover).not.toHaveBeenCalled();
  });

  it("is 502 when the download or the JPEG conversion fails", async () => {
    expect(
      await handlePackCoverRequest(
        "224517",
        packDeps({ fetchCover: vi.fn(async () => null) }),
      ),
    ).toEqual({ status: 502 });
    expect(
      await handlePackCoverRequest(
        "224517",
        packDeps({ toJpeg: vi.fn(async () => null) }),
      ),
    ).toEqual({ status: 502 });
  });
});
