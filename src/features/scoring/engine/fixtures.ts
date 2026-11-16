import { type Definition, definitionSchema } from "./definition";

/**
 * Test-only sheets reproducing real games. They are NOT seeded anywhere: users
 * build their own sheets. Harmonies is deliberately absent until its exact
 * scoring categories are confirmed with the user.
 */

export const SEVEN_WONDERS: Definition = definitionSchema.parse({
  schemaVersion: 1,
  categories: [
    { key: "military", label: "Military", type: "number" },
    {
      key: "coins",
      label: "Coins (1 point per 3)",
      type: "per_n",
      n: 3,
      pointsPer: 1,
    },
    { key: "wonders", label: "Wonders", type: "number", min: 0 },
    { key: "civilian", label: "Civilian structures", type: "number", min: 0 },
    { key: "commerce", label: "Commercial structures", type: "number", min: 0 },
    { key: "guilds", label: "Guilds", type: "number", min: 0 },
    {
      key: "science",
      label: "Science",
      type: "set_bonus",
      perSet: 7,
      inputs: [
        { key: "tablets", label: "Tablets" },
        { key: "compass", label: "Compass" },
        { key: "gears", label: "Gears" },
      ],
    },
  ],
});

export const WINGSPAN: Definition = definitionSchema.parse({
  schemaVersion: 1,
  categories: [
    { key: "birds", label: "Birds", type: "number", min: 0 },
    { key: "bonus_cards", label: "Bonus cards", type: "number", min: 0 },
    { key: "round_goals", label: "End-of-round goals", type: "number", min: 0 },
    { key: "eggs", label: "Eggs", type: "number", min: 0 },
    { key: "food_on_cards", label: "Food on cards", type: "number", min: 0 },
    { key: "tucked_cards", label: "Tucked cards", type: "number", min: 0 },
  ],
});
