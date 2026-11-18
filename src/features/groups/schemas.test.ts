import { describe, expect, it } from "vitest";
import {
  createGroupSchema,
  GROUP_NAME_MAX,
  renameGroupSchema,
  setMembersSchema,
} from "./schemas";

const ID_1 = "00000000-0000-4000-8000-000000000001";
const ID_2 = "00000000-0000-4000-8000-000000000002";

const messageOf = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => result.error?.issues[0]?.message;

describe("group schemas", () => {
  it("trims the name", () => {
    expect(createGroupSchema.parse({ name: "  Jueves " }).name).toBe("Jueves");
  });

  it("rejects an empty name with the code `required`", () => {
    expect(messageOf(createGroupSchema.safeParse({ name: "   " }))).toBe(
      "required",
    );
  });

  it("rejects a name over the limit with the code `tooLong`", () => {
    const long = "a".repeat(GROUP_NAME_MAX + 1);
    expect(messageOf(createGroupSchema.safeParse({ name: long }))).toBe(
      "tooLong",
    );
    expect(
      createGroupSchema.safeParse({ name: "a".repeat(GROUP_NAME_MAX) }).success,
    ).toBe(true);
  });

  it("rename needs a uuid group id", () => {
    expect(
      renameGroupSchema.safeParse({ groupId: "nope", name: "x" }).success,
    ).toBe(false);
    expect(
      renameGroupSchema.safeParse({ groupId: ID_1, name: "x" }).success,
    ).toBe(true);
  });

  it("setMembers accepts an empty list", () => {
    expect(
      setMembersSchema.safeParse({ groupId: ID_1, playerIds: [] }).success,
    ).toBe(true);
  });

  it("setMembers rejects repeated and non-uuid ids", () => {
    expect(
      setMembersSchema.safeParse({ groupId: ID_1, playerIds: [ID_2, ID_2] })
        .success,
    ).toBe(false);
    expect(
      setMembersSchema.safeParse({ groupId: ID_1, playerIds: ["x"] }).success,
    ).toBe(false);
  });

  it("setMembers rejects more than 200 ids", () => {
    const many = Array.from(
      { length: 201 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(
      setMembersSchema.safeParse({ groupId: ID_1, playerIds: many }).success,
    ).toBe(false);
  });
});
