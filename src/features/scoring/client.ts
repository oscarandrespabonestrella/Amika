// Client-safe exports of the scoring module: pure code and client components only.
// (The main index also exports server-only services, which a client component
// must not import.)
export { evaluate } from "./engine/evaluate";
export type { FieldErrorCode, ScoreValue } from "./engine/evaluate";
export type { Definition } from "./engine/definition";
export { CategoryInput } from "./components/category-input";
export { IntField } from "./components/int-field";
export { ScoreFields } from "./components/score-fields";
export { pickDefaultSheet } from "./ranking";
export type { RankedSheet } from "./ranking";
