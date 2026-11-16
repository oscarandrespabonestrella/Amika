import { describe, expect, it } from "vitest";
import {
  mergePlayersSchema,
  PLAYER_NAME_MAX,
  playerIdSchema,
  playerNameSchema,
  renamePlayerSchema,
  setMeSchema,
} from "./schemas";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";

describe("playerNameSchema", () => {
  it("accepts 60 characters and rejects 61 and empty", () => {
    expect(
      playerNameSchema.safeParse("x".repeat(PLAYER_NAME_MAX)).success,
    ).toBe(true);
    expect(
      playerNameSchema.safeParse("x".repeat(PLAYER_NAME_MAX + 1)).success,
    ).toBe(false);
    expect(playerNameSchema.safeParse("   ").success).toBe(false);
  });

  it("trims", () => {
    const parsed = playerNameSchema.safeParse("  Ana  ");
    expect(parsed.success && parsed.data).toBe("Ana");
  });
});

describe("renamePlayerSchema / mergePlayersSchema / setMeSchema / playerIdSchema", () => {
  it("rename needs a uuid and a name, and rejects extra keys", () => {
    expect(
      renamePlayerSchema.safeParse({ playerId: A, name: "Ana" }).success,
    ).toBe(true);
    expect(
      renamePlayerSchema.safeParse({ playerId: "x", name: "Ana" }).success,
    ).toBe(false);
    expect(
      renamePlayerSchema.safeParse({ playerId: A, name: "Ana", linked: 1 })
        .success,
    ).toBe(false);
  });

  it("merge needs two different uuids", () => {
    expect(
      mergePlayersSchema.safeParse({ keepId: A, removeId: B }).success,
    ).toBe(true);
    expect(
      mergePlayersSchema.safeParse({ keepId: A, removeId: A }).success,
    ).toBe(false);
    expect(mergePlayersSchema.safeParse({ keepId: A }).success).toBe(false);
  });

  it("setMe accepts a uuid or null", () => {
    expect(setMeSchema.safeParse({ playerId: A }).success).toBe(true);
    expect(setMeSchema.safeParse({ playerId: null }).success).toBe(true);
    expect(setMeSchema.safeParse({ playerId: "me" }).success).toBe(false);
  });

  it("playerIdSchema is a uuid", () => {
    expect(playerIdSchema.safeParse(A).success).toBe(true);
    expect(playerIdSchema.safeParse("nope").success).toBe(false);
  });
});
