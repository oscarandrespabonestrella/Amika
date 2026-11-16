// Pure: maps a Postgres error code from the recognition tables/functions to the stable
// code the UI translates. Null means "unexpected": the caller logs and answers "failed".

export type RecognitionError = "limit" | "not_found" | "invalid";

export function mapRecognitionError(
  code: string | undefined,
): RecognitionError | null {
  switch (code) {
    case "P0001": // a cap (500 barcodes / 20 photo hashes per game)
      return "limit";
    case "42501": // RLS said no (not your game, or not visible)
    case "23503": // missing parent
    case "P0002": // no such game
      return "not_found";
    case "22023": // malformed hash
    case "23514": // CHECK (malformed barcode)
      return "invalid";
    default:
      return null;
  }
}
