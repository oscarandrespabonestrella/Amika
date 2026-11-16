import { describe, expect, it, vi } from "vitest";
import {
  createEmbedderClient,
  modelConfig,
  ModelLoadError,
  type WorkerLike,
} from "./model";
import type { FromWorker, ToWorker } from "./protocol";
import { EMBED_DIM } from "./thresholds";

const unit = (axis: number) => {
  const v = new Float32Array(EMBED_DIM);
  v[axis] = 1;
  return v;
};

/** A scripted worker: `reply` decides what each message gets back. */
class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = 0;
  private listeners: {
    message: ((e: { data: FromWorker }) => void)[];
    error: ((e: unknown) => void)[];
  } = { message: [], error: [] };
  constructor(
    private reply: (msg: ToWorker, emit: (m: FromWorker) => void) => void,
  ) {}
  postMessage(msg: ToWorker) {
    this.sent.push(msg);
    queueMicrotask(() => this.reply(msg, (m) => this.emit(m)));
  }
  terminate() {
    this.terminated++;
  }
  addEventListener(type: "message" | "error", l: never) {
    (this.listeners[type] as unknown[]).push(l);
  }
  emit(data: FromWorker) {
    for (const l of this.listeners.message) l({ data });
  }
  fail(error: unknown) {
    for (const l of this.listeners.error) l(error);
  }
}

const image = {
  data: new Uint8ClampedArray(16),
  width: 2,
  height: 2,
} as ImageData;

const happy = () =>
  new FakeWorker((msg, emit) => {
    if (msg.type === "init") {
      emit({ type: "progress", loaded: 40, total: 100 });
      emit({ type: "progress", loaded: 100, total: 100 });
      emit({ type: "ready" });
    } else emit({ type: "result", id: msg.id, vec: unit(3) });
  });

describe("modelConfig", () => {
  it("defaults to the same-origin /models/ directory", () => {
    expect(modelConfig(undefined)).toEqual({ base: "/models/" });
    expect(modelConfig("")).toEqual({ base: "/models/" });
  });

  it("accepts an https URL or an absolute path, normalizing the trailing slash", () => {
    expect(modelConfig("https://cdn.example.com/m")).toEqual({
      base: "https://cdn.example.com/m/",
    });
    expect(modelConfig("/assets/models/")).toEqual({ base: "/assets/models/" });
  });

  it("refuses anything else (javascript:, data:, http:, relative, garbage)", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/plain,hi",
      "http://insecure.example.com/m/",
      "models/",
      "//evil.example.com/m/",
      "not a url",
    ])
      expect(modelConfig(bad), bad).toEqual({ base: "/models/" });
  });
});

describe("createEmbedderClient", () => {
  it("initializes the worker with the base, relays progress and resolves when ready", async () => {
    const worker = happy();
    const progress: number[] = [];
    const embedder = await createEmbedderClient(worker, {
      base: "/models/",
      onProgress: (p) => progress.push(p.loaded / p.total),
    });
    expect(worker.sent[0]).toMatchObject({ type: "init", base: "/models/" });
    expect(progress).toEqual([0.4, 1]);
    expect(embedder).toHaveProperty("embed");
  });

  it("embeds an image and returns a normalized 512-vector", async () => {
    const embedder = await createEmbedderClient(happy(), { base: "/models/" });
    const vec = await embedder.embed(image);
    expect(vec).toHaveLength(EMBED_DIM);
    expect(Math.hypot(...vec)).toBeCloseTo(1, 5);
  });

  it("answers concurrent embeds with the matching ids", async () => {
    const worker = new FakeWorker((msg, emit) => {
      if (msg.type === "init") emit({ type: "ready" });
      else
        // reply out of order: the second request answers first
        setTimeout(
          () => emit({ type: "result", id: msg.id, vec: unit(msg.id) }),
          msg.id === 1 ? 20 : 1,
        );
    });
    const embedder = await createEmbedderClient(worker, { base: "/models/" });
    const [a, b] = await Promise.all([
      embedder.embed(image),
      embedder.embed(image),
    ]);
    expect(a[1]).toBe(1);
    expect(b[2]).toBe(1);
  });

  it("rejects the load with ModelLoadError when the worker reports a failure", async () => {
    const worker = new FakeWorker((msg, emit) => {
      if (msg.type === "init")
        emit({ type: "error", code: "load_failed", message: "404" });
    });
    await expect(
      createEmbedderClient(worker, { base: "/models/" }),
    ).rejects.toBeInstanceOf(ModelLoadError);
    expect(worker.terminated).toBe(1);
  });

  it("rejects the load when the worker itself crashes, and when it never answers (timeout)", async () => {
    const crashing = new FakeWorker(() => undefined);
    const p = createEmbedderClient(crashing, { base: "/models/" });
    queueMicrotask(() => crashing.fail(new Error("boom")));
    await expect(p).rejects.toBeInstanceOf(ModelLoadError);

    const silent = new FakeWorker(() => undefined);
    await expect(
      createEmbedderClient(silent, { base: "/models/", loadTimeoutMs: 20 }),
    ).rejects.toBeInstanceOf(ModelLoadError);
    expect(silent.terminated).toBe(1);
  });

  it("an embed that errors or times out rejects without breaking later embeds", async () => {
    let n = 0;
    const worker = new FakeWorker((msg, emit) => {
      if (msg.type === "init") return emit({ type: "ready" });
      n++;
      if (n === 1)
        emit({
          type: "error",
          id: msg.id,
          code: "embed_failed",
          message: "bad frame",
        });
      else if (n === 2)
        return; // never answers
      else emit({ type: "result", id: msg.id, vec: unit(5) });
    });
    const embedder = await createEmbedderClient(worker, {
      base: "/models/",
      embedTimeoutMs: 20,
    });
    await expect(embedder.embed(image)).rejects.toThrow();
    await expect(embedder.embed(image)).rejects.toThrow(/time/i);
    expect((await embedder.embed(image))[5]).toBe(1);
  });

  it("rejects a malformed vector (wrong length or NaN) instead of returning it", async () => {
    const worker = new FakeWorker((msg, emit) => {
      if (msg.type === "init") emit({ type: "ready" });
      else emit({ type: "result", id: msg.id, vec: new Float32Array(3) });
    });
    const embedder = await createEmbedderClient(worker, { base: "/models/" });
    await expect(embedder.embed(image)).rejects.toThrow();
  });

  it("dispose() terminates the worker and rejects pending embeds", async () => {
    const worker = new FakeWorker((msg, emit) => {
      if (msg.type === "init") emit({ type: "ready" });
    });
    const embedder = await createEmbedderClient(worker, { base: "/models/" });
    const pending = embedder.embed(image);
    embedder.dispose();
    await expect(pending).rejects.toThrow();
    expect(worker.terminated).toBe(1);
    await expect(embedder.embed(image)).rejects.toThrow();
    embedder.dispose(); // idempotent
    expect(worker.terminated).toBe(1);
  });

  it("ignores messages for unknown ids", async () => {
    const worker = happy();
    const embedder = await createEmbedderClient(worker, { base: "/models/" });
    worker.emit({ type: "result", id: 999, vec: unit(0) });
    expect(await embedder.embed(image)).toHaveLength(EMBED_DIM);
    expect(vi.isMockFunction(worker.postMessage)).toBe(false);
  });
});
