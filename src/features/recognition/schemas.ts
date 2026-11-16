import { z } from "zod";

// What the browser may send to the server for an identification: a barcode, up to three
// short title lines and a 64-bit image hash. Never the photo: the schemas are strict, so
// nothing else can ride along.

const gtin = z.string().regex(/^\d{13}$/);
const hash = z.string().regex(/^[0-9a-f]{16}$/);
const line = z.string().min(1).max(80);

export const identifyInputSchema = z
  .strictObject({
    gtin: gtin.optional(),
    lines: z.array(line).max(3).default([]),
    hash: hash.optional(),
  })
  .refine(
    (v) => v.gtin !== undefined || v.hash !== undefined || v.lines.length > 0,
    { message: "empty" },
  );
export type IdentifyInput = z.infer<typeof identifyInputSchema>;

export const learnBarcodeSchema = z.strictObject({
  gtin,
  gameId: z.uuid(),
});

export const savePhotoHashSchema = z.strictObject({
  gameId: z.uuid(),
  hash,
});
