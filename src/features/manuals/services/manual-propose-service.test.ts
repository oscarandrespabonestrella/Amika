import { describe, expect, it, vi } from "vitest";
import type { PdfCheck } from "../pdf-verifier";
import { proposeManual, type ProposeDeps } from "./manual-propose-service";

vi.mock("server-only", () => ({}));

const input = {
  gameId: "game-1",
  url: "https://www.devir.com/rules/catan.pdf",
  title: "Catan reglamento",
  locale: "es",
};

function deps(over: Partial<ProposeDeps> & { check?: PdfCheck } = {}) {
  const insertSuggestion = vi.fn(async () => {});
  const insertRulesResource = vi.fn(async () => {});
  const d: ProposeDeps = {
    verifier: {
      verify: async () =>
        over.check ?? { ok: true, finalUrl: input.url, sizeBytes: 999 },
    },
    knownUrls: async () => ({ added: [], proposed: [] }),
    insertSuggestion,
    insertRulesResource,
    isAdmin: false,
    now: () => new Date("2026-11-18T10:00:00Z"),
    ...over,
  };
  return { d, insertSuggestion, insertRulesResource };
}

describe("proposeManual", () => {
  it("a regular user creates a pending proposal with server-derived metadata", async () => {
    const { d, insertSuggestion, insertRulesResource } = deps();
    expect(await proposeManual(d, input)).toEqual({
      ok: true,
      published: false,
    });
    expect(insertRulesResource).not.toHaveBeenCalled();
    expect(insertSuggestion).toHaveBeenCalledWith({
      gameId: "game-1",
      url: "https://www.devir.com/rules/catan.pdf",
      title: "Catan reglamento",
      locale: "es",
      publisher: "Devir",
      sourceHost: "www.devir.com",
      isOfficial: true,
      sizeBytes: 999,
      verifiedAt: "2026-11-18T10:00:00.000Z",
    });
  });

  it("an administrator publishes straight into the Game Center", async () => {
    const { d, insertSuggestion, insertRulesResource } = deps({
      isAdmin: true,
    });
    expect(await proposeManual(d, input)).toEqual({
      ok: true,
      published: true,
    });
    expect(insertSuggestion).not.toHaveBeenCalled();
    expect(insertRulesResource).toHaveBeenCalledOnce();
  });

  it("does not trust a client claim of 'official'", async () => {
    const { d, insertSuggestion } = deps();
    await proposeManual(d, { ...input, url: "https://fan.example/catan.pdf" });
    expect(insertSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ publisher: null, isOfficial: false }),
    );
  });

  it.each([
    [
      "http URL is upgraded, not refused",
      "http://www.devir.com/rules/catan.pdf",
      true,
    ],
    ["private IP", "https://10.0.0.1/a.pdf", false],
    ["not a URL", "nope", false],
    ["re-hosting site", "https://www.scribd.com/doc/1/catan.pdf", false],
  ])("%s", async (_label, url, ok) => {
    const { d } = deps();
    expect((await proposeManual(d, { ...input, url })).ok).toBe(ok);
  });

  it("refuses what the game already has, by normalized URL", async () => {
    const { d, insertSuggestion } = deps({
      knownUrls: async () => ({
        added: ["http://WWW.devir.com/rules/catan.pdf?utm_source=x"],
        proposed: [],
      }),
    });
    expect(await proposeManual(d, input)).toEqual({
      ok: false,
      error: "already_added",
    });
    expect(insertSuggestion).not.toHaveBeenCalled();
  });

  it("refuses what is already proposed", async () => {
    const { d } = deps({
      knownUrls: async () => ({ added: [], proposed: [input.url] }),
    });
    expect(await proposeManual(d, input)).toEqual({
      ok: false,
      error: "already_proposed",
    });
  });

  it.each([
    [{ ok: false, reason: "not_pdf" }, "not_pdf"],
    [{ ok: false, reason: "too_large" }, "not_pdf"],
    [{ ok: false, reason: "unreachable" }, "unreachable"],
    [{ ok: false, reason: "timeout" }, "unreachable"],
    [{ ok: false, reason: "unsafe_url" }, "invalid"],
  ] as const)(
    "maps verification %j to %s and stores nothing",
    async (check, error) => {
      const { d, insertSuggestion, insertRulesResource } = deps({ check });
      expect(await proposeManual(d, input)).toEqual({ ok: false, error });
      expect(insertSuggestion).not.toHaveBeenCalled();
      expect(insertRulesResource).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["23505", "already_proposed"],
    ["P0001", "limit"],
    ["42501", "forbidden"],
  ])("maps database error %s to %s", async (code, error) => {
    const { d } = deps({
      insertSuggestion: async () => {
        throw Object.assign(new Error("db"), { code });
      },
    });
    expect(await proposeManual(d, input)).toEqual({ ok: false, error });
  });

  it("a duplicate race for an administrator is already_added", async () => {
    const { d } = deps({
      isAdmin: true,
      insertRulesResource: async () => {
        throw Object.assign(new Error("db"), { code: "23505" });
      },
    });
    expect(await proposeManual(d, input)).toEqual({
      ok: false,
      error: "already_added",
    });
  });

  it("rethrows an unexpected failure (the action logs it)", async () => {
    const { d } = deps({
      insertSuggestion: async () => {
        throw new Error("boom");
      },
    });
    await expect(proposeManual(d, input)).rejects.toThrow("boom");
  });
});
