import { describe, expect, it, vi } from "vitest";
import { addPackGame } from "./add";

const info = (id: string) =>
  id === "bgg:224517"
    ? { bggId: "224517", name: "Brass: Birmingham", rank: 1 }
    : null;

describe("addPackGame", () => {
  it("imports the BGG game, then remembers the frame for the imported catalog game", async () => {
    const order: string[] = [];
    const importGame = vi.fn(async (bggId: string) => {
      order.push(`import ${bggId}`);
      return { ok: true as const, gameId: "uuid-new" };
    });
    const confirm = vi.fn(async (gameId: string) => {
      order.push(`confirm ${gameId}`);
    });
    const result = await addPackGame("bgg:224517", {
      info,
      importGame,
      confirm,
    });
    expect(result).toEqual({ ok: true, gameId: "uuid-new" });
    expect(order).toEqual(["import 224517", "confirm uuid-new"]);
  });

  it("passes the import error through and learns nothing", async () => {
    const confirm = vi.fn(async () => undefined);
    const result = await addPackGame("bgg:224517", {
      info,
      importGame: async () => ({ ok: false as const, error: "unavailable" }),
      confirm,
    });
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("is a plain failure when the id is not a pack game, without calling BGG", async () => {
    const importGame = vi.fn();
    const result = await addPackGame("00000000-0000-4000-8000-0000000000a1", {
      info,
      importGame,
      confirm: async () => undefined,
    });
    expect(result).toEqual({ ok: false, error: "failed" });
    expect(importGame).not.toHaveBeenCalled();
  });

  it("turns an exception from the import or from learning into a failure", async () => {
    const thrown = await addPackGame("bgg:224517", {
      info,
      importGame: async () => {
        throw new Error("network");
      },
      confirm: async () => undefined,
    });
    expect(thrown).toEqual({ ok: false, error: "failed" });
  });

  it("still opens the imported game when only the learning step fails", async () => {
    const result = await addPackGame("bgg:224517", {
      info,
      importGame: async () => ({ ok: true as const, gameId: "uuid-new" }),
      confirm: async () => {
        throw new Error("indexeddb full");
      },
    });
    expect(result).toEqual({ ok: true, gameId: "uuid-new" });
  });
});
