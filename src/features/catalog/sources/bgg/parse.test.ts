import { describe, expect, it } from "vitest";
import { BggError } from "./errors";
import {
  EMPTY_XML,
  ERROR_XML,
  EXPANSION_XML,
  MESSY_XML,
  SEARCH_XML,
  THING_XML,
} from "./fixtures";
import {
  decodeHtmlEntities,
  parseSearchResponse,
  parseThingResponse,
} from "./parse";

describe("parseSearchResponse", () => {
  it("maps items to normalized hits", () => {
    const hits = parseSearchResponse(SEARCH_XML);
    expect(hits).toEqual([
      {
        source: "bgg",
        externalId: "13",
        name: "CATAN",
        kind: "base",
        yearPublished: 1995,
      },
      {
        source: "bgg",
        externalId: "926",
        name: "CATAN: Seafarers",
        kind: "expansion",
        yearPublished: 1997,
      },
      {
        source: "bgg",
        externalId: "9999",
        name: "Untitled & Co",
        kind: "base",
        yearPublished: null,
      },
    ]);
  });

  it("prefers the primary name over alternates", () => {
    expect(parseSearchResponse(SEARCH_XML)[2].name).toBe("Untitled & Co");
  });

  it("returns an empty list when nothing matches", () => {
    expect(parseSearchResponse(EMPTY_XML)).toEqual([]);
  });

  it("treats an error document as an upstream failure", () => {
    expect(() => parseSearchResponse(ERROR_XML)).toThrowError(BggError);
  });

  it("skips items with a non-numeric id", () => {
    const xml = `<items><item type="boardgame" id="../etc"><name type="primary" value="Bad"/></item></items>`;
    expect(parseSearchResponse(xml)).toEqual([]);
  });
});

describe("parseThingResponse", () => {
  const game = parseThingResponse(THING_XML);

  it("reads the basic fields", () => {
    expect(game).toMatchObject({
      source: "bgg",
      externalId: "13",
      language: "en",
      kind: "base",
      name: "CATAN",
      yearPublished: 1995,
      minPlayers: 3,
      maxPlayers: 4,
      minPlaytime: 60,
      maxPlaytime: 120,
      minAge: 10,
    });
  });

  it("uses the full image, falling back to the thumbnail", () => {
    expect(game.coverUrl).toBe("https://cf.geekdo-images.com/full.jpg");
  });

  it("decodes BGG's double-encoded description", () => {
    expect(game.description).toBe(
      'Picture yourself in the era of discoveries:\n\nTrade & build. "Quoted" — café.',
    );
  });

  it("extracts terms by type and ignores unrelated links", () => {
    expect(game.terms).toEqual([
      { type: "category", externalId: "1021", name: "Economic" },
      { type: "category", externalId: "1026", name: "Negotiation" },
      { type: "mechanic", externalId: "2072", name: "Dice Rolling" },
      { type: "designer", externalId: "11", name: "Klaus Teuber" },
      { type: "publisher", externalId: "37", name: "KOSMOS" },
    ]);
  });

  it("distinguishes expansions of this game from games it expands", () => {
    expect(game.relations).toEqual([
      { type: "has_expansion", externalId: "926", name: "CATAN: Seafarers" },
      { type: "expansion_of", externalId: "27", name: "Some Base" },
    ]);
  });

  it("recognizes expansions and treats 0 as unknown", () => {
    const expansion = parseThingResponse(EXPANSION_XML);
    expect(expansion.kind).toBe("expansion");
    expect(expansion.minPlaytime).toBeNull();
    expect(expansion.maxPlaytime).toBeNull();
    expect(expansion.minAge).toBeNull();
    expect(expansion.relations).toEqual([
      { type: "expansion_of", externalId: "13", name: "CATAN" },
    ]);
  });

  it("sanitizes inconsistent source data so the database never rejects it", () => {
    const messy = parseThingResponse(MESSY_XML);
    expect(messy.yearPublished).toBeNull();
    expect([messy.minPlayers, messy.maxPlayers]).toEqual([5, 5]);
    expect([messy.minPlaytime, messy.maxPlaytime]).toEqual([90, 90]);
    expect(messy.minAge).toBeNull();
    expect(messy.coverUrl).toBeNull(); // http:// is rejected
  });

  it("throws not_found for an empty result and for error documents", () => {
    expect(() => parseThingResponse(EMPTY_XML)).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
    expect(() => parseThingResponse(ERROR_XML)).toThrowError(BggError);
  });

  it("caps very long term lists", () => {
    const links = Array.from(
      { length: 200 },
      (_, i) => `<link type="boardgamepublisher" id="${i + 1}" value="P${i}"/>`,
    ).join("");
    const xml = `<items><item type="boardgame" id="1"><name type="primary" value="X"/>${links}</item></items>`;
    expect(parseThingResponse(xml).terms).toHaveLength(20);
  });

  it("keeps a numeric-looking description as text", () => {
    const xml = `<items><item type="boardgame" id="1"><name type="primary" value="X"/><description>2025</description></item></items>`;
    expect(parseThingResponse(xml).description).toBe("2025");
  });
});

describe("hostile input", () => {
  it("rejects malformed XML", () => {
    expect(() => parseThingResponse("<items><item")).toThrowError(BggError);
  });

  it("rejects oversized responses", () => {
    expect(() =>
      parseSearchResponse("<items>" + "a".repeat(2_000_001) + "</items>"),
    ).toThrowError(expect.objectContaining({ code: "invalid_response" }));
  });

  it("does not resolve external entities (XXE)", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>
      <items><item type="boardgame" id="1"><name type="primary" value="X"/><description>&x;</description></item></items>`;
    let description: string | null = null;
    try {
      description = parseThingResponse(xml).description;
    } catch (error) {
      expect(error).toBeInstanceOf(BggError);
    }
    expect(description ?? "").not.toContain("root:");
  });

  it("is not blown up by entity expansion bombs", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE d [
      <!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
      <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">]>
      <items><item type="boardgame" id="1"><name type="primary" value="X"/><description>&d;</description></item></items>`;
    const started = Date.now();
    let length = 0;
    try {
      length = parseThingResponse(xml).description?.length ?? 0;
    } catch (error) {
      expect(error).toBeInstanceOf(BggError);
    }
    expect(Date.now() - started).toBeLessThan(2000);
    expect(length).toBeLessThanOrEqual(20_000);
  });
});

describe("decodeHtmlEntities", () => {
  it.each([
    ["&#10;", "\n"],
    ["&#x41;", "A"],
    ["&amp;", "&"],
    ["&eacute;", "é"],
    ["&unknown;", "&unknown;"],
    ["&#99999999;", "&#99999999;"],
    ["&#0;", "&#0;"],
  ])("%s -> %j", (input, expected) => {
    expect(decodeHtmlEntities(input)).toBe(expected);
  });
});
