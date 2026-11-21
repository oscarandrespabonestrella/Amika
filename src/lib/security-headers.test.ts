import { describe, expect, it } from "vitest";
import {
  buildCsp,
  clerkFrontendHost,
  privateLinkHeaders,
  securityHeaders,
  type HeaderEnv,
} from "./security-headers";

// Clerk's publishable keys are "pk_test_" / "pk_live_" + base64("<frontend host>$").
const b64 = (s: string) => Buffer.from(s).toString("base64");
const PK_TEST = `pk_test_${b64("sweet-owl-12.clerk.accounts.dev$")}`;
const PK_LIVE = `pk_live_${b64("clerk.amika.example$")}`;

const env = (over: Partial<HeaderEnv> = {}): HeaderEnv => ({
  modelBaseUrl: undefined,
  nodeEnv: "production",
  clerkPublishableKey: PK_TEST,
  supabaseUrl: "https://abcd1234.supabase.co",
  cspEnforce: false,
  ...over,
});

const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(name + " ") || d === name);

describe("clerkFrontendHost", () => {
  it("decodes the frontend API host from a publishable key", () => {
    expect(clerkFrontendHost(PK_TEST)).toBe("sweet-owl-12.clerk.accounts.dev");
    expect(clerkFrontendHost(PK_LIVE)).toBe("clerk.amika.example");
  });
  it("is null for missing or malformed keys", () => {
    for (const bad of [undefined, "", "nope", "pk_test_", "pk_test_%%%"])
      expect(clerkFrontendHost(bad), String(bad)).toBeNull();
  });
  it("refuses a decoded value that is not a plain host name", () => {
    expect(clerkFrontendHost(`pk_test_${b64("evil.com/path$")}`)).toBeNull();
    expect(clerkFrontendHost(`pk_test_${b64("a b.com$")}`)).toBeNull();
  });
});

describe("buildCsp", () => {
  const csp = buildCsp(env());

  it("allows the self-hosted WebAssembly engines and their workers", () => {
    expect(directive(csp, "script-src")).toContain("'wasm-unsafe-eval'");
    expect(directive(csp, "worker-src")).toBe("worker-src 'self' blob:");
  });

  it("allows only the hosts the app really talks to", () => {
    const connect = directive(csp, "connect-src")!;
    expect(connect).toContain("https://sweet-owl-12.clerk.accounts.dev");
    expect(connect).toContain("https://abcd1234.supabase.co");
    expect(connect).toContain("wss://abcd1234.supabase.co");
    expect(directive(csp, "script-src")).toContain(
      "https://sweet-owl-12.clerk.accounts.dev",
    );
    expect(directive(csp, "img-src")).toContain("https://abcd1234.supabase.co");
    expect(directive(csp, "img-src")).toContain("https://*.geekdo-images.com");
    expect(directive(csp, "img-src")).toContain("blob:");
    expect(directive(csp, "frame-src")).toContain(
      "https://www.youtube-nocookie.com",
    );
  });

  it("closes the dangerous doors", () => {
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    const script = directive(csp, "script-src")!;
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toMatch(/(^|\s)https?:(\s|$)/);
    expect(script).not.toMatch(/(^|\s)\*(\s|$)/);
    expect(script).not.toContain("data:");
  });

  it("development allows eval and HMR sockets; production does not", () => {
    // upgrade-insecure-requests is deliberately absent: HSTS covers it, and it would
    // break an enforcing policy on http://localhost.
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(directive(csp, "connect-src")).not.toContain("ws://localhost:*");
    const dev = buildCsp(env({ nodeEnv: "development" }));
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws://localhost:*");
  });

  it("allows a model hosted on another https origin to be downloaded (connect-src), nothing else", () => {
    const other = buildCsp(
      env({ modelBaseUrl: "https://models.example.com/clip/" }),
    );
    expect(directive(other, "connect-src")).toContain(
      "https://models.example.com",
    );
    for (const bad of [
      "/models/",
      "http://insecure.example.com/",
      "javascript:alert(1)",
      "not a url",
      undefined,
    ])
      expect(
        directive(buildCsp(env({ modelBaseUrl: bad })), "connect-src"),
        String(bad),
      ).not.toMatch(/example.com/);
  });

  it("copes with missing hosts without printing null or undefined", () => {
    const bare = buildCsp(
      env({ clerkPublishableKey: undefined, supabaseUrl: undefined }),
    );
    expect(bare).not.toMatch(/null|undefined|https:\/\/\s|wss:\/\/\s/);
    expect(directive(bare, "connect-src")).toContain("'self'");
  });
});

describe("securityHeaders", () => {
  const find = (headers: { key: string; value: string }[], key: string) =>
    headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

  it("always sends the basic hardening headers", () => {
    for (const nodeEnv of ["production", "development"] as const) {
      const h = securityHeaders(env({ nodeEnv }));
      expect(find(h, "X-Content-Type-Options")).toBe("nosniff");
      expect(find(h, "Referrer-Policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(find(h, "X-Frame-Options")).toBe("DENY");
      const permissions = find(h, "Permissions-Policy")!;
      expect(permissions).toContain("camera=(self)");
      expect(permissions).toContain("microphone=()");
      expect(permissions).toContain("geolocation=()");
    }
  });

  it("sends the CSP in report-only mode unless enforcement is switched on", () => {
    const report = securityHeaders(env());
    expect(find(report, "Content-Security-Policy-Report-Only")).toContain(
      "default-src 'self'",
    );
    expect(find(report, "Content-Security-Policy")).toBeUndefined();

    const enforce = securityHeaders(env({ cspEnforce: true }));
    expect(find(enforce, "Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
    expect(
      find(enforce, "Content-Security-Policy-Report-Only"),
    ).toBeUndefined();
  });

  it("HSTS only in production", () => {
    expect(find(securityHeaders(env()), "Strict-Transport-Security")).toContain(
      "max-age=",
    );
    expect(
      find(
        securityHeaders(env({ nodeEnv: "development" })),
        "Strict-Transport-Security",
      ),
    ).toBeUndefined();
  });
});

describe("privateLinkHeaders", () => {
  it("sends no referrer and asks not to be indexed", () => {
    const h = Object.fromEntries(
      privateLinkHeaders().map((x) => [x.key, x.value]),
    );
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["X-Robots-Tag"]).toBe("noindex, nofollow");
  });
});
