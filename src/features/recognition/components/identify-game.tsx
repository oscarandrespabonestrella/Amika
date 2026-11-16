"use client";

import { Camera, ImageIcon, Loader2, ScanSearch } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { importGameAction } from "@/features/catalog/actions/catalog-actions";
import { Link, useRouter } from "@/i18n/navigation";
import {
  identifyGameAction,
  learnBarcodeAction,
  savePhotoHashAction,
} from "../actions/recognition-actions";
import {
  ImageError,
  identifyPhoto,
  type Candidate,
  type OcrLocale,
  type PhotoSignals,
  type Stage,
} from "../client";

type View =
  | { kind: "idle" }
  | { kind: "working"; stage: Stage | "search" }
  | {
      kind: "results";
      signals: PhotoSignals;
      candidates: Candidate[];
      bggLimited: boolean;
    }
  | { kind: "error"; code: string };

const LOCALES = new Set(["en", "es", "fr"]);

/** One word for how much to trust a score. Never "certain": the user always confirms. */
function level(score: number): "high" | "medium" | "low" {
  return score >= 0.8 ? "high" : score >= 0.5 ? "medium" : "low";
}

/**
 * "Identify a game by photo". Everything is computed in the browser; only a barcode, up to
 * three title lines and a small image fingerprint are sent to find candidates.
 */
export function IdentifyGame() {
  const t = useTranslations("Recognition");
  const tGames = useTranslations("Games");
  const locale = useLocale();
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "idle" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Leaving the page cancels any work in progress (and terminates the OCR worker).
  useEffect(() => () => abortRef.current?.abort(), []);

  const working = view.kind === "working";
  const ocrLocale: OcrLocale = LOCALES.has(locale)
    ? (locale as OcrLocale)
    : "en";

  async function run(file: File) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setConfirmError(null);
    setView({ kind: "working", stage: "prepare" });
    try {
      const signals = await identifyPhoto(file, {
        locale: ocrLocale,
        signal: controller.signal,
        onStage: (stage) => setView({ kind: "working", stage }),
      });
      setView({ kind: "working", stage: "search" });
      const result = await identifyGameAction({
        ...(signals.gtin ? { gtin: signals.gtin } : {}),
        lines: signals.lines,
        hash: signals.hash,
      });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setView({ kind: "error", code: result.error });
        return;
      }
      setView({
        kind: "results",
        signals,
        candidates: result.candidates,
        bggLimited: result.bggLimited,
      });
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        setView({ kind: "idle" });
        return;
      }
      setView({
        kind: "error",
        code: error instanceof ImageError ? error.code : "failed",
      });
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setView({ kind: "idle" });
  }

  async function confirm(candidate: Candidate, signals: PhotoSignals) {
    const key = candidate.gameId ?? candidate.externalId ?? candidate.name;
    setConfirming(key);
    setConfirmError(null);
    let gameId = candidate.gameId;
    if (!gameId) {
      if (!candidate.externalId) return setConfirming(null);
      const imported = await importGameAction(candidate.externalId);
      if (!imported.ok) {
        setConfirmError(imported.error);
        setConfirming(null);
        return;
      }
      gameId = imported.gameId;
    }
    // Teach the app: best effort, it never blocks opening the game.
    const learn: Promise<unknown>[] = [
      savePhotoHashAction({ gameId, hash: signals.hash }),
    ];
    if (signals.gtin)
      learn.push(learnBarcodeAction({ gtin: signals.gtin, gameId }));
    await Promise.allSettled(learn);
    router.push(`/games/${gameId}`);
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again must work
    if (file) void run(file);
  }

  return (
    <section
      aria-labelledby="identify-title"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="identify-title"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <ScanSearch className="size-5 text-primary" aria-hidden />
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <p className="text-sm text-muted-foreground">{t("privacy")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="lg"
          className="h-11"
          disabled={working}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera aria-hidden />
          {t("take")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11"
          disabled={working}
          onClick={() => galleryRef.current?.click()}
        >
          <ImageIcon aria-hidden />
          {t("choose")}
        </Button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={onFile}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onFile}
        />
      </div>

      {view.kind === "working" && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <span>{t(`stage.${view.stage}`)}</span>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={cancel}
          >
            {t("cancel")}
          </Button>
        </div>
      )}

      {view.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${view.code}` as never)}
        </p>
      )}

      {view.kind === "results" && (
        <Results
          view={view}
          confirming={confirming}
          confirmError={
            confirmError ? tGames(`errors.${confirmError}` as never) : null
          }
          onConfirm={(c) => confirm(c, view.signals)}
        />
      )}
    </section>
  );
}

function Results({
  view,
  confirming,
  confirmError,
  onConfirm,
}: {
  view: Extract<View, { kind: "results" }>;
  confirming: string | null;
  confirmError: string | null;
  onConfirm: (candidate: Candidate) => void;
}) {
  const t = useTranslations("Recognition");
  const { candidates, signals, bggLimited } = view;
  const query = signals.lines[0];
  const manualHref = `/games${query ? `?q=${encodeURIComponent(query)}` : ""}`;

  return (
    <div className="flex flex-col gap-3">
      {candidates.length > 0 ? (
        <>
          <h3 className="text-sm font-medium">{t("results.title")}</h3>
          <ol aria-label={t("results.list")} className="flex flex-col gap-2">
            {candidates.map((c) => {
              const key = c.gameId ?? c.externalId ?? c.name;
              return (
                <li
                  key={key}
                  data-game-id={c.gameId ?? undefined}
                  className="flex flex-col gap-2 rounded-xl border border-border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="break-words">{c.name}</strong>
                    {c.reasons.map((r) => (
                      <Badge key={r} variant="secondary">
                        {t(`reasons.${r}`)}
                      </Badge>
                    ))}
                    <span className="text-sm text-muted-foreground">
                      {t(`confidence.${level(c.score)}`)}
                    </span>
                  </div>
                  {!c.gameId && (
                    <p className="text-xs text-muted-foreground">
                      {t("fromBgg")}
                    </p>
                  )}
                  <Button
                    type="button"
                    className="h-11 self-start"
                    disabled={confirming !== null}
                    aria-label={t("confirmFor", { name: c.name })}
                    onClick={() => onConfirm(c)}
                  >
                    {confirming === key ? (
                      <>
                        <Loader2 className="animate-spin" aria-hidden />
                        {t("importing")}
                      </>
                    ) : (
                      t("confirm")
                    )}
                  </Button>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t("none.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("none.body")}</p>
        </div>
      )}

      {confirmError && (
        <p role="alert" className="text-sm text-destructive">
          {confirmError}
        </p>
      )}
      {bggLimited && (
        <p className="text-sm text-muted-foreground">{t("notes.bggLimited")}</p>
      )}
      {signals.unsupported && (
        <p className="text-sm text-muted-foreground">
          {t("notes.unsupported")}
        </p>
      )}
      {signals.timedOut && (
        <p className="text-sm text-muted-foreground">{t("notes.timedOut")}</p>
      )}

      <Link
        href={manualHref}
        className="inline-flex h-11 items-center self-start text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {t("manual")}
      </Link>
    </div>
  );
}
