import type { ManualLink } from "./link-token";
import type { OpenedPdf, PdfFailure } from "./pdf-verifier";

// The download proxy: the browser cannot read most publishers' PDFs itself (no CORS), so
// the server fetches the file in transit and streams it back. Nothing is stored. It is NOT an
// open proxy: it serves only (a) a manual that is in the database and that RLS lets this user
// see, or (b) a URL carrying a token we signed for this very user. Every fetch goes through
// `openPdf` (public hosts only, PDF signature, size and time limits).

export const FILE_MAX_BYTES = 100 * 1024 * 1024;
export const FILE_TIMEOUT_MS = 50_000;

export type FileRequestParams = {
  resource: string | null;
  suggestion: string | null;
  token: string | null;
};

export type FileRequestDeps = {
  userId: () => Promise<string | null>;
  urlOfResource: (id: string) => Promise<{ url: string } | null>;
  urlOfSuggestion: (id: string) => Promise<{ url: string } | null>;
  /** `undefined` when no signing secret is configured. */
  verifyToken: ((token: string) => ManualLink | null) | undefined;
  isOverLimit: (userId: string) => Promise<boolean>;
  recordDownload: (userId: string) => Promise<void>;
  open: (url: string) => Promise<OpenedPdf | { ok: false; reason: PdfFailure }>;
  isId: (value: string) => boolean;
};

export type FileResult =
  | {
      status: 200;
      stream: ReadableStream<Uint8Array>;
      headers: Record<string, string>;
    }
  | { status: 400 | 401 | 404 | 413 | 429 | 502 };

/** A header-safe ASCII file name taken from the URL, never from user-typed text. */
export function fileNameFor(url: string): string {
  try {
    const last = decodeURIComponent(
      new URL(url).pathname.split("/").pop() ?? "",
    );
    const base = last
      .replace(/\.pdf$/i, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^[_.-]+|[_.-]+$/g, "")
      .slice(0, 80);
    return `${base || "manual"}.pdf`;
  } catch {
    return "manual.pdf";
  }
}

export async function handleFileRequest(
  params: FileRequestParams,
  deps: FileRequestDeps,
): Promise<FileResult> {
  const userId = await deps.userId();
  if (!userId) return { status: 401 };

  const given = [params.resource, params.suggestion, params.token].filter(
    (v): v is string => Boolean(v),
  );
  if (given.length !== 1) return { status: 400 };

  let url: string | null = null;
  if (params.resource) {
    if (!deps.isId(params.resource)) return { status: 400 };
    url = (await deps.urlOfResource(params.resource))?.url ?? null;
  } else if (params.suggestion) {
    if (!deps.isId(params.suggestion)) return { status: 400 };
    url = (await deps.urlOfSuggestion(params.suggestion))?.url ?? null;
  } else if (params.token) {
    const link = deps.verifyToken?.(params.token) ?? null;
    // a token is only good for the user it was issued to
    url = link && link.userId === userId ? link.url : null;
  }
  if (!url) return { status: 404 }; // unknown, not visible, forged or expired: all look alike

  if (await deps.isOverLimit(userId)) return { status: 429 };
  await deps.recordDownload(userId);

  const opened = await deps.open(url);
  if (!opened.ok) {
    if (opened.reason === "too_large") return { status: 413 };
    if (opened.reason === "unsafe_url") return { status: 404 };
    return { status: 502 };
  }

  const headers: Record<string, string> = {
    "content-type": "application/pdf",
    // always a download: a third-party PDF is never rendered inline on our origin
    "content-disposition": `attachment; filename="${fileNameFor(url)}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  if (opened.sizeBytes !== null)
    headers["content-length"] = String(opened.sizeBytes);
  return { status: 200, stream: opened.stream, headers };
}
