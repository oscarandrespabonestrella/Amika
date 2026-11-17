import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmbedder,
  installModel,
  isEnabled,
  MODEL_ID,
  modelStatus,
  ModelNotInstalledError,
  removeAllData,
  removeModel,
  setEnabled,
} from "./activation";
import { openReferenceStore } from "./reference-store";
import { EMBED_DIM } from "./thresholds";
import type { WorkerLike } from "./model";
import type { FromWorker, ToWorker } from "./protocol";

// --- fakes for localStorage and the Cache API -------------------------------------------
function fakeStorage(throwing = false) {
  const map = new Map<string, string>();
  const guard = () => {
    if (throwing) throw new Error("storage blocked");
  };
  return {
    getItem: (k: string) => (guard(), map.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void map.set(k, v)),
    removeItem: (k: string) => (guard(), void map.delete(k)),
  };
}

function fakeCaches(initial: string[] = []) {
  const urls = new Set(initial);
  const cache = {
    keys: async () => [...urls].map((url) => ({ url })),
    delete: async (req: { url: string } | string) =>
      urls.delete(typeof req === "string" ? req : req.url),
    put: async (url: string) => void urls.add(url),
  };
  return { urls, api: { open: vi.fn(async () => cache) } };
}

const ONNX = `https://app.example/models/${MODEL_ID}/onnx/vision_model_quantized.onnx`;
const CONFIG = `https://app.example/models/${MODEL_ID}/config.json`;

class FakeWorker implements WorkerLike {
  terminated = 0;
  private message: ((e: { data: FromWorker }) => void)[] = [];
  constructor(
    private script: (msg: ToWorker, emit: (m: FromWorker) => void) => void,
  ) {}
  postMessage(msg: ToWorker) {
    queueMicrotask(() =>
      this.script(msg, (data) => this.message.forEach((l) => l({ data }))),
    );
  }
  terminate() {
    this.terminated++;
  }
  addEventListener(type: "message" | "error", l: never) {
    if (type === "message") this.message.push(l);
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the enabled flag", () => {
  it("is off by default and remembers on / off", () => {
    expect(isEnabled()).toBe(false);
    setEnabled(true);
    expect(isEnabled()).toBe(true);
    setEnabled(false);
    expect(isEnabled()).toBe(false);
  });

  it("treats unavailable storage as off and never throws", () => {
    vi.stubGlobal("localStorage", fakeStorage(true));
    expect(isEnabled()).toBe(false);
    expect(() => setEnabled(true)).not.toThrow();
  });
});

describe("modelStatus", () => {
  it("is not-installed on a fresh device", async () => {
    vi.stubGlobal("caches", fakeCaches().api);
    expect(await modelStatus()).toBe("not-installed");
  });

  it("is installed only when the marker AND the cached model are both there", async () => {
    const c = fakeCaches([ONNX, CONFIG]);
    vi.stubGlobal("caches", c.api);
    // a marker is written by a completed install
    const worker = new FakeWorker(
      (m, emit) => m.type === "init" && emit({ type: "ready" }),
    );
    await installModel(() => undefined, undefined, {
      createWorker: () => worker,
    });
    expect(await modelStatus()).toBe("installed");

    // the browser evicted the cache: the marker is stale and gets cleared
    c.urls.clear();
    expect(await modelStatus()).toBe("not-installed");
    expect(localStorage.getItem("amika.recognition.model")).toBeNull();
  });

  it("without the Cache API (insecure context) it trusts the marker", async () => {
    vi.stubGlobal("caches", undefined);
    localStorage.setItem("amika.recognition.model", "1");
    expect(await modelStatus()).toBe("installed");
  });
});

describe("never downloads on its own", () => {
  it("createEmbedder refuses when the model is not installed, creating no worker", async () => {
    vi.stubGlobal("caches", fakeCaches().api);
    const createWorker = vi.fn();
    await expect(
      createEmbedder(undefined, { createWorker }),
    ).rejects.toBeInstanceOf(ModelNotInstalledError);
    expect(createWorker).not.toHaveBeenCalled();
  });
});

