// Public API of the scoring module.
export { evaluate } from "./engine/evaluate";
export type {
  CategoryResult,
  Evaluation,
  FieldErrorCode,
  ScoreValue,
} from "./engine/evaluate";
export { SCORE_LIMITS } from "./engine/definition";
export type { Category, CategoryType, Definition } from "./engine/definition";
export { validateDefinition } from "./engine/validate";
export type { DefinitionIssue } from "./engine/validate";
export {
  getSheet,
  listSheetsForGame,
  type SheetDetail,
  type SheetSummary,
} from "./services/sheet-service";
export { SheetsLink } from "./components/sheets-link";
export { SheetsList } from "./components/sheets-list";
