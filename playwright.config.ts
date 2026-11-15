import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local runs read the real Clerk dev keys from .env.local; CI uses secrets.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = 3100;
const hasClerkKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    // Signs in the test users once and stores their session cookies.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Public pages (anonymous visitor)
    {
      name: "desktop",
      testMatch: /public-pages\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testMatch: /public-pages\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    // Signed-in app
    {
      name: "app-desktop",
      testMatch: /app-.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "app-mobile",
      testMatch: /app-layout\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"] },
    },
  ],
  // A Clerk dev instance performs a handshake with its own domain, so the keys
  // must be real. Without them there is nothing to serve and the specs skip.
  webServer: hasClerkKeys
    ? {
        // Production build: `next dev` compiles routes on first hit, and
        // parallel workers race on that (intermittent "Unexpected end of JSON input").
        command: `npm run build && npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}/en`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        env: {
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
            process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
          CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY!,
        },
      }
    : undefined,
});
