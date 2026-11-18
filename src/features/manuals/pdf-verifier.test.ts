import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createPdfVerifier, openPdf } = await import("./pdf-verifier");

const PUBLIC = async () => ["93.184.216.34"];
const PDF = new TextEncoder().encode("%PDF-1.7\n" + "x".repeat(200));

function pdfResponse(extra: Record<string, string> = {}, status = 200) {
  return new Response(PDF, {
    status,
    headers: { "content-type": "application/pdf", ...extra },
  });
}

function verifier(handler: (url: string, init?: RequestInit) => Response) {
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch;
  return { fetchImpl, v: createPdfVerifier({ fetchImpl, resolve: PUBLIC }) };
}

describe("PdfVerifier.verify", () => {
  const url = "https://rules.example.com/catan.pdf";

  it("accepts a real PDF and asks only for the first bytes", async () => {
    const { v, fetchImpl } = verifier(() => pdfResponse());
    // a synthetic Response has no Content-Length, so the size is unknown
    expect(await v.verify(url)).toEqual({
      ok: true,
      finalUrl: url,
      sizeBytes: null,
    });
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).range).toBe("bytes=0-1023");
    expect(init.redirect).toBe("manual");
  });

  it("reads the size from Content-Length on a plain 200", async () => {
    const { v } = verifier(() =>
      pdfResponse({ "content-length": String(PDF.byteLength) }),
    );
    expect(await v.verify(url)).toMatchObject({
      ok: true,
      sizeBytes: PDF.byteLength,
    });
  });

  it("takes the total size from Content-Range on a 206", async () => {
    const { v } = verifier(() =>
      pdfResponse({ "content-range": "bytes 0-1023/5242880" }, 206),
    );
    expect(await v.verify(url)).toMatchObject({ ok: true, sizeBytes: 5242880 });
  });

  it("rejects HTML that claims to be a PDF", async () => {
    const { v } = verifier(
      () =>
        new Response("<html>Not found</html>", {
          headers: { "content-type": "application/pdf" },
        }),
    );
    expect(await v.verify(url)).toEqual({ ok: false, reason: "not_pdf" });
  });

  it("rejects a PDF body served with a non-PDF content type", async () => {
    const { v } = verifier(
      () => new Response(PDF, { headers: { "content-type": "text/html" } }),
    );
    expect(await v.verify(url)).toEqual({ ok: false, reason: "not_pdf" });
  });

  it("accepts octet-stream when the signature is right", async () => {
    const { v } = verifier(
      () =>
        new Response(PDF, {
          headers: { "content-type": "application/octet-stream" },
        }),
    );
    expect(await v.verify(url)).toMatchObject({ ok: true });
  });

  it("rejects HTTP errors as unreachable", async () => {
    const { v } = verifier(() => new Response("no", { status: 404 }));
    expect(await v.verify(url)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("rejects a file declared bigger than the limit", async () => {
    const { v } = verifier(() =>
      pdfResponse({ "content-length": String(300 * 1024 * 1024) }),
    );
    expect(await v.verify(url)).toEqual({ ok: false, reason: "too_large" });
  });

  it("follows a redirect to another public host", async () => {
    const { v } = verifier((u) =>
      u.startsWith("https://short.example/")
        ? new Response(null, {
            status: 302,
            headers: { location: "https://cdn.example.com/a.pdf" },
          })
        : pdfResponse(),
    );
    expect(await v.verify("https://short.example/x")).toMatchObject({
      ok: true,
      finalUrl: "https://cdn.example.com/a.pdf",
    });
  });

  it("refuses a redirect to a private address and never fetches it", async () => {
    const seen: string[] = [];
    const { v } = verifier((u) => {
      seen.push(u);
      return new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data" },
      });
    });
    expect(await v.verify("https://short.example/x")).toEqual({
      ok: false,
      reason: "unsafe_url",
    });
    expect(seen).toEqual(["https://short.example/x"]);
  });

  it("refuses a host that resolves to a private address, without fetching", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const v = createPdfVerifier({
      fetchImpl,
      resolve: async () => ["10.0.0.9"],
    });
    expect(await v.verify(url)).toEqual({ ok: false, reason: "unsafe_url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gives up on a redirect loop", async () => {
    const { v } = verifier(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://loop.example.com/again" },
        }),
    );
    expect(await v.verify("https://loop.example.com/again")).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("times out", async () => {
    const fetchImpl = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const result = await openPdf("https://slow.example.com/a.pdf", {
      fetchImpl,
      resolve: PUBLIC,
      timeoutMs: 20,
    });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("openPdf streaming", () => {
  const url = "https://rules.example.com/catan.pdf";

  async function drain(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.byteLength;
    }
  }

  it("streams the whole body, signature included", async () => {
    const fetchImpl = (async () => pdfResponse()) as unknown as typeof fetch;
    const opened = await openPdf(url, { fetchImpl, resolve: PUBLIC });
    if (!opened.ok) throw new Error("expected ok");
    expect(await drain(opened.stream)).toBe(PDF.byteLength);
  });

  it("errors the stream when the body outgrows the limit", async () => {
    const fetchImpl = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode("%PDF-1.7\n"));
            c.enqueue(new Uint8Array(500));
            c.close();
          },
        }),
        { headers: { "content-type": "application/pdf" } },
      )) as unknown as typeof fetch;
    const opened = await openPdf(url, {
      fetchImpl,
      resolve: PUBLIC,
      maxBytes: 100,
    });
    if (!opened.ok) throw new Error("expected ok");
    await expect(drain(opened.stream)).rejects.toThrow("too_large");
  });
});
