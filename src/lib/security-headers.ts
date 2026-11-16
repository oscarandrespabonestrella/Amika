// Pure (no Next imports) so it is unit tested and can run in next.config.ts.
// The Content-Security-Policy is built from what the app really talks to: Clerk (its
// frontend API host comes from the publishable key), Supabase, BoardGameGeek images, the
// privacy-enhanced YouTube embed, and our own self-hosted WebAssembly engines.
//
// Known trade-off: `script-src 'unsafe-inline'`. Next's hydration scripts are inline and a
// nonce-based policy would force every page to be rendered dynamically; it is a follow-up.
// The policy still blocks plugins, base-tag and form hijacking, framing, and limits where
// data can be sent (connect-src) and loaded from (img/frame/worker-src).

export type HeaderEnv = {
  nodeEnv: "production" | "development" | "test";
  clerkPublishableKey: string | undefined;
  supabaseUrl: string | undefined;
  /** Send the CSP enforcing (true) or as Content-Security-Policy-Report-Only (false). */
  cspEnforce: boolean;
};

const HOST = /^[a-z0-9.-]+$/i;

/** The Clerk frontend API host encoded in a publishable key (`pk_test_…` / `pk_live_…`). */
export function clerkFrontendHost(key: string | undefined): string | null {
  const encoded = key?.match(/^pk_(?:test|live)_(.+)$/)?.[1];
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const host = decoded.endsWith("$") ? decoded.slice(0, -1) : "";
    return host && HOST.test(host) ? host : null;
  } catch {
    return null;
  }
}

function supabaseHost(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

const GEEKDO_IMAGES = [
  "https://*.geekdo-images.com",
  "https://*.geekdo-static.com",
];
const CLERK_SHARED = {
  script: ["https://challenges.cloudflare.com", "https://*.protect.clerk.com"],
  connect: [
    "https://*.protect.clerk.com:*",
    "https://clerk-telemetry.com",
    "https://*.clerk-telemetry.com",
    "https://img.clerk.com",
  ],
  frame: ["https://challenges.cloudflare.com", "https://*.protect.clerk.com"],
};

export function buildCsp(env: HeaderEnv): string {
  const dev = env.nodeEnv === "development";
  const clerk = clerkFrontendHost(env.clerkPublishableKey);
  const supabase = supabaseHost(env.supabaseUrl);
  const clerkOrigin = clerk ? [`https://${clerk}`] : [];
  const supabaseHttp = supabase ? [`https://${supabase}`] : [];
  const supabaseWs = supabase ? [`wss://${supabase}`] : [];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'", // the self-hosted OCR / barcode engines
      ...(dev ? ["'unsafe-eval'"] : []),
      ...clerkOrigin,
      ...CLERK_SHARED.script,
    ],
    "style-src": ["'self'", "'unsafe-inline'"], // Clerk injects styles at runtime
    "img-src": [
      "'self'",
      "data:",
      "blob:", // photos being identified are drawn from blob: object URLs
      "https://img.clerk.com",
      ...supabaseHttp,
      ...GEEKDO_IMAGES,
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...clerkOrigin,
      ...CLERK_SHARED.connect,
      ...supabaseHttp,
      ...supabaseWs,
      ...(dev ? ["ws://localhost:*", "http://localhost:*"] : []),
    ],
    "frame-src": [
      "'self'",
      "https://www.youtube-nocookie.com",
      ...CLERK_SHARED.frame,
    ],
    "worker-src": ["'self'", "blob:"], // Tesseract runs in a Web Worker
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );
  return parts.join("; ");
}

export function securityHeaders(
  env: HeaderEnv,
): { key: string; value: string }[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // The report-only CSP ignores frame-ancestors, so framing is also denied here.
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(self), microphone=(), geolocation=(), payment=()",
    },
    {
      key: env.cspEnforce
        ? "Content-Security-Policy"
        : "Content-Security-Policy-Report-Only",
      value: buildCsp(env),
    },
  ];
  if (env.nodeEnv === "production")
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  return headers;
}
