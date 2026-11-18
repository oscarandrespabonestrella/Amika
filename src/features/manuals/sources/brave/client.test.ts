import { describe, expect, it, vi } from "vitest";
import { WebSearchError } from "../web-search-source";
import { createBraveSource } from "./client";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function source(handler: (url: URL, init?: RequestInit) => Response) {
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) =>
    handler(input as URL, init),
  ) as unknown as typeof fetch;
  return { fetchImpl, src: createBraveSource({ apiKey: "k", fetchImpl }) };
}

describe("createBraveSource", () => {
  it("sends the key in the subscription header and the language filter", async () => {
    const { src, fetchImpl } = source(() => json({ web: { results: [] } }));
    await src.search("catan reglamento filetype:pdf", {
      lang: "es",
      country: "ES",
      count: 50,
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe(
      "https://api.search.brave.com/res/v1/web/search",
    );
    expect(url.searchParams.get("search_lang")).toBe("es");
    expect(url.searchParams.get("country")).toBe("ES");
    expect(url.searchParams.get("count")).toBe("20"); // capped
    expect(
      (init.headers as Record<string, string>)["X-Subscription-Token"],
    ).toBe("k");
    expect(init.redirect).toBe("error");
  });

  it("maps hits and skips malformed ones", async () => {
    const { src } = source(() =>
      json({
        web: {
          results: [
            { title: "Catan", url: "https://a.example/c.pdf", language: "es" },
            { nope: true },
            { title: "B", url: "https://b.example/", description: "d" },
          ],
        },
      }),
    );
    const out = await src.search("q", { lang: "es" });
    expect(out).toEqual([
      {
        title: "Catan",
        url: "https://a.example/c.pdf",
        description: "",
        language: "es",
      },
      {
        title: "B",
        url: "https://b.example/",
        description: "d",
        language: null,
      },
    ]);
  });

  it("returns [] when the response has no web section", async () => {
    const { src } = source(() => json({ query: {} }));
    expect(await src.search("q", { lang: "en" })).toEqual([]);
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [500, "upstream"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const { src } = source(() => json({}, status));
    await expect(src.search("q", { lang: "en" })).rejects.toMatchObject({
      code,
    });
  });

  it("rejects an invalid body", async () => {
    const { src } = source(() => new Response("<html>", { status: 200 }));
    await expect(src.search("q", { lang: "en" })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("reports a network failure as upstream", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const src = createBraveSource({ apiKey: "k", fetchImpl });
    await expect(src.search("q", { lang: "en" })).rejects.toMatchObject({
      code: "upstream",
    });
  });

  it("is not configured without a key and never calls the network", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const src = createBraveSource({ apiKey: undefined, fetchImpl });
    expect(src.isConfigured()).toBe(false);
    await expect(src.search("q", { lang: "en" })).rejects.toBeInstanceOf(
      WebSearchError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
