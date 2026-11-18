import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Mobile screenshots of the app (not a test suite):
//   npx playwright test -c playwright.screenshots.config.ts
// Images land in screenshots/mobile/<theme>/. SHOT_USER picks the test user (default "b"),
// SHOT_GAME the catalog search used for the game screens (default "catan").
const phone = {
  ...devices["iPhone 15 Pro"],
  defaultBrowserType: "chromium" as const,
};

export default defineConfig({
  ...base,
  testDir: "tests",
  retries: 0,
  reporter: "list",
  projects: [
    { name: "setup", testMatch: /e2e\/auth\.setup\.ts/ },
    {
      name: "mobile-light",
      testMatch: /screenshots\/mobile\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...phone, colorScheme: "light" },
    },
    {
      name: "mobile-dark",
      testMatch: /screenshots\/mobile\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...phone, colorScheme: "dark" },
    },
  ],
});
