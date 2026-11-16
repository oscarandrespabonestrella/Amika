// Types only: the messages between the page and the embedding worker.
import type { Vec } from "./rank";

export type ToWorker =
  | { type: "init"; base: string; modelId: string }
  | {
      type: "embed";
      id: number;
      image: { data: Uint8ClampedArray; width: number; height: number };
    };

export type FromWorker =
  | { type: "ready" }
  | { type: "progress"; loaded: number; total: number }
  | { type: "result"; id: number; vec: Vec | Float32Array }
  | {
      type: "error";
      id?: number;
      code: "load_failed" | "embed_failed";
      message: string;
    };
