import { expect, test } from "@playwright/test";
import { canRunAppTests, STATE_FILE } from "./helpers";

test.skip(!canRunAppTests, "Clerk keys / database not configured");
test.use({ storageState: STATE_FILE.o });

test("signed out: 401, whatever the id", async ({ browser }) => {
  // Explicitly empty: a new context would otherwise inherit the signed-in state.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  for (const id of ["999999999", "abc"]) {
    const res = await context.request.get(`/api/covers/pack/${id}`, {
      maxRedirects: 0,
    });
    expect(res.status(), id).toBe(401);
    expect(res.headers()["content-type"] ?? "").not.toContain("image/");
  }
  await context.close();
});

test("a malformed id and an id outside the pack are the same empty 404", async ({
  request,
}) => {
  for (const id of ["abc", "12345678901", "999999999", "__proto__"]) {
    const res = await request.get(`/api/covers/pack/${id}`);
    expect(res.status(), id).toBe(404);
    expect(await res.text(), id).toBe("");
  }
});
