// Browser-side client of the embedding worker (CLIP image embeddings). The heavy model
// lives in embed.worker.ts; this module only speaks the small message protocol, so it is
// fully testable with a fake worker. It never decides to download anything: that is
// activation.ts (the opt-in gate).
import type { FromWorker, ToWorker } from "./protocol";
import { normalize, type Vec } from "./rank";

export type WorkerLike = {
  postMessage(msg: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(
    type: "message",
    listener: (event: { data: FromWorker }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
};

export type Progress = { loaded: number; total: number };

export type Embedder = {
  embed(image: ImageData): Promise<Vec>;
  dispose(): void;
};

export class ModelLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelLoadError";
  }
}

const DEFAULT_BASE = "/models/";

/**
 * Where the model files are served from: same-origin `/models/` by default, or
 * `NEXT_PUBLIC_MODEL_BASE_URL` (an https URL or an absolute path). Anything else falls
 * back to the default: a model location is never taken from untrusted input.
 */
export function modelConfig(override: string | undefined): { base: string } {
  const value = override?.trim();
  if (!value) return { base: DEFAULT_BASE };
  if (value.startsWith("/") && !value.startsWith("//"))
    return { base: value.endsWith("/") ? value : `${value}/` };
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password)
      return { base: value.endsWith("/") ? value : `${value}/` };
  } catch {
    // not a URL
  }
  return { base: DEFAULT_BASE };
}

/** The configured base for this build. */
export const MODEL_BASE = modelConfig(
  process.env.NEXT_PUBLIC_MODEL_BASE_URL,
).base;

/** The real worker (a module worker, bundled by Next). Only called in the browser. */
export function spawnEmbedWorker(): WorkerLike {
  return new Worker(new URL("./embed.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;
}

type Pending = {
  resolve(vec: Vec): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Initializes the worker (loading the model: this is where a first download happens when
 * the caller allowed it) and resolves with an embedder once it reports ready. The worker
 * is terminated on every failure path.
 */
export function createEmbedderClient(
  worker: WorkerLike,
  opts: {
    base: string;
    modelId?: string;
    onProgress?: (p: Progress) => void;
    loadTimeoutMs?: number;
    embedTimeoutMs?: number;
  },
): Promise<Embedder> {
  const embedTimeoutMs = opts.embedTimeoutMs ?? 30_000;
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let disposed = false;
  let onReady: (() => void) | undefined;
  let onLoadError: ((error: Error) => void) | undefined;

  const failAll = (error: Error) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    worker.terminate();
    failAll(new Error("embedder disposed"));
  };

  worker.addEventListener("message", ({ data }) => {
    switch (data.type) {
      case "progress":
        opts.onProgress?.({ loaded: data.loaded, total: data.total });
        break;
      case "ready":
        onReady?.();
        break;
      case "result": {
        const p = pending.get(data.id);
        if (!p) break; // unknown or already timed out
        pending.delete(data.id);
        clearTimeout(p.timer);
        try {
          p.resolve(normalize(data.vec));
        } catch (error) {
          p.reject(error as Error);
        }
        break;
      }
      case "error": {
        if (data.id === undefined) {
          onLoadError?.(new ModelLoadError(data.message));
          break;
        }
        const p = pending.get(data.id);
        if (!p) break;
        pending.delete(data.id);
        clearTimeout(p.timer);
        p.reject(new Error(data.message));
        break;
      }
    }
  });

  return new Promise<Embedder>((resolve, reject) => {
    const loadTimer = setTimeout(
      () => fail(new ModelLoadError("the model took too long to load")),
      opts.loadTimeoutMs ?? 15 * 60_000,
    );
    const fail = (error: Error) => {
      clearTimeout(loadTimer);
      onReady = onLoadError = undefined;
      dispose();
      reject(error);
    };
    onLoadError = fail;
    worker.addEventListener("error", (event) => {
      const message =
        event instanceof Error ? event.message : "the worker crashed";
      if (onLoadError) fail(new ModelLoadError(message));
      else failAll(new Error(message));
    });
    onReady = () => {
      clearTimeout(loadTimer);
      onReady = onLoadError = undefined;
      resolve({
        embed(image) {
          if (disposed) return Promise.reject(new Error("embedder disposed"));
          const id = nextId++;
          return new Promise<Vec>((res, rej) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error("the frame took too long to process (time out)"));
            }, embedTimeoutMs);
            pending.set(id, { resolve: res, reject: rej, timer });
            const data = new Uint8ClampedArray(image.data);
            worker.postMessage(
              {
                type: "embed",
                id,
                image: { data, width: image.width, height: image.height },
              },
              [data.buffer],
            );
          });
        },
        dispose,
      });
    };
    worker.postMessage({
      type: "init",
      base: opts.base,
      modelId: opts.modelId ?? "clip-vit-base-patch32",
    });
  });
}
