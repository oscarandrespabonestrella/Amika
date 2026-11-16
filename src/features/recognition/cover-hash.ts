import "server-only";
import { dHashFromGray, HASH_HEIGHT, HASH_WIDTH } from "./dhash";

// Hashing a game's cover without storing it. The cover is only ever LINKED (ADR: not
// copied); here the server fetches it transiently, computes a 64-bit hash and drops the
// bytes. The URL comes from our own catalog, but it is still treated as untrusted:
// https only, an allowlist of BoardGameGeek's image hosts, bounded redirects, size and
// time, so it can never be used to reach internal addresses.

const ALLOWED_HOSTS = [
  /^(?:[a-z0-9-]+\.)*geekdo-images\.com$/,
  /^(?:[a-z0-9-]+\.)*geekdo-static\.com$/,
];
const MAX_REDIRECTS = 2;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 50_000_000;

export function isAllowedCoverUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    ALLOWED_HOSTS.some((re) => re.test(url.hostname.toLowerCase()))
  );
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** The bytes of an allowed cover image, or null on any problem (never throws). */
export async function fetchCoverBytes(
  url: string,
  fetchImpl: FetchLike = fetch,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Uint8Array | null> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedCoverUrl(current)) return null;
      const res = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "image/*" },
      });
      if (REDIRECTS.has(res.status)) {
        const location = res.headers.get("location");
        if (!location) return null;
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) return null;
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!type.startsWith("image/")) return null;
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      return await readLimited(res.body, maxBytes);
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * dHash of an image: EXIF-rotated, flattened over white, grayscale, resized to exactly
 * 9x8. The browser does the same with a canvas (tolerance: Hamming distance <= 6).
 */
export async function hashCoverBytes(
  bytes: Uint8Array,
): Promise<string | null> {
  if (bytes.byteLength === 0) return null;
  try {
    const { default: sharp } = await import("sharp");
    const raw = await sharp(Buffer.from(bytes), {
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .flatten({ background: "#ffffff" })
      .grayscale()
      .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill" })
      .raw()
      .toBuffer();
    return dHashFromGray(Array.from(raw));
  } catch {
    return null;
  }
}

export async function hashCover(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const bytes = await fetchCoverBytes(url, fetchImpl);
  return bytes ? hashCoverBytes(bytes) : null;
}
