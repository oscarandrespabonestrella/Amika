"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  identifyGameAction,
  learnBarcodeAction,
  listRecognitionGamesAction,
} from "../actions/recognition-actions";
import { readBarcode } from "../browser/barcode";
import { prepareImage } from "../browser/image-prep";
import { buildReferences } from "../embedding/build-references";
import {
  createEmbedder,
  ModelNotInstalledError,
} from "../embedding/activation";
import { ModelLoadError, type Embedder } from "../embedding/model";
import {
  openReferenceStore,
  type ReferenceStore,
} from "../embedding/reference-store";
import type { Decision } from "../embedding/resolve";
import type { Vec } from "../embedding/rank";
import { loadOpenCv, verifyOrb } from "../verify/orb";
import { fetchCoverFrame, grabFrame } from "./frames";
import { createSession, type Frame, type Update } from "./session";

export type LiveError =
  | "insecure"
  | "no_camera"
  | "denied"
  | "no_wasm"
  | "not_installed"
  | "model_failed"
  | "failed";

export type Answer = Decision & { name: string };

export type LiveState = {
  phase: "idle" | "starting" | "scanning";
  stage: "camera" | "model" | "references" | "scanning" | "photo" | null;
  progress: { done: number; total: number } | null;
  answer: Answer | null;
  alternatives: { gameId: string; name: string; similarity: number }[];
  frameMs: number | null;
  /** Nothing recognized for a while: suggest getting closer. */
  hint: boolean;
  /** An unknown barcode in view (it can be taught when the user confirms a game). */
  gtin: string | null;
  error: LiveError | null;
  /** The session stopped on its own after a long time without an answer. */
  idleTimeout: boolean;
  noGames: boolean;
};

const INITIAL: LiveState = {
  phase: "idle",
  stage: null,
  progress: null,
  answer: null,
  alternatives: [],
  frameMs: null,
  hint: false,
  gtin: null,
  error: null,
  idleTimeout: false,
  noGames: false,
};

const FRAME_EVERY_MS = 500;
const HINT_AFTER_MS = 10_000;
const AUTO_STOP_AFTER_MS = 90_000;
const MAX_CONSECUTIVE_FAILURES = 3;

