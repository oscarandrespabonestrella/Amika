"use client";

import { Camera, ImageIcon, Loader2, ScanSearch, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { useRecognitionSetup } from "../live/use-activation";
import { useLiveRecognition } from "../live/use-live-recognition";
import { ActivationCard } from "./recognition-settings";

const ADD_ERROR_KEYS = [
  "unavailable",
  "rate_limited",
  "not_found",
  "unauthenticated",
] as const;

/** An import error code the UI has a message for; anything else reads as "failed". */
function addErrorKey(code: string): (typeof ADD_ERROR_KEYS)[number] | "failed" {
  return ADD_ERROR_KEYS.find((k) => k === code) ?? "failed";
}

/**
 * "Identify a game": point the camera at a box and it answers live, or pick a photo. The
 * camera frames never leave the device; the feature is opt-in (model download) per device.
 */
export function LiveIdentify() {
  const t = useTranslations("Recognition.live");
  const router = useRouter();
  const setup = useRecognitionSetup();
  const live = useLiveRecognition();
  const galleryRef = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const { state, videoRef, canvasRef } = live;
  const busy = state.phase !== "idle";

  async function accept(gameId: string) {
    setOpening(true);
    await live.confirm(gameId);
    live.stop();
    router.push(`/games/${gameId}`);
  }

  /** A game of the BGG top 500 that is not in the catalog: import it, then open it. */
  async function addPack(gameId: string) {
    setOpening(true);
    setAddError(null);
    const result = await live.addAndOpen(gameId);
    if (!result.ok) {
      setOpening(false);
      setAddError(result.error);
      return;
    }
    live.stop();
    router.push(`/games/${result.gameId}`);
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
      </div>

      {!setup.ready ? null : !setup.active ? (
        <ActivationCard setup={setup} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {state.phase === "idle" ? (
              <Button
                type="button"
                size="lg"
                className="h-11"
                onClick={() => void live.start()}
              >
                <Camera aria-hidden />
                {t("scan")}
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-11"
                onClick={live.stop}
              >
                <Square aria-hidden />
                {t("stop")}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11"
              disabled={busy}
              onClick={() => galleryRef.current?.click()}
            >
              <ImageIcon aria-hidden />
              {t("choose")}
            </Button>
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              hidden
              data-testid="live-photo-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void live.analyzePhoto(file);
              }}
            />
          </div>

          {/* The video stays mounted so the stream can attach; it is hidden when idle. */}
          <div
            className={
              state.phase === "idle"
                ? "hidden"
                : "relative overflow-hidden rounded-xl border border-border bg-black"
            }
          >
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-video w-full object-cover"
              data-testid="live-video"
            />
          </div>
          <canvas ref={canvasRef} hidden />

          {state.phase === "starting" && state.stage && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {state.stage === "references" &&
              state.progress &&
              state.progress.total > 0
                ? t("stage.references", {
                    done: state.progress.done,
                    total: state.progress.total,
                  })
                : t(`stage.${state.stage}`)}
            </p>
          )}

          {state.phase === "scanning" && !state.answer && (
            <p role="status" className="text-sm text-muted-foreground">
              {state.hint ? t("hint") : t("searching")}
            </p>
          )}

          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {t(`errors.${state.error}`)}
            </p>
          )}
          {state.idleTimeout && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("idleTimeout")}
            </p>
          )}
          {state.noGames && (
            <p className="text-sm text-muted-foreground">{t("noGames")}</p>
          )}

          {state.answer && (
            <div
              role="status"
              data-testid="live-answer"
              data-game-id={state.answer.gameId}
              data-level={state.answer.level}
              className="flex flex-col gap-2 rounded-xl border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong className="break-words">{state.answer.name}</strong>
                <Badge variant="secondary">
                  {t(`confidence.${state.answer.level}`)}
                </Badge>
              </div>
              {state.answer.pack && (
                <p className="text-sm text-muted-foreground">
                  {t("packRank", { rank: state.answer.pack.rank })}
                </p>
              )}
              {state.answer.level === "low" && (
                <p className="text-sm text-muted-foreground">
                  {t("lowWarning")}
                </p>
              )}
              {addError && (
                <p role="alert" className="text-sm text-destructive">
                  {t(`addErrors.${addErrorKey(addError)}`)}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {state.answer.pack ? (
                  <Button
                    type="button"
                    className="h-11"
                    disabled={opening}
                    aria-label={t("addAndOpenFor", {
                      name: state.answer.name,
                    })}
                    onClick={() => void addPack(state.answer!.gameId)}
                  >
                    {opening ? t("adding") : t("addAndOpen")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="h-11"
                    disabled={opening}
                    aria-label={t("confirmFor", { name: state.answer.name })}
                    onClick={() => void accept(state.answer!.gameId)}
                  >
                    {t("confirm")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => live.reject(state.answer!.gameId)}
                >
                  {t("notThis")}
                </Button>
              </div>
            </div>
          )}

          {state.alternatives.length > 0 && state.phase !== "idle" && (
            <p className="text-xs text-muted-foreground">
              {t("alsoLike", {
                names: state.alternatives.map((a) => a.name).join(", "),
              })}
            </p>
          )}
        </>
      )}
    </section>
  );
}
