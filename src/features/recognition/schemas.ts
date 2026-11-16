import { z } from "zod";

// What the browser may send to the server for an identification: a barcode and up to
// three short title lines. Never an image: the schemas are strict, so nothing else can
// ride along.

const gtin = z.string().regex(/^\d{13}$/);
const line = z.string().min(1).max(80);

export const identifyInputSchema = z
  .strictObject({
    gtin: gtin.optional(),
    lines: z.array(line).max(3).default([]),
  })
  .refine((v) => v.gtin !== undefined || v.lines.length > 0, {
    message: "empty",
  });
export type IdentifyInput = z.infer<typeof identifyInputSchema>;

export const learnBarcodeSchema = z.strictObject({
  gtin,
  gameId: z.uuid(),
});
