import "server-only";
import { isSafePublicUrl, type Resolver } from "./url-safety";

// Opening an untrusted URL and proving it is a PDF. Used twice: to VERIFY a search hit (read
// the first bytes, then hang up) and by the download proxy (stream the whole file). Both go
// through `openPdf`, so the rules cannot drift apart: public host on every redirect hop,
// bounded redirects, time and size, and a real `%PDF-` signature (a content-type is only a claim).

const MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const PDF_TYPES = [
  "application/pdf",
  "application/x-pdf",
  "application/octet-stream",
  "binary/octet-stream",
];
const SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export const VERIFY_TIMEOUT_MS = 8_000;
export const VERIFY_MAX_BYTES = 200 * 1024 * 1024;

export type PdfFailure =
  | "unsafe_url"
  | "unreachable" // network error, HTTP error, too many redirects
  | "not_pdf"
  | "too_large"
  | "timeout";

export type PdfCheck =
  | { ok: true; finalUrl: string; sizeBytes: number | null }
  | { ok: false; reason: PdfFailure };

export type OpenedPdf = {
  ok: true;
  finalUrl: string;
  /** Total size when the server says, else null. */
  sizeBytes: number | null;
  /** The body from byte 0 (or from the range start), capped at `maxBytes`. */
  stream: ReadableStream<Uint8Array>;
  /** Hang up: cancels the request and clears the timer. */
  close(): void;
};

export type OpenOptions = {
  fetchImpl?: typeof fetch;
  resolve?: Resolver;
  /** Ask only for the first bytes (servers that ignore it just send everything). */
  headOnly?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
};

function totalSize(res: Response): number | null {
  const range = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
  if (range) return Number(range[1]);
  if (res.status !== 206) {
    const length = Number(res.headers.get("content-length"));
    if (Number.isFinite(length) && length > 0) return length;
  }
  return null;
}

function hasSignature(bytes: Uint8Array): boolean {
  return SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Open `url` as a PDF, or say why not. Never throws. */
export async function openPdf(
  url: string,
  opts: OpenOptions = {},
): Promise<OpenedPdf | { ok: false; reason: PdfFailure }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? VERIFY_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? VERIFY_TIMEOUT_MS,
  );
  const close = () => {
    clearTimeout(timer);
    controller.abort();
  };
  const fail = (reason: PdfFailure) => {
    close();
    return { ok: false as const, reason };
  };

  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isSafePublicUrl(current, opts.resolve)))
        return fail("unsafe_url");

      const res = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          accept: "application/pdf,*/*;q=0.5",
          ...(opts.headOnly ? { range: "bytes=0-1023" } : {}),
        },
      });

      if (REDIRECTS.has(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        const location = res.headers.get("location");
        if (!location) return fail("unreachable");
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        return fail("unreachable");
      }

      const type = (res.headers.get("content-type") ?? "")
        .toLowerCase()
        .split(";")[0]
        .trim();
      if (!PDF_TYPES.includes(type)) {
        await res.body.cancel().catch(() => undefined);
        return fail("not_pdf");
      }
      const size = totalSize(res);
      if (size !== null && size > maxBytes) {
        await res.body.cancel().catch(() => undefined);
        return fail("too_large");
      }

      // Read until the signature can be judged, keep those bytes for the caller.
      const reader = res.body.getReader();
      const prelude: Uint8Array[] = [];
      let preludeBytes = 0;
      while (preludeBytes < SIGNATURE.length) {
        const { done, value } = await reader.read();
        if (done) break;
        prelude.push(value);
        preludeBytes += value.byteLength;
      }
      const head = new Uint8Array(preludeBytes);
      let offset = 0;
      for (const chunk of prelude) {
        head.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (!hasSignature(head)) {
        await reader.cancel().catch(() => undefined);
        return fail("not_pdf");
      }

      let total = preludeBytes;
      let preludeSent = false;
      const stream = new ReadableStream<Uint8Array>({
        async pull(streamController) {
          try {
            if (!preludeSent) {
              preludeSent = true;
              for (const chunk of prelude) streamController.enqueue(chunk);
              return;
            }
            const { done, value } = await reader.read();
            if (done) {
              clearTimeout(timer);
              streamController.close();
              return;
            }
            total += value.byteLength;
            if (total > maxBytes) {
              await reader.cancel().catch(() => undefined);
              close();
              streamController.error(new Error("too_large"));
              return;
            }
            streamController.enqueue(value);
          } catch (error) {
            close();
            streamController.error(error);
          }
        },
        async cancel(reason) {
          await reader.cancel(reason).catch(() => undefined);
          close();
        },
      });
      return { ok: true, finalUrl: current, sizeBytes: size, stream, close };
    }
    return fail("unreachable"); // too many redirects
  } catch (error) {
    const aborted = controller.signal.aborted;
    close();
    void error;
    return { ok: false, reason: aborted ? "timeout" : "unreachable" };
  }
}

export type PdfVerifier = {
  verify(url: string): Promise<PdfCheck>;
};

/** Proves a link points at a real, reachable PDF without downloading it. */
export function createPdfVerifier(
  deps: Pick<OpenOptions, "fetchImpl" | "resolve"> = {},
): PdfVerifier {
  return {
    async verify(url) {
      const opened = await openPdf(url, { ...deps, headOnly: true });
      if (!opened.ok) return opened;
      opened.close();
      return {
        ok: true,
        finalUrl: opened.finalUrl,
        sizeBytes: opened.sizeBytes,
      };
    },
  };
}
