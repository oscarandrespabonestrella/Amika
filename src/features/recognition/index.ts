// Server-side barrel for routes. Client components import from "./client".
export {
  identifyGameAction,
  learnBarcodeAction,
  savePhotoHashAction,
  type IdentifyResult,
  type WriteActionResult,
} from "./actions/recognition-actions";
export { identifyGame, type IdentifyDeps } from "./identify";
export type { Candidate, Reason } from "./merge";
export { identifyInputSchema } from "./schemas";
