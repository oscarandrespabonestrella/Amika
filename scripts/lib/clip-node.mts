// Shared by the recognition scripts (evaluation, reference-pack generator): the SAME
// CLIP ViT-B/32 (quantized) and the SAME image preparation as the browser worker, run in
// Node. Vectors made here are compatible with the ones the phone makes.
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { normalize } from "../../src/features/recognition/embedding/rank.ts";
import { type RgbaImage } from "../../src/features/recognition/verify/orb.ts";

export const MODELS = join(process.cwd(), "public", "models");
/** The browser sends camera frames of about this size. */
export const FRAME_SIDE = 1280;

export type Embed = (image: RgbaImage) => Promise<Float32Array>;

export async function loadEmbedder(): Promise<Embed> {
  if (
    !existsSync(
      join(
        MODELS,
        "clip-vit-base-patch32",
        "onnx",
        "vision_model_quantized.onnx",
      ),
    )
  )
    throw new Error("model missing: run node scripts/copy-model-assets.mjs");
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
  return async (image: RgbaImage) => {
    const raw = new RawImage(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height,
      4,
    ).rgb();
    const { image_embeds } = await model(await processor(raw));
    return normalize(Array.from(image_embeds.data as ArrayLike<number>));
  };
}

/** Decoded RGBA at the size the browser would send (EXIF applied, long side <= `side`). */
export async function decode(
  input: Buffer | Uint8Array,
  side = FRAME_SIDE,
): Promise<RgbaImage> {
  const { data, info } = await sharp(Buffer.from(input))
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: side,
      height: side,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  };
}
