/// <reference lib="webworker" />
// Runs CLIP ViT-B/32 (quantized ONNX, Transformers.js + ONNX Runtime Web, single thread)
// in a Web Worker so scanning never blocks the page. Everything is self-hosted: the model
// from our own base URL, the .wasm engine from /ort/. Remote models are disabled, so this
// can never reach Hugging Face or a CDN.
import type { FromWorker, ToWorker } from "./protocol";

type Pipeline = {
  embed(image: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }): Promise<Float32Array>;
};

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};
const post = (message: FromWorker, transfer?: Transferable[]) =>
  scope.postMessage(message, transfer);

let pipeline: Pipeline | null = null;

/** Sums the progress of every file being downloaded into one number for the progress bar. */
function progressReporter() {
  const files = new Map<string, { loaded: number; total: number }>();
  return (event: unknown) => {
    const e = event as {
      status?: string;
      file?: string;
      loaded?: number;
      total?: number;
    };
    if (e.status !== "progress" || !e.file) return;
    files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: "progress", loaded, total });
  };
}

async function load(base: string, modelId: string): Promise<Pipeline> {
  const { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } =
    await import("@huggingface/transformers");
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = base;
  env.useBrowserCache = true;
  // The plain CPU build (14 MB) instead of the asyncify/jsep ones (27-28 MB): we never use WebGPU.
  env.backends.onnx.wasm!.wasmPaths = {
    mjs: "/ort/ort-wasm-simd-threaded.mjs",
    wasm: "/ort/ort-wasm-simd-threaded.wasm",
  };
  env.backends.onnx.wasm!.numThreads = 1; // no cross-origin isolation: one thread

  const progress_callback = progressReporter();
  const processor = await AutoProcessor.from_pretrained(modelId, {
    progress_callback,
  });
  const model = await CLIPVisionModelWithProjection.from_pretrained(modelId, {
    dtype: "q8",
    progress_callback,
  });

  return {
    async embed(image) {
      const raw = new RawImage(image.data, image.width, image.height, 4).rgb();
      const { image_embeds } = await model(await processor(raw));
      return Float32Array.from(image_embeds.data as ArrayLike<number>);
    },
  };
}

scope.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      pipeline = await load(message.base, message.modelId);
      post({ type: "ready" });
    } catch (error) {
      post({
        type: "error",
        code: "load_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (message.type === "embed") {
    if (!pipeline)
      return post({
        type: "error",
        id: message.id,
        code: "embed_failed",
        message: "the model is not loaded",
      });
    try {
      const vec = await pipeline.embed(message.image);
      post({ type: "result", id: message.id, vec }, [vec.buffer]);
    } catch (error) {
      post({
        type: "error",
        id: message.id,
        code: "embed_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
