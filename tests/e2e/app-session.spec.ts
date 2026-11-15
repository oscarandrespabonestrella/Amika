import { expect, test } from "@playwright/test";
import {
  canRunAppTests,
  getProfile,
  STATE_FILE,
  TEST_USERS,
  testUserId,
  withDb,
} from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
test.use({ storageState: STATE_FILE.a });
// These tests mutate user A's profile, so they must run in order.
test.describe.configure({ mode: "serial" });

let userA: string;
let userB: string;

test.beforeAll(async () => {
  userA = await testUserId(TEST_USERS.a.email);
  userB = await testUserId(TEST_USERS.b.email);
  // Start without a profile row to exercise the lazy-creation path.
  await withDb((c) =>
    c.query("delete from public.profiles where id = $1", [userA]),
  );
});

test("a signed-in visitor skips the landing page and gets a profile", async ({
  page,
}) => {
  await page.goto("/en");
  await expect(page).toHaveURL(/\/en\/home$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Welcome back",
  );

  // Supabase accepted the Clerk token, and RLS let the user create their own row.
  await expect
    .poll(() => getProfile(userA))
    .toMatchObject({ id: userA, theme: "system", locale: "en" });
});

test("choosing a theme applies instantly and is saved to the profile", async ({
  page,
}) => {
  await page.goto("/en/settings");
  await page.getByRole("button", { name: "Dark" }).click();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => getProfile(userA).then((p) => p?.theme)).toBe("dark");
  // Next's own route announcer also has role="alert": match our message only.
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn't save" }),
  ).toHaveCount(0);
});

test("choosing a language navigates and is saved to the profile", async ({
  page,
}) => {
  await page.goto("/en/settings");
  await page.getByRole("button", { name: "Español" }).click();

  await expect(page).toHaveURL(/\/es\/settings$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ajustes");
  await expect.poll(() => getProfile(userA).then((p) => p?.locale)).toBe("es");
});

test("a device that never chose a theme adopts the saved one", async ({
  browser,
}) => {
  // Fresh browser context: no localStorage, and the OS prefers light.
  const context = await browser.newContext({
    storageState: STATE_FILE.a,
    colorScheme: "light",
  });
  const page = await context.newPage();
  await page.goto("/en/home");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await context.close();
});

test("another user's profile is never touched", async () => {
  const profileB = await getProfile(userB);
  if (profileB) {
    expect(profileB.theme).not.toBe("dark");
    expect(profileB.locale).not.toBe("es");
  }
});
