// Client-safe barrel: types, pure helpers and the browser pipeline. Nothing server-only,
// and the heavy engines (Tesseract, zxing-wasm) stay behind dynamic imports.
export type { Candidate, Reason } from "./merge";
export { ImageError, type ImageErrorCode } from "./browser/image-prep";
export {
  identifyPhoto,
  type PhotoSignals,
  type Stage,
} from "./browser/pipeline";
export type { OcrLocale } from "./browser/ocr";
