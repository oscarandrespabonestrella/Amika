import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import {
  canRunAppTests,
  ensureTestUser,
  STATE_FILE,
  TEST_USERS,
} from "./helpers";

setup.skip(!canRunAppTests, "Clerk keys / database not configured");
setup.describe.configure({ mode: "serial" });

setup("configure Clerk testing", async () => {
  await clerkSetup();
});

for (const key of [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
] as const) {
  const user = TEST_USERS[key];
  setup(`sign in test user ${key.toUpperCase()}`, async ({ page }) => {
    await ensureTestUser(user.email, user.firstName);

    // Must be an unprotected page that loads Clerk.
    await page.goto("/en/sign-in");
    await clerk.signIn({ page, emailAddress: user.email });

    await page.goto("/en/home");
    await page.waitForURL(/\/en\/home/);
    await page.context().storageState({ path: STATE_FILE[key] });
  });
}
