import { describe, expect, it, vi } from "vitest";
import {
  fileNameFor,
  handleFileRequest,
  type FileRequestDeps,
} from "./file-request";

const UUID = "11111111-1111-4111-8111-111111111111";
const URL_OK = "https://www.devir.com/rules/Catan Reglamento.pdf";

const body = () =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
      c.close();
    },
  });

function deps(over: Partial<FileRequestDeps> = {}) {
  const recordDownload = vi.fn(async () => {});
  const open = vi.fn(async () => ({
    ok: true as const,
    finalUrl: URL_OK,
    sizeBytes: 5 as number | null,
    stream: body(),
    close: () => {},
  }));
  const d: FileRequestDeps = {
    userId: async () => "user_1",
    urlOfResource: async () => ({ url: URL_OK }),
    urlOfSuggestion: async () => ({ url: URL_OK }),
    verifyToken: () => null,
    isOverLimit: async () => false,
    recordDownload,
    open,
    isId: (v) => v === UUID,
    ...over,
  };
  return { d, recordDownload, open };
}

const none = { resource: null, suggestion: null, token: null };

describe("handleFileRequest", () => {
  it("401 without a session, and touches nothing", async () => {
    const { d, open } = deps({ userId: async () => null });
    expect(await handleFileRequest({ ...none, resource: UUID }, d)).toEqual({
      status: 401,
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("400 unless exactly one selector is given", async () => {
    const { d } = deps();
    expect(await handleFileRequest(none, d)).toEqual({ status: 400 });
    expect(
      await handleFileRequest(
        { resource: UUID, suggestion: UUID, token: null },
        d,
      ),
    ).toEqual({ status: 400 });
    expect(
      await handleFileRequest({ ...none, resource: "not-a-uuid" }, d),
    ).toEqual({ status: 400 });
  });

  it("streams a stored manual as a download with safe headers", async () => {
    const { d, recordDownload } = deps();
    const res = await handleFileRequest({ ...none, resource: UUID }, d);
    if (res.status !== 200) throw new Error("expected 200");
    expect(res.headers).toMatchObject({
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="Catan_Reglamento.pdf"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-length": "5",
    });
    expect(recordDownload).toHaveBeenCalledWith("user_1");
  });

  it("serves a proposal through its id", async () => {
    const { d } = deps();
    expect(
      (await handleFileRequest({ ...none, suggestion: UUID }, d)).status,
    ).toBe(200);
  });

  it("404 when RLS hides the manual (same answer as a missing one)", async () => {
    const { d, open } = deps({ urlOfResource: async () => null });
    expect(await handleFileRequest({ ...none, resource: UUID }, d)).toEqual({
      status: 404,
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("serves a token issued to this user", async () => {
    const { d, open } = deps({
      verifyToken: () => ({
        url: "https://a.example/x.pdf",
        gameId: "g",
        userId: "user_1",
      }),
    });
    expect((await handleFileRequest({ ...none, token: "t" }, d)).status).toBe(
      200,
    );
    expect(open).toHaveBeenCalledWith("https://a.example/x.pdf");
  });

  it("404 for a token issued to somebody else, forged, or with no secret", async () => {
    const other = deps({
      verifyToken: () => ({
        url: "https://a.example/x.pdf",
        gameId: "g",
        userId: "user_2",
      }),
    });
    expect(await handleFileRequest({ ...none, token: "t" }, other.d)).toEqual({
      status: 404,
    });
    expect(other.open).not.toHaveBeenCalled();

    const forged = deps({ verifyToken: () => null });
    expect(await handleFileRequest({ ...none, token: "t" }, forged.d)).toEqual({
      status: 404,
    });

    const noSecret = deps({ verifyToken: undefined });
    expect(
      await handleFileRequest({ ...none, token: "t" }, noSecret.d),
    ).toEqual({ status: 404 });
  });

  it("429 over the hourly limit, before fetching", async () => {
    const { d, open, recordDownload } = deps({ isOverLimit: async () => true });
    expect(await handleFileRequest({ ...none, resource: UUID }, d)).toEqual({
      status: 429,
    });
    expect(open).not.toHaveBeenCalled();
    expect(recordDownload).not.toHaveBeenCalled();
  });

  it.each([
    ["too_large", 413],
    ["unsafe_url", 404],
    ["not_pdf", 502],
    ["unreachable", 502],
    ["timeout", 502],
  ] as const)("maps %s to %i", async (reason, status) => {
    const { d } = deps({ open: async () => ({ ok: false, reason }) });
    expect(await handleFileRequest({ ...none, resource: UUID }, d)).toEqual({
      status,
    });
  });

  it("omits Content-Length when the size is unknown", async () => {
    const { d } = deps({
      open: async () => ({
        ok: true,
        finalUrl: URL_OK,
        sizeBytes: null,
        stream: body(),
        close: () => {},
      }),
    });
    const res = await handleFileRequest({ ...none, resource: UUID }, d);
    if (res.status !== 200) throw new Error("expected 200");
    expect(res.headers["content-length"]).toBeUndefined();
  });
});

describe("fileNameFor", () => {
  it.each([
    ["https://a.example/rules/Catán Reglamento.pdf", "Catan_Reglamento.pdf"],
    ["https://a.example/a/b/%E2%9C%93.pdf", "manual.pdf"],
    ['https://a.example/x";evil.pdf', "x_evil.pdf"],
    ["https://a.example/", "manual.pdf"],
    ["garbage", "manual.pdf"],
  ])("%s -> %s", (url, name) => {
    expect(fileNameFor(url)).toBe(name);
  });
});