/** Owns the camera, the model worker, the references and the loop. Stops everything on exit. */
export function useLiveRecognition() {
  const [state, setState] = useState<LiveState>(INITIAL);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const embedderRef = useRef<Embedder | null>(null);
  const storeRef = useRef<ReferenceStore | null>(null);
  const sessionRef = useRef<ReturnType<typeof createSession> | null>(null);
  const namesRef = useRef(new Map<string, string>());
  const coversRef = useRef(new Map<string, Frame>());
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef(0); // bumped on every stop: a stale loop notices and ends
  const lastVecRef = useRef<Vec | null>(null);
  const gtinRef = useRef<string | null>(null);

  const release = useCallback(() => {
    runRef.current++;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    embedderRef.current?.dispose();
    embedderRef.current = null;
    sessionRef.current = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setState((s) => ({ ...INITIAL, idleTimeout: s.idleTimeout }));
  }, [release]);

  // Leaving the page, or hiding the tab, always releases the camera and the worker.
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      release();
    };
  }, [release, stop]);

  const fail = useCallback(
    (error: LiveError) => {
      release();
      setState({ ...INITIAL, error });
    },
    [release],
  );

  /** Loads the model, the references and the session (shared by the camera and a photo). */
  const ensureEngine = useCallback(
    async (run: number) => {
      if (sessionRef.current) return sessionRef.current;
      setState((s) => ({ ...s, stage: "model" }));
      let embedder: Embedder;
      try {
        embedder = await createEmbedder();
      } catch (error) {
        if (run === runRef.current)
          fail(
            error instanceof ModelNotInstalledError
              ? "not_installed"
              : "model_failed",
          );
        throw error;
      }
      if (run !== runRef.current) {
        embedder.dispose();
        throw new Error("stopped");
      }
      embedderRef.current = embedder;

      setState((s) => ({
        ...s,
        stage: "references",
        progress: { done: 0, total: 0 },
      }));
      const listed = await listRecognitionGamesAction();
      const games = listed.ok ? listed.games : [];
      namesRef.current = new Map(games.map((g) => [g.id, g.name]));
      const store = (storeRef.current ??= await openReferenceStore());
      abortRef.current = new AbortController();
      await buildReferences({
        games: games.map((g) => ({ id: g.id, coverUrl: g.coverUrl })),
        store,
        embedCover: async (id) =>
          embedder.embed((await fetchCoverFrame(id)) as ImageData),
        onProgress: (done, total) =>
          setState((s) => ({ ...s, progress: { done, total } })),
        signal: abortRef.current.signal,
        // a failed or capped listing must never delete stored (incl. learned) vectors
        purge: listed.ok && listed.complete,
      });
      if (run !== runRef.current) throw new Error("stopped");

      const refs = await store.all();
      setState((s) => ({ ...s, noGames: refs.length === 0 }));
      const session = createSession({
        embed: (frame) => embedder.embed(frame as ImageData),
        readBarcode: async () =>
          canvasRef.current ? readBarcode(canvasRef.current) : null,
        lookupBarcode: async (gtin) => {
          const result = await identifyGameAction({ gtin });
          if (!result.ok) return null;
          return (
            result.candidates.find((c) => c.reasons.includes("code"))?.gameId ??
            null
          );
        },
        verify: async (frame, gameId) => {
          const cv = await loadOpenCv();
          let cover = coversRef.current.get(gameId);
          if (!cover) {
            cover = await fetchCoverFrame(gameId);
            coversRef.current.set(gameId, cover);
          }
          return verifyOrb(cv, frame, cover);
        },
        now: () => Date.now(),
      });
      session.setReferences(refs);
      sessionRef.current = session;
      return session;
    },
    [fail],
  );

  const show = useCallback((u: Update, frameMs: number | null) => {
    lastVecRef.current = u.vec;
    gtinRef.current = u.gtin;
    const names = namesRef.current;
    const answer = u.decision
      ? { ...u.decision, name: names.get(u.decision.gameId) ?? "" }
      : null;
    setState((s) => ({
      ...s,
      answer,
      gtin: u.gtin,
      frameMs: frameMs ?? s.frameMs,
      alternatives: u.candidates
        .filter((c) => c.gameId !== answer?.gameId)
        .slice(0, 2)
        .map((c) => ({
          gameId: c.gameId,
          name: names.get(c.gameId) ?? "",
          similarity: c.similarity,
        })),
    }));
  }, []);

  const start = useCallback(async () => {
    release();
    const run = ++runRef.current;
    setState({ ...INITIAL, phase: "starting", stage: "camera" });

    if (typeof WebAssembly !== "object") return fail("no_wasm");
    if (!window.isSecureContext && location.hostname !== "localhost")
      return fail("insecure");
    if (!navigator.mediaDevices?.getUserMedia) return fail("no_camera");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (error) {
      const name = (error as { name?: string }).name;
      return fail(
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : name === "NotFoundError" ||
              name === "OverconstrainedError" ||
              name === "NotReadableError"
            ? "no_camera"
            : "failed",
      );
    }
    if (run !== runRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      await video.play().catch(() => undefined);
    }

    let session: ReturnType<typeof createSession>;
    try {
      session = await ensureEngine(run);
    } catch (error) {
      if (
        run === runRef.current &&
        !(error instanceof ModelNotInstalledError) &&
        !(error instanceof ModelLoadError)
      )
        fail("failed");
      return;
    }
    if (run !== runRef.current) return;

    const scanStartedAt = Date.now();
    let lastAnswerAt = scanStartedAt;
    let failures = 0;
    setState((s) => ({
      ...s,
      phase: "scanning",
      stage: "scanning",
      progress: null,
    }));

    const loop = async () => {
      if (run !== runRef.current) return;
      const began = performance.now();
      const frame =
        videoRef.current && canvasRef.current && !document.hidden
          ? grabFrame(videoRef.current, canvasRef.current)
          : null;
      if (frame) {
        try {
          const update = await session.tick(frame);
          failures = 0;
          if (run !== runRef.current) return;
          if (update.decision) lastAnswerAt = Date.now();
          show(update, Math.round(performance.now() - began));
          const idleFor = Date.now() - lastAnswerAt;
          setState((s) => ({
            ...s,
            hint: !update.decision && idleFor > HINT_AFTER_MS,
          }));
          if (idleFor > AUTO_STOP_AFTER_MS) {
            release();
            setState({ ...INITIAL, idleTimeout: true });
            return;
          }
        } catch {
          if (++failures >= MAX_CONSECUTIVE_FAILURES) return fail("failed");
        }
      }
      if (run !== runRef.current) return;
      timerRef.current = setTimeout(
        loop,
        Math.max(0, FRAME_EVERY_MS - (performance.now() - began)),
      );
    };
    void loop();
  }, [ensureEngine, fail, release, show]);

  /** "This is it": remember this frame for the game and, if a barcode is in view, teach it. */
  const confirm = useCallback(async (gameId: string) => {
    const vec = lastVecRef.current;
    if (vec && storeRef.current)
      await storeRef.current.addLearned(gameId, vec).catch(() => undefined);
    const gtin = gtinRef.current;
    if (gtin) await learnBarcodeAction({ gtin, gameId }).catch(() => undefined);
  }, []);

  /** "Not this one": never answer this game again in this session. */
  const reject = useCallback((gameId: string) => {
    sessionRef.current?.exclude(gameId);
    setState((s) => ({ ...s, answer: null }));
  }, []);

  /** One photo from the gallery, with the same engine. */
  const analyzePhoto = useCallback(
    async (file: File) => {
      release();
      const run = ++runRef.current;
      setState({ ...INITIAL, phase: "starting", stage: "photo" });
      if (typeof WebAssembly !== "object") return fail("no_wasm");
      try {
        const session = await ensureEngine(run);
        const { canvas, width, height } = await prepareImage(file);
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const { data } = ctx.getImageData(0, 0, width, height);
        const update = await session.analyze({ data, width, height });
        if (run !== runRef.current) return;
        show(update, null);
        setState((s) => ({ ...s, phase: "idle", stage: null, progress: null }));
      } catch {
        if (run === runRef.current) {
          setState((s) => (s.error ? s : { ...INITIAL, error: "failed" }));
        }
      }
    },
    [ensureEngine, fail, release, show],
  );

  return {
    state,
    videoRef,
    canvasRef,
    start,
    stop,
    confirm,
    reject,
    analyzePhoto,
  };
}
