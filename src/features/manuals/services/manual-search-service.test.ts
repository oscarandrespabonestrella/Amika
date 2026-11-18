import { describe, expect, it, vi } from "vitest";
import type { PdfCheck, PdfVerifier } from "../pdf-verifier";
import {
  WebSearchError,
  type WebSearchSource,
} from "../sources/web-search-source";
import type { GameIdentity, WebResult } from "../types";
import { createManualSearchService } from "./manual-search-service";

const game: GameIdentity = {
  id: "game-1",
  name: "Catan",
  altNames: [],
  year: 1995,
  publishers: ["Devir"],
  relatedNames: [],
  isExpansion: false,
};

const hit = (
  url: string,
  title = "Catan reglamento",
  language: string | null = null,
): WebResult => ({
  url,
  title,
  description: "",
  language,
});

function source(
  search: WebSearchSource["search"],
  configured = true,
): WebSearchSource {
  return { id: "fake", isConfigured: () => configured, search };
}

const okVerifier: PdfVerifier = {
  verify: async (url) => ({ ok: true, finalUrl: url, sizeBytes: 1234 }),
};

const noKnown = { knownUrls: async () => ({ added: [], proposed: [] }) };

describe("ManualSearchService.search", () => {
  it("returns verified results, official Spanish first, with labels", async () => {
    const search = vi.fn(async (_q: string, o: { lang: string }) => [
      hit("https://fan.example/catan-rulebook.pdf", "Catan rulebook", "en"),
      hit(
        "https://www.devir.com/descargas/catan-reglamento.pdf",
        "Catan reglamento",
        o.lang === "es" ? "es" : null,
      ),
    ]);
    const service = createManualSearchService({
      source: source(search),
      verifier: okVerifier,
      store: noKnown,
      signLink: ({ url }) => `tok:${url}`,
    });
    const out = await service.search(game);
    if (!out.ok) throw new Error("expected ok");
    expect(out.results[0]).toMatchObject({
      url: "https://www.devir.com/descargas/catan-reglamento.pdf",
      publisher: "Devir",
      sourceHost: "www.devir.com",
      isOfficial: true,
      locale: "es",
      sizeBytes: 1234,
      alreadyAdded: false,
      alreadyProposed: false,
      downloadToken: "tok:https://www.devir.com/descargas/catan-reglamento.pdf",
    });
    expect(out.results).toHaveLength(2); // same hits from every query collapse
  });

  it("queries es, en, fr, de and the publisher's site", async () => {
    const search = vi.fn(async () => []);
    await createManualSearchService({
      source: source(search),
      verifier: okVerifier,
      store: noKnown,
    }).search(game);
    expect(search.mock.calls.map((c) => (c as unknown[])[1])).toHaveLength(5);
  });

  it("drops links that are not a working PDF", async () => {
    const verifier: PdfVerifier = {
      verify: async (url): Promise<PdfCheck> =>
        url.includes("dead")
          ? { ok: false, reason: "unreachable" }
          : { ok: true, finalUrl: url, sizeBytes: null },
    };
    const service = createManualSearchService({
      source: source(async () => [
        hit("https://a.example/dead/catan-reglamento.pdf"),
        hit("https://b.example/catan-reglamento.pdf"),
      ]),
      verifier,
      store: noKnown,
    });
    const out = await service.search(game);
    if (!out.ok) throw new Error("expected ok");
    expect(out.results.map((r) => r.url)).toEqual([
      "https://b.example/catan-reglamento.pdf",
    ]);
  });

  it("reports not_found when every candidate fails verification", async () => {
    const service = createManualSearchService({
      source: source(async () => [
        hit("https://a.example/catan-reglamento.pdf"),
      ]),
      verifier: { verify: async () => ({ ok: false, reason: "not_pdf" }) },
      store: noKnown,
    });
    expect(await service.search(game)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("reports not_found when nothing is about this game", async () => {
    const service = createManualSearchService({
      source: source(async () => [
        hit("https://a.example/azul.pdf", "Azul reglamento"),
      ]),
      verifier: okVerifier,
      store: noKnown,
    });
    expect(await service.search(game)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("marks manuals the game already has or has proposed", async () => {
    const service = createManualSearchService({
      source: source(async () => [
        hit("https://a.example/catan-reglamento.pdf"),
        hit("https://b.example/catan-reglamento.pdf"),
        hit("https://c.example/catan-reglamento.pdf"),
      ]),
      verifier: okVerifier,
      store: {
        knownUrls: async () => ({
          added: ["http://A.example/catan-reglamento.pdf?utm_source=x"],
          proposed: ["https://b.example/catan-reglamento.pdf"],
        }),
      },
    });
    const out = await service.search(game);
    if (!out.ok) throw new Error("expected ok");
    const by = Object.fromEntries(out.results.map((r) => [r.sourceHost, r]));
    expect(by["a.example"].alreadyAdded).toBe(true);
    expect(by["b.example"].alreadyProposed).toBe(true);
    expect(by["c.example"]).toMatchObject({
      alreadyAdded: false,
      alreadyProposed: false,
    });
  });

  it("limits how many candidates are verified and returned", async () => {
    const verify = vi.fn(okVerifier.verify);
    const service = createManualSearchService({
      source: source(async () =>
        Array.from({ length: 10 }, (_, i) =>
          hit(`https://h${i}.example/catan-reglamento.pdf`),
        ),
      ),
      verifier: { verify },
      store: noKnown,
      verifyTop: 4,
      maxResults: 3,
    });
    const out = await service.search(game);
    if (!out.ok) throw new Error("expected ok");
    expect(verify).toHaveBeenCalledTimes(4);
    expect(out.results).toHaveLength(3);
  });

  it("is unavailable without a key and never searches", async () => {
    const search = vi.fn(async () => []);
    const service = createManualSearchService({
      source: source(search, false),
      verifier: okVerifier,
      store: noKnown,
    });
    expect(await service.search(game)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthorized", "unavailable"],
    ["rate_limited", "rate_limited"],
    ["upstream", "failed"],
    ["timeout", "failed"],
  ] as const)(
    "maps a %s failure from every query to %s",
    async (code, error) => {
      const service = createManualSearchService({
        source: source(async () => {
          throw new WebSearchError(code);
        }),
        verifier: okVerifier,
        store: noKnown,
      });
      expect(await service.search(game)).toEqual({ ok: false, error });
    },
  );

  it("still answers when only some queries fail", async () => {
    let n = 0;
    const service = createManualSearchService({
      source: source(async () => {
        if (n++ % 2 === 0) throw new WebSearchError("timeout");
        return [hit("https://a.example/catan-reglamento.pdf")];
      }),
      verifier: okVerifier,
      store: noKnown,
    });
    expect((await service.search(game)).ok).toBe(true);
  });

  it("never throws when the store fails", async () => {
    const service = createManualSearchService({
      source: source(async () => [
        hit("https://a.example/catan-reglamento.pdf"),
      ]),
      verifier: okVerifier,
      store: {
        knownUrls: async () => {
          throw new Error("db down");
        },
      },
    });
    expect(await service.search(game)).toEqual({ ok: false, error: "failed" });
  });
});
