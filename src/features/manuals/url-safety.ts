import { isIP } from "node:net";

// URLs that come from a web search are untrusted input. Before the server fetches one it
// must be https, name a public host (never an address inside our network) and fit the
// `game_resources.url` check. The DNS lookup is injected so tests need no network.

export const MAX_URL_LENGTH = 500;

const BLOCKED_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home",
  ".home.arpa",
  ".intranet",
];

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_eid$|mc_cid$|ref$)/i;

/** The URL if it is syntactically acceptable (https, public-looking host), else null. */
export function parseManualUrl(raw: string): URL | null {
  if (raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.port !== "")
    return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return null; // "localhost", intranet short names
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) return null; // no IP literals
  if (host.startsWith("[")) return null;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return null;
  return url;
}

/**
 * One canonical form per document, so duplicates collapse: http upgraded to https, lower-case
 * host, no fragment, no tracking parameters. Null when the URL is not acceptable.
 */
export function normalizeManualUrl(raw: string): string | null {
  const trimmed = raw.trim();
  const upgraded = /^http:\/\//i.test(trimmed)
    ? `https://${trimmed.slice(7)}`
    : trimmed;
  const url = parseManualUrl(upgraded);
  if (!url) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  const out = url.toString();
  return out.length <= MAX_URL_LENGTH ? out : null;
}

function ipv4Private(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

/** True for loopback, private, link-local, multicast and unspecified addresses. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    return ipv4Private(a, b);
  }
  if (kind === 6) {
    // IPv4-mapped (::ffff:1.2.3.4 or ::ffff:7f00:1): judge the embedded IPv4 address
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (dotted) return isPrivateAddress(dotted[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      return ipv4Private(hi >> 8, hi & 255);
    }
    if (ip === "::" || ip === "::1") return true;
    const first = parseInt(ip.split(":")[0] || "0", 16);
    return (
      (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (first & 0xff00) === 0xff00 || // multicast
      ip.startsWith("64:ff9b:") // NAT64 can reach IPv4 internals
    );
  }
  return true; // not an address at all: refuse
}

export type Resolver = (hostname: string) => Promise<string[]>;

async function defaultResolve(hostname: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

/**
 * True when the URL is acceptable AND its host resolves only to public addresses.
 * Checked again on every redirect hop. (The fetch resolves the name again, so a hostile
 * DNS server could still answer differently the second time; the response is only ever
 * inspected for the PDF signature and never reaches a place that can act on it.)
 */
export async function isSafePublicUrl(
  raw: string,
  resolve: Resolver = defaultResolve,
): Promise<boolean> {
  const url = parseManualUrl(raw);
  if (!url) return false;
  try {
    const addresses = await resolve(url.hostname);
    return addresses.length > 0 && !addresses.some(isPrivateAddress);
  } catch {
    return false;
  }
}
