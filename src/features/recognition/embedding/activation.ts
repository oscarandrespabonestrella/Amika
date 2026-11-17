// The opt-in gate. Live recognition is OFF by default and per device: nothing is
// downloaded or loaded until the user explicitly enables it. `installModel` is the ONLY
// function that downloads the model; `createEmbedder` refuses to run when it is not
// installed, so no code path can start a download by accident.
import {
  createEmbedderClient,
  MODEL_BASE,
  spawnEmbedWorker,
  type Embedder,
  type Progress,
  type WorkerLike,
} from "./model";
import { openReferenceStore } from "./reference-store";

export const MODEL_ID = "clip-vit-base-patch32";
/** Shown to the user before the download starts. */
export const MODEL_DOWNLOAD_MB = 85;

const FLAG_KEY = "amika.recognition.enabled";
const MARKER_KEY = "amika.recognition.model";
const MODEL_VERSION = "1";
/** The cache Transformers.js writes model files to in the browser. */
const CACHE_NAME = "transformers-cache";
const ONNX_FILE = `/${MODEL_ID}/onnx/vision_model_quantized.onnx`;

export class ModelNotInstalledError extends Error {
  constructor() {
    super("the recognition model is not installed on this device");
    this.name = "ModelNotInstalledError";
  }
}

type Deps = { createWorker?: () => WorkerLike };

const abortError = () => new DOMException("Aborted", "AbortError");

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: the flag simply stays off
  }
}

/** The per-device "enabled" flag. Off by default; unavailable storage means off. */
export function isEnabled(): boolean {
  return readStorage(FLAG_KEY) === "1";
}
export function setEnabled(on: boolean): void {
  writeStorage(FLAG_KEY, on ? "1" : null);
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * "installed" only when the install marker AND the cached model are both present. A stale
 * marker (the browser evicted the cache) is cleared.
 */
export async function modelStatus(): Promise<"installed" | "not-installed"> {
  if (readStorage(MARKER_KEY) !== MODEL_VERSION) return "not-installed";
  const cache = await openCache();
  if (!cache) return "installed"; // insecure context: trust the marker
  const keys = await cache.keys();
  if (keys.some((request) => request.url.includes(ONNX_FILE)))
    return "installed";
  writeStorage(MARKER_KEY, null);
  return "not-installed";
}

/** Deletes the downloaded model (and the marker), freeing the space. */
export async function removeModel(): Promise<void> {
  writeStorage(MARKER_KEY, null);
  const cache = await openCache();
  if (!cache) return;
  for (const request of await cache.keys())
    if (request.url.includes(`/${MODEL_ID}/`)) await cache.delete(request);
}

/**
 * "Disable and delete data": turns the feature off and frees everything it left on this
 * device: the model (Cache API) and the stored vectors (IndexedDB), including the ones
 * learned from the user's own camera frames.
 */
export async function removeAllData(factory?: IDBFactory): Promise<void> {
  setEnabled(false);
  await removeModel();
  try {
    await (await openReferenceStore(factory)).clear();
  } catch {
    // nothing stored, or storage unavailable: nothing to free
  }
}

/**
 * Downloads and loads the model once (the user confirmed the size warning). All or
 * nothing: on cancel or failure the partial cache entries are deleted and the model stays
 * "not installed".
 */
export async function installModel(
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
  deps: Deps = {},
): Promise<void> {
  if (signal?.aborted) throw abortError();
  const worker = (deps.createWorker ?? spawnEmbedWorker)();

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      worker.terminate();
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

  try {
    const embedder = await Promise.race([
      createEmbedderClient(worker, { base: MODEL_BASE, onProgress }),
      aborted,
    ]);
    embedder.dispose(); // the install worker is released; scanning spawns its own
    writeStorage(MARKER_KEY, MODEL_VERSION);
  } catch (error) {
    worker.terminate();
    await removeModel();
    throw error;
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

/** A running embedder. Refuses (never downloads) when the model is not installed. */
export async function createEmbedder(
  onProgress?: (p: Progress) => void,
  deps: Deps = {},
): Promise<Embedder> {
  if ((await modelStatus()) !== "installed") throw new ModelNotInstalledError();
  return createEmbedderClient((deps.createWorker ?? spawnEmbedWorker)(), {
    base: MODEL_BASE,
    onProgress,
  });
}
