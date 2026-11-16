import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Security headers on every route. The CSP is Report-Only until CSP_ENFORCE=1 is set
  // (build time): see docs/SECURITY.md for how and when to switch it.
  async headers() {
    return [
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
