import { describe, expect, it } from "vitest";
import {
  guestNameSchema,
  nightInputSchema,
  pickerQuerySchema,
} from "./schemas";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = { title: "Noche", startsOn: "2026-12-05", gameIds: [id(1)] };

describe("nightInputSchema", () => {
  it("acepta una noche mínima y recorta el título", () => {
    const r = nightInputSchema.parse({ ...base, title: "  Noche  " });
    expect(r.title).toBe("Noche");
  });
  it("rechaza título vacío o de 81 caracteres", () => {
    expect(nightInputSchema.safeParse({ ...base, title: "   " }).success).toBe(
      false,
    );
    expect(
      nightInputSchema.safeParse({ ...base, title: "a".repeat(81) }).success,
    ).toBe(false);
    expect(
      nightInputSchema.safeParse({ ...base, title: "a".repeat(80) }).success,
    ).toBe(true);
  });
  it("rechaza 0, 13 o repetidos en gameIds", () => {
    expect(nightInputSchema.safeParse({ ...base, gameIds: [] }).success).toBe(
      false,
    );
    const many = Array.from({ length: 13 }, (_, i) => id(i + 1));
    expect(nightInputSchema.safeParse({ ...base, gameIds: many }).success).toBe(
      false,
    );
    expect(
      nightInputSchema.safeParse({ ...base, gameIds: [id(1), id(1)] }).success,
    ).toBe(false);
    expect(
      nightInputSchema.safeParse({ ...base, gameIds: many.slice(0, 12) })
        .success,
    ).toBe(true);
  });
  it("rechaza fechas inexistentes o mal formadas", () => {
    expect(
      nightInputSchema.safeParse({ ...base, startsOn: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      nightInputSchema.safeParse({ ...base, startsOn: "2026-2-3" }).success,
    ).toBe(false);
  });
  it("acota players y maxMinutes", () => {
    expect(nightInputSchema.safeParse({ ...base, players: 0 }).success).toBe(
      false,
    );
    expect(nightInputSchema.safeParse({ ...base, players: 101 }).success).toBe(
      false,
    );
    expect(nightInputSchema.safeParse({ ...base, maxMinutes: 4 }).success).toBe(
      false,
    );
    expect(
      nightInputSchema.safeParse({ ...base, maxMinutes: 1441 }).success,
    ).toBe(false);
    expect(
      nightInputSchema.safeParse({ ...base, players: 4, maxMinutes: 60 })
        .success,
    ).toBe(true);
  });
  it("exige uuid en groupId", () => {
    expect(nightInputSchema.safeParse({ ...base, groupId: "x" }).success).toBe(
      false,
    );
    expect(
      nightInputSchema.safeParse({ ...base, groupId: id(9) }).success,
    ).toBe(true);
  });
});

describe("pickerQuerySchema", () => {
  it("todo opcional, con los mismos límites", () => {
    expect(pickerQuerySchema.safeParse({}).success).toBe(true);
    expect(pickerQuerySchema.safeParse({ players: 0 }).success).toBe(false);
    expect(
      pickerQuerySchema.safeParse({ maxMinutes: 5, groupId: id(1) }).success,
    ).toBe(true);
  });
});

describe("guestNameSchema", () => {
  it("recorta y limita a 40", () => {
    expect(guestNameSchema.parse("  Ana ")).toBe("Ana");
    expect(guestNameSchema.safeParse("  ").success).toBe(false);
    expect(guestNameSchema.safeParse("a".repeat(41)).success).toBe(false);
  });
});
