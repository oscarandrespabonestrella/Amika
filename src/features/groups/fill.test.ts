import { describe, expect, it } from "vitest";
import { groupFill } from "./fill";

const ana = { id: "a", name: "Ana" };
const bo = { id: "b", name: "Bo" };
const cy = { id: "c", name: "Cy" };
const empty = { playerId: null, name: "" };

describe("groupFill", () => {
  it("uses the empty rows first, in order, and appends the rest", () => {
    expect(groupFill([empty, empty], [ana, bo, cy])).toEqual({
      fillIndexes: [
        { rowIndex: 0, member: ana },
        { rowIndex: 1, member: bo },
      ],
      append: [cy],
    });
  });

  it("does not repeat a member already in the match", () => {
    expect(
      groupFill([{ playerId: "a", name: "Ana" }, empty], [ana, bo]),
    ).toEqual({ fillIndexes: [{ rowIndex: 1, member: bo }], append: [] });
  });

  it("does not treat a row with a typed name as empty", () => {
    expect(groupFill([{ playerId: null, name: "Zoe" }], [ana])).toEqual({
      fillIndexes: [],
      append: [ana],
    });
  });

  it("does nothing for an empty group", () => {
    expect(groupFill([empty], [])).toEqual({ fillIndexes: [], append: [] });
  });

  it("does nothing when everyone is already there", () => {
    expect(
      groupFill(
        [
          { playerId: "a", name: "Ana" },
          { playerId: "b", name: "Bo" },
        ],
        [ana, bo],
      ),
    ).toEqual({ fillIndexes: [], append: [] });
  });
});

describe("groupFill with typed names", () => {
  it("skips a member whose name is already typed in a row", () => {
    expect(groupFill([{ playerId: null, name: " ana" }], [ana, bo])).toEqual({
      fillIndexes: [],
      append: [bo],
    });
  });
});

describe("groupFill with a row limit", () => {
  it("does not append beyond the limit", () => {
    expect(
      groupFill([empty, { playerId: "z", name: "Zoe" }], [ana, bo, cy], 3),
    ).toEqual({
      fillIndexes: [{ rowIndex: 0, member: ana }],
      append: [bo],
    });
  });

  it("still fills empty rows when the form is already full", () => {
    expect(groupFill([empty, empty], [ana, bo, cy], 2)).toEqual({
      fillIndexes: [
        { rowIndex: 0, member: ana },
        { rowIndex: 1, member: bo },
      ],
      append: [],
    });
  });
});
