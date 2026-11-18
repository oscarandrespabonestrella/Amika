import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  FILE_PREFIX,
  MANUALS_CACHE,
  META_PREFIX,
} from "@/features/manuals/offline/constants";

type SwLogic = {
  SHELL_CACHE: string;
  MANUALS_CACHE: string;
  FILE_PREFIX: string;
  MANUALS_PAGE: string;
  PRECACHE: string[];
  routeFor(method: string, mode: string, url: string, origin: string): string;
  staleCaches(keys: string[]): string[];
};

const sw = createRequire(import.meta.url)(
  "../../public/sw-logic.js",
) as SwLogic;
const ORIGIN = "https://amika.example";

const route = (url: string, method = "GET", mode = "same-origin") =>
  sw.routeFor(method, mode, url, ORIGIN);

describe("service worker routing", () => {
  it("answers a saved manual from the manuals cache", () => {
    expect(route(`${ORIGIN}${FILE_PREFIX}abc123`)).toBe("manual-file");
    expect(route(`${ORIGIN}${FILE_PREFIX}abc123`, "GET", "navigate")).toBe(
      "manual-file",
    );
  });

  it("answers the offline manuals list from the shell cache", () => {
    expect(route(`${ORIGIN}/offline/manuals.html`, "GET", "navigate")).toBe(
      "manuals-page",
    );
  });

  it("keeps the old behaviour for page loads and ignores the rest", () => {
    expect(route(`${ORIGIN}/en/games`, "GET", "navigate")).toBe("navigate");
    expect(route(`${ORIGIN}/api/manuals/file?token=x`)).toBe("ignore");
    expect(route(`${ORIGIN}/_next/static/a.js`)).toBe("ignore");
  });

  it("never touches non-GET or cross-origin requests", () => {
    expect(route(`${ORIGIN}${FILE_PREFIX}abc`, "POST")).toBe("ignore");
    expect(route(`https://evil.example${FILE_PREFIX}abc`)).toBe("ignore");
    expect(route("not a url")).toBe("ignore");
  });

  it("the stale-cache cleanup can never delete the saved manuals", () => {
    const keys = [
      sw.SHELL_CACHE,
      "amika-offline-v0",
      MANUALS_CACHE,
      "recognition-model-v1",
    ];
    expect(sw.staleCaches(keys)).toEqual(["amika-offline-v0"]);
    expect(sw.staleCaches([MANUALS_CACHE])).toEqual([]);
  });

  it("precaches the offline pages", () => {
    expect(sw.PRECACHE).toEqual(
      expect.arrayContaining(["/offline.html", "/offline/manuals.html"]),
    );
  });
});

describe("client and worker agree on cache names and paths", () => {
  it("shares the manuals cache name and file prefix", () => {
    expect(MANUALS_CACHE).toBe(sw.MANUALS_CACHE);
    expect(FILE_PREFIX).toBe(sw.FILE_PREFIX);
  });

  it("the offline page reads the same names the app writes", async () => {
    const { readFileSync } = await import("node:fs");
    const html = readFileSync("public/offline/manuals.html", "utf8");
    expect(html).toContain(JSON.stringify(MANUALS_CACHE));
    expect(html).toContain(JSON.stringify(FILE_PREFIX));
    expect(html).toContain(JSON.stringify(META_PREFIX));
  });
});
