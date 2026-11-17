import { describe, expect, it } from "vitest";
import {
  inviteToPlaySchema,
  linkPlayerSchema,
  myScoresSchema,
  respondSchema,
} from "./sharing-schemas";

const uuid = "00000000-0000-4000-8000-000000000001";

describe("sharing schemas", () => {
  it("invitar exige un asiento entre 0 y 11 y no admite campos extra", () => {
    const base = { playId: uuid, friendId: "user_1", seat: 3 };
    expect(inviteToPlaySchema.safeParse(base).success).toBe(true);
    expect(inviteToPlaySchema.safeParse({ ...base, seat: 12 }).success).toBe(
      false,
    );
    expect(inviteToPlaySchema.safeParse({ ...base, seat: -1 }).success).toBe(
      false,
    );
    expect(
      inviteToPlaySchema.safeParse({ ...base, role: "owner" }).success,
    ).toBe(false);
  });

  it("responder y vincular validan ids", () => {
    expect(respondSchema.safeParse({ id: uuid, accept: true }).success).toBe(
      true,
    );
    expect(respondSchema.safeParse({ id: "x", accept: true }).success).toBe(
      false,
    );
    expect(
      linkPlayerSchema.safeParse({ playerId: uuid, friendId: "" }).success,
    ).toBe(false);
  });

  it("mis puntos solo admiten claves válidas del motor", () => {
    expect(
      myScoresSchema.safeParse({ playId: uuid, values: { military: 3 } })
        .success,
    ).toBe(true);
    expect(
      myScoresSchema.safeParse({ playId: uuid, values: { "Bad Key": 3 } })
        .success,
    ).toBe(false);
  });
});
