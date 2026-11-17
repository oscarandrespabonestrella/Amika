import { describe, expect, it } from "vitest";
import { applyChange, type LivePlay, shownTotal } from "./merge-play-state";

const PLAY = "00000000-0000-4000-8000-0000000000f1";
const OTHER = "00000000-0000-4000-8000-0000000000f2";
const PA = "00000000-0000-4000-8000-0000000000a1";
const PB = "00000000-0000-4000-8000-0000000000a2";

const base = (): LivePlay => ({
  id: PLAY,
  status: "open",
  participants: [
    {
      id: PA,
      seat: 0,
      name: "Ana",
      userId: null,
      scores: { m: 1 },
      total: null,
    },
    { id: PB, seat: 1, name: "Bo", userId: "u_b", scores: {}, total: null },
  ],
  members: [{ userId: "u_b", status: "accepted" }],
});

describe("applyChange", () => {
  it("un UPDATE de puntos cambia solo esa columna", () => {
    const next = applyChange(base(), {
      table: "play_scores",
      type: "UPDATE",
      row: { participant_id: PB, category_key: "m", value: 7 },
    }) as LivePlay;
    expect(next.participants[1].scores).toEqual({ m: 7 });
    expect(next.participants[0].scores).toEqual({ m: 1 });
  });

  it("un INSERT de puntos añade la categoría", () => {
    const next = applyChange(base(), {
      table: "play_scores",
      type: "INSERT",
      row: { participant_id: PA, category_key: "n", value: 2 },
    }) as LivePlay;
    expect(next.participants[0].scores).toEqual({ m: 1, n: 2 });
  });

  it("un DELETE pide volver a leer la partida", () => {
    for (const table of [
      "plays",
      "play_participants",
      "play_scores",
      "play_members",
    ] as const)
      expect(
        applyChange(base(), { table, type: "DELETE", row: { id: PLAY } }),
      ).toBe("refetch");
  });

  it("un cambio de una partida distinta se ignora", () => {
    const state = base();
    expect(
      applyChange(state, {
        table: "plays",
        type: "UPDATE",
        row: { id: OTHER, status: "closed" },
      }),
    ).toBe(state);
    expect(
      applyChange(state, {
        table: "play_members",
        type: "INSERT",
        row: { play_id: OTHER, user_id: "x", status: "accepted" },
      }),
    ).toBe(state);
  });

  it("los puntos de un participante desconocido piden volver a leer", () => {
    expect(
      applyChange(base(), {
        table: "play_scores",
        type: "INSERT",
        row: { participant_id: "unknown", category_key: "m", value: 1 },
      }),
    ).toBe("refetch");
  });

  it("cerrar la partida y un participante nuevo se reflejan", () => {
    let s = applyChange(base(), {
      table: "plays",
      type: "UPDATE",
      row: { id: PLAY, status: "closed" },
    }) as LivePlay;
    expect(s.status).toBe("closed");
    s = applyChange(s, {
      table: "play_participants",
      type: "INSERT",
      row: {
        id: "new",
        play_id: PLAY,
        seat: 2,
        display_name: "Cy",
        user_id: null,
        total_score: null,
      },
    }) as LivePlay;
    expect(s.participants.map((p) => p.name)).toEqual(["Ana", "Bo", "Cy"]);
  });

  it("un miembro que rechaza o sale se actualiza", () => {
    const next = applyChange(base(), {
      table: "play_members",
      type: "UPDATE",
      row: { play_id: PLAY, user_id: "u_b", status: "left" },
    }) as LivePlay;
    expect(next.members).toEqual([{ userId: "u_b", status: "left" }]);
  });
});

describe("shownTotal", () => {
  it("los totales mostrados son provisionales y no sustituyen a los de la partida cerrada", () => {
    const open = base();
    expect(shownTotal(open, open.participants[0], 99)).toBe(99);
    const closed: LivePlay = {
      ...base(),
      status: "closed",
      participants: [
        { id: PA, seat: 0, name: "Ana", userId: null, scores: {}, total: 10 },
      ],
    };
    expect(shownTotal(closed, closed.participants[0], 99)).toBe(10);
    // closed without a stored total (nothing scored): the provisional value is not invented
    const empty: LivePlay = {
      ...closed,
      participants: [{ ...closed.participants[0], total: null }],
    };
    expect(shownTotal(empty, empty.participants[0], 99)).toBeNull();
  });
});
