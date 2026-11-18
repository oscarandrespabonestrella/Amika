import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRouteMap, routeUrl } from "../../scripts/lib/route-map.mts";

describe("routeUrl", () => {
  it.each([
    ["page.tsx", "/"],
    ["(app)/home/page.tsx", "/home"],
    ["(app)/games/[id]/plays/new/page.tsx", "/games/:id/plays/new"],
    ["(app)/games/(list)/page.tsx", "/games"],
    ["(auth)/sign-in/[[...sign-in]]/page.tsx", "/sign-in/*"],
    ["[...rest]/page.tsx", "/*"],
  ])("%s → %s", (file, url) => {
    expect(routeUrl(file)).toBe(url);
  });
});

describe("docs/ROUTES.md", () => {
  it("is up to date (run `npm run routes:map`)", () => {
    const onDisk = readFileSync("docs/ROUTES.md", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    expect(onDisk).toBe(buildRouteMap(process.cwd()));
  });
});
