import { describe, expect, it } from "vitest";
import {
  detectLocale,
  normalizeText,
  rankCandidates,
  stripHtml,
  type Candidate,
} from "./rank";
import type { GameIdentity } from "./types";

const catan: GameIdentity = {
  id: "g1",
  name: "Catan",
  altNames: ["Die Siedler von Catan", "Los colonos de Catán"],
  year: 1995,
  publishers: ["Devir", "Kosmos"],
  relatedNames: ["Catan: Seafarers", "Catan: Cities & Knights"],
  isExpansion: false,
};

function cand(
  over: Partial<Candidate> & { url: string; title: string },
): Candidate {
  return { description: "", language: null, queryLocale: "es", ...over };
}

const ranked = (cands: Candidate[], game = catan) =>
  rankCandidates(cands, game);

describe("text helpers", () => {
  it("normalizes accents and punctuation", () => {
    expect(normalizeText("Los Colonos de Catán — Édition, 5.0!")).toBe(
      "los colonos de catan edition 5 0",
    );
  });

  it("strips tags and entities from search snippets", () => {
    expect(stripHtml("<strong>Catan</strong> &amp; co &quot;x&quot;")).toBe(
      'Catan & co "x"',
    );
  });
});

describe("rankCandidates: is it this game?", () => {
  it("drops hits that are not about the game", () => {
    const out = ranked([
      cand({
        url: "https://devir.com/rules/azul.pdf",
        title: "Azul reglamento",
      }),
    ]);
    expect(out).toEqual([]);
  });

  it("matches on a translated or original name", () => {
    const out = ranked([
      cand({
        url: "https://kosmos.de/files/siedler.pdf",
        title: "Die Siedler von Catan Spielregel",
      }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("matches the name in the URL when the title is generic", () => {
    const out = ranked([
      cand({
        url: "https://example.com/files/catan-rules.pdf",
        title: "Download",
      }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("matches a glued name against a spaced title", () => {
    const wonders: GameIdentity = {
      ...catan,
      name: "7 Wonders",
      altNames: [],
      relatedNames: [],
    };
    const out = ranked(
      [
        cand({
          url: "https://repos.example/7wonders-rules.pdf",
          title: "Rules",
        }),
      ],
      wonders,
    );
    expect(out).toHaveLength(1);
  });

  it("ranks an expansion rulebook below the base game's", () => {
    const [first, second] = ranked([
      cand({
        url: "https://example.com/catan-seafarers-rules.pdf",
        title: "Catan: Seafarers rules",
      }),
      cand({
        url: "https://example.com/catan-rules.pdf",
        title: "Catan rules",
      }),
    ]);
    expect(first.url).toBe("https://example.com/catan-rules.pdf");
    expect(second.score).toBeLessThan(first.score);
  });

  it("penalizes a generic expansion word for a base game", () => {
    const [first] = ranked([
      cand({
        url: "https://example.com/a-expansion.pdf",
        title: "Catan expansion rules",
      }),
      cand({ url: "https://example.com/b.pdf", title: "Catan rules" }),
    ]);
    expect(first.url).toBe("https://example.com/b.pdf");
  });

  it("prefers a document whose year is close to the publication year", () => {
    const [first] = ranked([
      cand({
        url: "https://example.com/catan-2012-rules.pdf",
        title: "Catan rules 2012",
      }),
      cand({
        url: "https://example.com/catan-1995-rules.pdf",
        title: "Catan rules 1995",
      }),
    ]);
    expect(first.url).toContain("1995");
  });

  it("prefers a rulebook over a player aid", () => {
    const [first] = ranked([
      cand({
        url: "https://example.com/catan-cheat-sheet.pdf",
        title: "Catan cheat sheet",
      }),
      cand({
        url: "https://example.com/catan-rulebook.pdf",
        title: "Catan rulebook",
      }),
    ]);
    expect(first.url).toContain("rulebook");
  });

  it("never offers re-hosted copies", () => {
    expect(
      ranked([
        cand({
          url: "https://www.scribd.com/document/1/catan-rules.pdf",
          title: "Catan rules",
        }),
      ]),
    ).toEqual([]);
  });
});

describe("rankCandidates: who and in which language", () => {
  it("puts the publisher's own site first and labels it", () => {
    const [first, second] = ranked([
      cand({
        url: "https://fan-site.example/catan-reglamento.pdf",
        title: "Catan reglamento",
      }),
      cand({
        url: "https://www.devir.com/descargas/catan-reglamento.pdf",
        title: "Catan reglamento",
      }),
    ]);
    expect(first).toMatchObject({
      host: "www.devir.com",
      publisher: "Devir",
      isOfficial: true,
    });
    expect(second.isOfficial).toBe(false);
    expect(second.publisher).toBeNull();
  });

  it("orders languages es, en, fr, de for equal documents", () => {
    const mk = (code: string, queryLocale: Candidate["queryLocale"]) =>
      cand({
        url: `https://example.com/${code}/catan-rules.pdf`,
        title: "Catan rules",
        queryLocale,
      });
    const out = ranked([
      mk("de", "de"),
      mk("fr", "fr"),
      mk("en", "en"),
      mk("es", "es"),
    ]);
    expect(out.map((r) => r.locale)).toEqual(["es", "en", "fr", "de"]);
  });

  it("a Spanish document on a fan site can beat an official English one, not a Spanish official one", () => {
    const out = ranked([
      cand({
        url: "https://devir.com/catan-rulebook.pdf",
        title: "Catan rulebook",
        queryLocale: "en",
        language: "en",
      }),
      cand({
        url: "https://devir.com/catan-reglamento.pdf",
        title: "Catan reglamento",
        queryLocale: "es",
        language: "es",
      }),
    ]);
    expect(out[0].url).toContain("reglamento");
  });

  it("collapses the same document found by several queries", () => {
    const out = ranked([
      cand({
        url: "http://Example.com/catan-rules.pdf?utm_source=x",
        title: "Catan rules",
        queryLocale: "en",
      }),
      cand({
        url: "https://example.com/catan-rules.pdf",
        title: "Catan rules",
        queryLocale: "es",
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://example.com/catan-rules.pdf");
  });
});

describe("detectLocale", () => {
  const loc = (url: string, over: Partial<Candidate> = {}) =>
    detectLocale(cand({ url, title: "x", ...over }));

  it("reads a language folder or suffix in the URL", () => {
    expect(loc("https://a.example/fr/rules.pdf", { queryLocale: "en" })).toBe(
      "fr",
    );
    expect(loc("https://a.example/catan_de.pdf", { queryLocale: "en" })).toBe(
      "de",
    );
  });

  it("does not mistake the Spanish word 'de' in a file name for German", () => {
    expect(
      loc("https://a.example/reglas-de-catan.pdf", { queryLocale: "en" }),
    ).toBe("es");
  });

  it("falls back to the engine's language, then to the query's", () => {
    expect(
      loc("https://a.example/x.pdf", { language: "fr", queryLocale: "en" }),
    ).toBe("fr");
    expect(loc("https://a.example/x.pdf", { queryLocale: "de" })).toBe("de");
  });
});
