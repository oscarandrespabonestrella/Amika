import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: () => () => undefined,
}));
vi.mock("next-intl/middleware", () => ({ default: () => () => undefined }));

import { config } from "@/proxy";

// The i18n proxy would redirect any other path to /<locale>/... (a 404 for a static file).
describe("proxy matcher", () => {
  const pageMatcher = new RegExp(`^${config.matcher[0]}$`);

  it("leaves the self-hosted engines and the reference pack alone", () => {
    for (const path of [
      "/models/clip-vit-base-patch32/onnx/vision_model_quantized.onnx",
      "/ort/ort-wasm-simd-threaded.wasm",
      "/opencv/opencv.js",
      "/zxing/zxing_reader.wasm",
      "/reference-pack/vectors-0123abcd.bin",
    ])
      expect(pageMatcher.test(path), path).toBe(false);
  });

  it("still handles app pages", () => {
    for (const path of ["/en/games", "/", "/es/settings"])
      expect(pageMatcher.test(path), path).toBe(true);
  });
});
