import { describe, expect, it } from "vitest";
import {
  createPlaySchema,
  PLAY_LIMITS,
  playIdSchema,
  updatePlaySchema,
} from "./schemas";

const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const valid = {
  gameId: ID,
  playedOn: "2026-11-16",
  durationMinutes: null,
  sheetId: null,
  notes: null,
  expansionIds: [],
  participants: [{ name: "Ana" }],
};
const create = (patch: Record<string, unknown>) =>
  createPlaySchema.safeParse({ ...valid, ...patch });
const players = (n: number, name = "P") =>
  Array.from({ length: n }, (_, i) => ({ name: `${name}${i}` }));

describe("createPlaySchema", () => {
  it("accepts a valid payload and defaults the optional fields", () => {
    expect(create({}).success).toBe(true);
    const minimal = createPlaySchema.safeParse({
      gameId: ID,
      playedOn: "2026-11-16",
      expansionIds: [],
      participants: [{ name: "Ana" }],
    });
    expect(minimal.success).toBe(true);
    if (minimal.success)
      expect(minimal.data).toMatchObject({
        durationMinutes: null,
        sheetId: null,
        notes: null,
      });
  });

  it("trims names and notes; an empty note becomes null", () => {
    const parsed = create({
      notes: "  hi  ",
      participants: [{ name: "  Ana  " }],
    });
    expect(parsed.success && parsed.data.notes).toBe("hi");
    expect(parsed.success && parsed.data.participants[0].name).toBe("Ana");
    const empty = create({ notes: "   " });
    expect(empty.success && empty.data.notes).toBeNull();
  });

  it("a 60-char name is accepted, 61 and empty are rejected", () => {
    expect(create({ participants: [{ name: "x".repeat(60) }] }).success).toBe(
      true,
    );
    expect(create({ participants: [{ name: "x".repeat(61) }] }).success).toBe(
      false,
    );
    expect(create({ participants: [{ name: "   " }] }).success).toBe(false);
  });

  it("12 participants are accepted, 13 and 0 are rejected", () => {
    expect(
      create({ participants: players(PLAY_LIMITS.maxParticipants) }).success,
    ).toBe(true);
    expect(
      create({ participants: players(PLAY_LIMITS.maxParticipants + 1) })
        .success,
    ).toBe(false);
    expect(create({ participants: [] }).success).toBe(false);
  });

  it("accepts emoji and markup as plain text", () => {
    const result = create({
      participants: [
        { name: "🐦 Ana" },
        { name: "<img src=x onerror=1>" },
        { name: "Ana" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("playerId is optional (defaults to null) and must be a uuid", () => {
    const parsed = create({ participants: [{ name: "Ana" }] });
    expect(parsed.success && parsed.data.participants[0].playerId).toBeNull();
    expect(
      create({ participants: [{ name: "Ana", playerId: ID }] }).success,
    ).toBe(true);
    expect(
      create({ participants: [{ name: "Ana", playerId: "nope" }] }).success,
    ).toBe(false);
  });

  it("a player cannot appear twice: same playerId, or names that normalize alike", () => {
    expect(
      create({
        participants: [
          { name: "Ana", playerId: ID },
          { name: "Anita", playerId: ID },
        ],
      }).success,
    ).toBe(false);
    for (const other of ["Ana", "ana ", " ANA", "Aná"])
      expect(
        create({ participants: [{ name: "Ana" }, { name: other }] }).success,
        other,
      ).toBe(false);
  });

  it("different players with similar names are accepted", () => {
    expect(
      create({ participants: [{ name: "Ana" }, { name: "Anna" }] }).success,
    ).toBe(true);
  });

  it("rejects malformed dates", () => {
    for (const bad of ["2026-13-40", "yesterday", "", "16/11/2026", 20261116])
      expect(create({ playedOn: bad }).success, String(bad)).toBe(false);
  });

  it("duration: 0 and 1441 are rejected, null and 1440 accepted", () => {
    expect(create({ durationMinutes: 0 }).success).toBe(false);
    expect(create({ durationMinutes: 1441 }).success).toBe(false);
    expect(create({ durationMinutes: 1.5 }).success).toBe(false);
    expect(create({ durationMinutes: 1440 }).success).toBe(true);
    expect(create({ durationMinutes: null }).success).toBe(true);
  });

  it("rejects duplicate and more than 20 expansion ids", () => {
    expect(create({ expansionIds: [ID, ID] }).success).toBe(false);
    const many = Array.from(
      { length: 21 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(create({ expansionIds: many }).success).toBe(false);
    expect(create({ expansionIds: [ID, ID2] }).success).toBe(true);
  });

  it("rejects client-sent totals, ranks and winners (strict)", () => {
    for (const extra of [{ total: 99 }, { rank: 1 }, { isWinner: true }])
      expect(
        create({ participants: [{ name: "Ana", ...extra }] }).success,
      ).toBe(false);
    expect(create({ total: 5 }).success).toBe(false);
  });

  it("manual totals must be integers within ±1_000_000; values keys must look like category keys", () => {
    expect(
      create({ participants: [{ name: "A", manualTotal: 5 }] }).success,
    ).toBe(true);
    expect(
      create({ participants: [{ name: "A", manualTotal: 1.5 }] }).success,
    ).toBe(false);
    expect(
      create({ participants: [{ name: "A", manualTotal: 1_000_001 }] }).success,
    ).toBe(false);
    expect(
      create({ participants: [{ name: "A", values: { military: 3 } }] })
        .success,
    ).toBe(true);
    expect(
      create({ participants: [{ name: "A", values: { "Not A Key": 3 } }] })
        .success,
    ).toBe(false);
  });

  it("rejects a non-uuid game or sheet id", () => {
    expect(create({ gameId: "1" }).success).toBe(false);
    expect(create({ sheetId: "nope" }).success).toBe(false);
    expect(create({ sheetId: ID }).success).toBe(true);
  });
});

describe("updatePlaySchema / playIdSchema", () => {
  const update = {
    playId: ID,
    playedOn: "2026-11-16",
    expansionIds: [],
    participants: [{ name: "Ana" }],
  };

  it("requires playId and has no sheetId or gameId", () => {
    expect(updatePlaySchema.safeParse(update).success).toBe(true);
    expect(
      updatePlaySchema.safeParse({ ...update, playId: undefined }).success,
    ).toBe(false);
    expect(updatePlaySchema.safeParse({ ...update, sheetId: ID }).success).toBe(
      false,
    );
    expect(updatePlaySchema.safeParse({ ...update, gameId: ID }).success).toBe(
      false,
    );
  });

  it("playIdSchema is a uuid", () => {
    expect(playIdSchema.safeParse(ID).success).toBe(true);
    expect(playIdSchema.safeParse("x").success).toBe(false);
  });
});
