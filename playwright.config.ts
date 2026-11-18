import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local runs read the real Clerk dev keys from .env.local; CI uses secrets.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = 3100;
const HEAVY =
  /app-(live-recognition|pack-recognition|pack-unknown|security-headers)\.spec\.ts/;
const hasClerkKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Assertions wait up to 10 s: with 8 workers sharing Clerk and Supabase round trips,
  // the 5 s default produced one unrelated timing failure per full run.
  expect: { timeout: 10_000 },
  // One retry everywhere (not only on CI): with 200+ tests on 8 workers a form submit right
  // after navigation can lose a hydration race on a busy machine. A retried pass is
  // reported as "flaky", so it stays visible.
  retries: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
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
      testIgnore: HEAVY,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    // CPU-heavy specs (WebAssembly OCR) run AFTER everything else, never beside the
    // timing-sensitive specs: they starve the machine and made unrelated tests flaky.
    {
      name: "app-heavy",
      testMatch: HEAVY,
      dependencies: ["setup", "app-desktop"],
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
  // E2E_BASE_URL points the suite at an already-running deployment (no local server).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : hasClerkKeys
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
            // The suite never calls the real search API: with no key the manual search says
            // "not set up" (and nothing is billed).
            BRAVE_SEARCH_API_KEY: "",
          },
        }
      : undefined,
});
