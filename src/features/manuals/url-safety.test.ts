import { describe, expect, it } from "vitest";
import {
  isPrivateAddress,
  isSafePublicUrl,
  normalizeManualUrl,
  parseManualUrl,
} from "./url-safety";

describe("parseManualUrl", () => {
  it("accepts a plain https URL", () => {
    expect(
      parseManualUrl("https://www.devir.com/rules/catan.pdf"),
    ).not.toBeNull();
  });

  it.each([
    ["http", "http://example.com/a.pdf"],
    ["credentials", "https://user:pw@example.com/a.pdf"],
    ["port", "https://example.com:8443/a.pdf"],
    ["IPv4 literal", "https://93.184.216.34/a.pdf"],
    ["IPv6 literal", "https://[2606:2800:220:1::1]/a.pdf"],
    ["localhost", "https://localhost/a.pdf"],
    ["single label", "https://intranet/a.pdf"],
    [".local", "https://printer.local/a.pdf"],
    [".internal", "https://metadata.google.internal/a.pdf"],
    ["not a URL", "not a url"],
    ["javascript", "javascript:alert(1)"],
    ["too long", `https://example.com/${"a".repeat(500)}`],
  ])("rejects %s", (_label, url) => {
    expect(parseManualUrl(url)).toBeNull();
  });
});

describe("normalizeManualUrl", () => {
  it("upgrades http, drops the fragment and tracking parameters, keeps the rest", () => {
    expect(
      normalizeManualUrl(
        "http://Example.com/R.pdf?utm_source=x&page=2&fbclid=1#top",
      ),
    ).toBe("https://example.com/R.pdf?page=2");
  });

  it("makes http and https collapse to one key", () => {
    expect(normalizeManualUrl("http://a.example/x.pdf")).toBe(
      normalizeManualUrl("https://a.example/x.pdf"),
    );
  });

  it("is null for an unacceptable URL", () => {
    expect(normalizeManualUrl("http://127.0.0.1/x.pdf")).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "garbage",
  ])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1::1"])(
    "%s is public",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe("isSafePublicUrl", () => {
  const url = "https://rules.example.com/a.pdf";

  it("accepts a host that resolves to public addresses", async () => {
    expect(await isSafePublicUrl(url, async () => ["93.184.216.34"])).toBe(
      true,
    );
  });

  it("rejects a host that resolves to a private address", async () => {
    expect(await isSafePublicUrl(url, async () => ["10.0.0.5"])).toBe(false);
  });

  it("rejects when ANY address is private", async () => {
    expect(
      await isSafePublicUrl(url, async () => ["93.184.216.34", "127.0.0.1"]),
    ).toBe(false);
  });

  it("rejects when the lookup fails or returns nothing", async () => {
    expect(
      await isSafePublicUrl(url, async () => {
        throw new Error("ENOTFOUND");
      }),
    ).toBe(false);
    expect(await isSafePublicUrl(url, async () => [])).toBe(false);
  });

  it("does not even resolve an unacceptable URL", async () => {
    let called = false;
    const ok = await isSafePublicUrl("http://example.com/a.pdf", async () => {
      called = true;
      return ["93.184.216.34"];
    });
    expect(ok).toBe(false);
    expect(called).toBe(false);
  });
});