describe("installModel", () => {
  it("is the one path that loads the model: reports progress and marks it installed", async () => {
    const c = fakeCaches([ONNX]);
    vi.stubGlobal("caches", c.api);
    const worker = new FakeWorker((m, emit) => {
      if (m.type !== "init") return;
      emit({ type: "progress", loaded: 50, total: 100 });
      emit({ type: "progress", loaded: 100, total: 100 });
      emit({ type: "ready" });
    });
    const seen: number[] = [];
    await installModel((p) => seen.push(p.loaded), undefined, {
      createWorker: () => worker,
    });
    expect(seen).toEqual([50, 100]);
    expect(worker.terminated).toBe(1); // the install worker is released
    expect(await modelStatus()).toBe("installed");
  });

  it("a failed download leaves nothing installed and no partial cache entries", async () => {
    const c = fakeCaches([CONFIG]); // a partial file the failed load left behind
    vi.stubGlobal("caches", c.api);
    const worker = new FakeWorker((m, emit) => {
      if (m.type === "init")
        emit({ type: "error", code: "load_failed", message: "network" });
    });
    await expect(
      installModel(() => undefined, undefined, { createWorker: () => worker }),
    ).rejects.toThrow();
    expect(c.urls.size).toBe(0);
    expect(await modelStatus()).toBe("not-installed");
  });

  it("cancelling mid-download aborts, releases the worker and cleans the cache", async () => {
    const c = fakeCaches([CONFIG]);
    vi.stubGlobal("caches", c.api);
    const worker = new FakeWorker((m, emit) => {
      if (m.type === "init") emit({ type: "progress", loaded: 10, total: 100 });
      // never becomes ready
    });
    const ctl = new AbortController();
    const pending = installModel(() => undefined, ctl.signal, {
      createWorker: () => worker,
    });
    await new Promise((r) => setTimeout(r, 5));
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBeGreaterThanOrEqual(1);
    expect(c.urls.size).toBe(0);
    expect(await modelStatus()).toBe("not-installed");
  });

  it("an already-aborted signal does nothing at all", async () => {
    vi.stubGlobal("caches", fakeCaches().api);
    const createWorker = vi.fn();
    const ctl = new AbortController();
    ctl.abort();
    await expect(
      installModel(() => undefined, ctl.signal, { createWorker }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(createWorker).not.toHaveBeenCalled();
  });
});

describe("removeModel", () => {
  it("deletes the cached model files and the marker, and leaves other cache entries alone", async () => {
    const c = fakeCaches([ONNX, CONFIG, "https://app.example/other.js"]);
    vi.stubGlobal("caches", c.api);
    localStorage.setItem("amika.recognition.model", "1");
    await removeModel();
    expect([...c.urls]).toEqual(["https://app.example/other.js"]);
    expect(localStorage.getItem("amika.recognition.model")).toBeNull();
  });

  it("is safe without the Cache API or storage", async () => {
    vi.stubGlobal("caches", undefined);
    vi.stubGlobal("localStorage", fakeStorage(true));
    await expect(removeModel()).resolves.toBeUndefined();
  });
});

describe("removeAllData", () => {
  it("turns the feature off, deletes the model and empties the stored vectors", async () => {
    const c = fakeCaches([ONNX]);
    vi.stubGlobal("caches", c.api);
    const factory = new IDBFactory();
    const vec = new Float32Array(EMBED_DIM);
    vec[0] = 1;
    const store = await openReferenceStore(factory);
    await store.putCover("g1", "u1", vec);
    await store.addLearned("g1", vec); // derived from the user's own camera frames
    await store.putPack([{ gameId: "bgg:1", vec }], "v1");
    setEnabled(true);
    await removeAllData(factory);
    expect(isEnabled()).toBe(false);
    expect(c.urls.size).toBe(0);
    const after = await openReferenceStore(factory);
    expect(await after.all()).toEqual([]);
    expect(await after.packVersion()).toBeNull();
  });
});
