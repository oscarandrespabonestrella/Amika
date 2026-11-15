import { describe, expect, it, vi } from "vitest";
import { createBggSource } from "./client";
import { BggError } from "./errors";
import { EMPTY_XML, SEARCH_XML, THING_XML } from "./fixtures";

const xml = (body: string, status = 200) => new Response(body, { status });
const noSleep = vi.fn(async () => undefined);

function source(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
  token: string | null = "tkn",
) {
  const fetchImpl = vi.fn(
    async (input: URL | RequestInfo, init?: RequestInit) =>
      handler(input as URL, init),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  return {
    src: createBggSource({
      token: token ?? undefined,
      fetchImpl,
      sleep: noSleep,
    }),
    fetchImpl,
  };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof BggError ? error.code : "other";
  }
};

describe("createBggSource", () => {
  it("is not configured without a token and never calls the network", async () => {
    const { src, fetchImpl } = source(() => xml(SEARCH_XML), null);
    expect(src.isConfigured()).toBe(false);
    expect(await codeOf(src.search("catan"))).toBe("not_configured");
    expect(await codeOf(src.fetchGame("13"))).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("searches boardgames and expansions with the bearer token", async () => {
    const { src, fetchImpl } = source(() => xml(SEARCH_XML));
    const hits = await src.search("  catan ");
    expect(hits.map((h) => h.externalId)).toEqual(["13", "926", "9999"]);

    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe(
      "https://boardgamegeek.com/xmlapi2/search",
    );
    expect(url.searchParams.get("query")).toBe("catan");
    expect(url.searchParams.get("type")).toBe("boardgame,boardgameexpansion");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tkn",
    );
    expect(init.redirect).toBe("error");
  });

  it("does not query BGG for very short searches", async () => {
    const { src, fetchImpl } = source(() => xml(SEARCH_XML));
    expect(await src.search("a")).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("truncates an oversized query instead of sending it all", async () => {
    const { src, fetchImpl } = source(() => xml(EMPTY_XML));
    await src.search("x".repeat(500));
    const [url] = fetchImpl.mock.calls[0] as [URL];
    expect(url.searchParams.get("query")).toHaveLength(100);
  });

  it("fetches a game by id", async () => {
    const { src, fetchImpl } = source(() => xml(THING_XML));
    const game = await src.fetchGame("13");
    expect(game.name).toBe("CATAN");
    const [url] = fetchImpl.mock.calls[0] as [URL];
    expect(url.pathname).toBe("/xmlapi2/thing");
    expect(url.searchParams.get("id")).toBe("13");
  });

  it("refuses a non-numeric id without calling BGG (no path/param injection)", async () => {
    const { src, fetchImpl } = source(() => xml(THING_XML));
    expect(await codeOf(src.fetchGame("13&type=x"))).toBe("not_found");
    expect(await codeOf(src.fetchGame("../admin"))).toBe("not_found");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries while BGG answers 202 (queued) and then succeeds", async () => {
    let calls = 0;
    const { src } = source(() => (++calls < 3 ? xml("", 202) : xml(THING_XML)));
    expect((await src.fetchGame("13")).externalId).toBe("13");
    expect(calls).toBe(3);
    expect(noSleep).toHaveBeenCalled();
  });

  it("gives up with a timeout if BGG keeps the request queued", async () => {
    const { src, fetchImpl } = source(() => xml("", 202));
    expect(await codeOf(src.fetchGame("13"))).toBe("timeout");
    expect(fetchImpl).toHaveBeenCalledTimes(4); // first try + 3 retries
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [500, "upstream"],
    [503, "upstream"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const { src } = source(() => xml("", status));
    expect(await codeOf(src.search("catan"))).toBe(code);
  });

  it("maps a network failure to upstream and a timeout to timeout", async () => {
    const down = source(() => {
      throw new TypeError("fetch failed");
    });
    expect(await codeOf(down.src.search("catan"))).toBe("upstream");

    const slow = source(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(await codeOf(slow.src.search("catan"))).toBe("timeout");
  });

  it("never leaks the token in an error message", async () => {
    const { src } = source(() => xml("", 401), "super-secret-token");
    try {
      await src.search("catan");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(
        "super-secret-token",
      );
    }
  });
});
