import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";
import { cosine, normalize } from "./rank";
import { EMBED_DIM } from "./thresholds";

const MODELS = join(process.cwd(), "public", "models");
const ONNX = join(
  MODELS,
  "clip-vit-base-patch32",
  "onnx",
  "vision_model_quantized.onnx",
);

/** Diagonal colour stripes: structurally nothing like the blocky picture. */
async function stripes(size = 320) {
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const band = Math.floor((x + y) / 24) % 3;
      const o = (y * size + x) * 3;
      raw[o] = band === 0 ? 240 : 20;
      raw[o + 1] = band === 1 ? 240 : 20;
      raw[o + 2] = band === 2 ? 240 : 20;
    }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } });
}

/** A blocky, textured picture; `seed` makes a different picture. */
async function picture(seed: number, size = 320) {
  const raw = Buffer.alloc(size * size * 3);
  let s = seed;
  const block = 40;
  const cols = Math.ceil(size / block);
  const tones = Array.from({ length: cols * cols * 3 }, () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return 20 + (s % 220);
  });
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const cell = (Math.floor(y / block) * cols + Math.floor(x / block)) * 3;
      const o = (y * size + x) * 3;
      raw[o] = tones[cell];
      raw[o + 1] = tones[cell + 1];
      raw[o + 2] = tones[cell + 2];
    }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } });
}

// Runs only where scripts/copy-model-assets.mjs has put the model in public/models.
describe.skipIf(!existsSync(ONNX))(
  "CLIP (the model the browser worker loads), in Node",
  () => {
    it(
      "gives unit 512-vectors; the same picture re-encoded is far closer than a different one",
      { timeout: 180_000 },
      async () => {
        const { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } =
          await import("@huggingface/transformers");
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = MODELS + "/";
        const processor = await AutoProcessor.from_pretrained(
          "clip-vit-base-patch32",
        );
        const model = await CLIPVisionModelWithProjection.from_pretrained(
          "clip-vit-base-patch32",
          { dtype: "q8" },
        );

        const embed = async (img: Sharp) => {
          const { data, info } = await img
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          const raw = new RawImage(
            new Uint8ClampedArray(data),
            info.width,
            info.height,
            3,
          );
          const { image_embeds } = await model(await processor(raw));
          return normalize(Array.from(image_embeds.data as ArrayLike<number>));
        };

        const a = await embed(await picture(1));
        const aAgain = await embed(
          (await picture(1)).resize(200, 200).jpeg({ quality: 70 }),
        );
        const b = await embed(await stripes());

        expect(a).toHaveLength(EMBED_DIM);
        expect(Math.hypot(...a)).toBeCloseTo(1, 4);
        expect(cosine(a, a)).toBeCloseTo(1, 4);
        expect(cosine(a, aAgain)).toBeGreaterThan(cosine(a, b) + 0.1);
      },
    );
  },
);
