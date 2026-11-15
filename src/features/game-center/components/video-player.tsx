"use client";

import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { youtubeEmbedUrl } from "../youtube";

/**
 * Click-to-play facade: nothing is requested from YouTube until the user presses
 * play (privacy and speed). Then a youtube-nocookie.com embed is shown.
 */
export function VideoPlayer({
  youtubeId,
  title,
}: {
  youtubeId: string;
  title: string;
}) {
  const t = useTranslations("GameCenter.videos");
  const [playing, setPlaying] = useState(false);

  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted">
      {playing ? (
        <iframe
          src={youtubeEmbedUrl(youtubeId)}
          title={title}
          className="size-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="flex size-full flex-col items-center justify-center gap-3 p-4 text-center outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground">
            <Play className="size-6" aria-hidden />
          </span>
          <span className="text-sm font-medium text-balance">
            {t("play", { title })}
          </span>
        </button>
      )}
    </div>
  );
}
