import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import {
  privateLinkHeaders,
  securityHeaders,
} from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Phone on the same Wi-Fi opening the dev server (npm run dev -- -H 0.0.0.0).
  allowedDevOrigins: ["192.168.31.78"],
  // Security headers on every route. The CSP is Report-Only until CSP_ENFORCE=1 is set
  // (build time): see docs/SECURITY.md for how and when to switch it.
  async headers() {
    return [
      {
        // The service worker must never be served from a stale cache.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      {
        source: "/:path*",
        headers: securityHeaders({
          nodeEnv:
            process.env.NODE_ENV === "production"
              ? "production"
              : "development",
          clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          modelBaseUrl: process.env.NEXT_PUBLIC_MODEL_BASE_URL,
          cspEnforce: process.env.CSP_ENFORCE === "1",
        }),
      },
      // After the global entry so these override its Referrer-Policy.
      { source: "/api/nights/guest/:path*", headers: privateLinkHeaders() },
      { source: "/:locale/n/:path*", headers: privateLinkHeaders() },
    ];
  },
  // `cacheComponents` / `partialPrefetching` (scaffold defaults) are off on purpose:
  // see docs/DECISIONS.md ADR-015.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
