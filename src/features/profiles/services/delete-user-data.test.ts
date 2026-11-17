import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const admin = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => admin.current,
}));

import { deleteUserData } from "./clerk-sync";

type Entry = { name: string; id: string | null };

/** In-memory Storage: folder -> entries. */
function fakeAdmin(
  tree: Record<string, Entry[]>,
  opts: {
    removeError?: boolean;
    deleteError?: boolean;
    transferError?: boolean;
  } = {},
) {
  const calls = {
    removed: [] as string[][],
    deletedProfile: [] as string[],
    transferred: [] as string[],
    order: [] as string[],
  };
  const client = {
    storage: {
      from: () => ({
        list: async (prefix: string) => ({
          data: tree[prefix] ?? [],
          error: null,
        }),
        remove: async (paths: string[]) => {
          calls.order.push("remove");
          calls.removed.push(paths);
          return { error: opts.removeError ? new Error("storage down") : null };
        },
      }),
    },
    rpc: async (name: string, args: { p_user: string }) => {
      calls.order.push(name);
      calls.transferred.push(args.p_user);
      return { error: opts.transferError ? new Error("transfer down") : null };
    },
    from: () => ({
      delete: () => ({
        eq: async (_column: string, id: string) => {
          calls.order.push("deleteProfile");
          calls.deletedProfile.push(id);
          return { error: opts.deleteError ? new Error("db down") : null };
        },
      }),
    }),
  };
  return { client, calls };
}

const TREE = {
  u1: [
    { name: "g1", id: null },
    { name: "g2", id: null },
  ],
  "u1/g1": [
    { name: "a.jpg", id: "x1" },
    { name: "b.jpg", id: "x2" },
  ],
  "u1/g2": [{ name: "c.jpg", id: "x3" }],
};

describe("deleteUserData", () => {
  beforeEach(() => {
    admin.current = null;
  });

  it("removes every nested file, then the profile row", async () => {
    const { client, calls } = fakeAdmin(TREE);
    admin.current = client;
    await deleteUserData("u1");
    expect(calls.removed.flat().sort()).toEqual([
      "u1/g1/a.jpg",
      "u1/g1/b.jpg",
      "u1/g2/c.jpg",
    ]);
    expect(calls.deletedProfile).toEqual(["u1"]);
    // files, then the matches are passed on, then the row
    expect(calls.order).toEqual([
      "remove",
      "transfer_or_delete_plays",
      "deleteProfile",
    ]);
  });

  it("still deletes the profile when the user has no files", async () => {
    const { client, calls } = fakeAdmin({});
    admin.current = client;
    await deleteUserData("u1");
    expect(calls.removed).toEqual([]);
    expect(calls.deletedProfile).toEqual(["u1"]);
  });

  it("removes files in batches of 100", async () => {
    const files = Array.from({ length: 250 }, (_, i) => ({
      name: `${i}.jpg`,
      id: `id${i}`,
    }));
    const { client, calls } = fakeAdmin({ u1: files });
    admin.current = client;
    await deleteUserData("u1");
    expect(calls.removed.map((batch) => batch.length)).toEqual([100, 100, 50]);
  });

  it("does NOT delete the profile if file removal fails (so a retry can finish the job)", async () => {
    const { client, calls } = fakeAdmin(TREE, { removeError: true });
    admin.current = client;
    await expect(deleteUserData("u1")).rejects.toThrow("storage down");
    expect(calls.deletedProfile).toEqual([]);
  });

  it("passes the matches to the other players before deleting the profile", async () => {
    const { client, calls } = fakeAdmin({});
    admin.current = client;
    await deleteUserData("u1");
    expect(calls.transferred).toEqual(["u1"]);
    expect(calls.order).toEqual(["transfer_or_delete_plays", "deleteProfile"]);
  });

  it("does NOT delete the profile if the matches could not be passed on", async () => {
    const { client, calls } = fakeAdmin({}, { transferError: true });
    admin.current = client;
    await expect(deleteUserData("u1")).rejects.toThrow("transfer down");
    expect(calls.deletedProfile).toEqual([]);
  });

  it("propagates a database failure", async () => {
    const { client } = fakeAdmin(TREE, { deleteError: true });
    admin.current = client;
    await expect(deleteUserData("u1")).rejects.toThrow("db down");
  });
});
