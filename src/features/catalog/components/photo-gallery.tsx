"use client";

import { useSession, useUser } from "@clerk/nextjs";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { resizeToJpeg } from "@/lib/image";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const MAX_PHOTOS = 10;
const MAX_INPUT_BYTES = 30 * 1024 * 1024; // refuse absurd files before decoding

type Photo = { id: string; path: string; url: string | null };
type Props = { gameId: string; gameName: string; photos: Photo[] };
type ErrorCode = "upload" | "unreadable" | "limit" | "delete";

export function PhotoGallery({ gameId, gameName, photos }: Props) {
  const t = useTranslations("Game.photos");
  const router = useRouter();
  const { user } = useUser();
  const { session } = useSession();
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, startTransition] = useTransition();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const supabase = useMemo(
    () =>
      createSupabaseBrowserClient(
        async () => (await session?.getToken()) ?? null,
      ),
    [session],
  );
  const atLimit = photos.length >= MAX_PHOTOS;
  const ready = Boolean(user && session);

  function upload(file: File | undefined) {
    if (!file || !user) return;
    setError(null);
    startTransition(async () => {
      if (file.size > MAX_INPUT_BYTES || !file.type.startsWith("image/")) {
        return setError("unreadable");
      }
      let blob: Blob;
      try {
        blob = await resizeToJpeg(file);
      } catch {
        return setError("unreadable");
      }

      // The first path segment must be the user's id: the bucket policy checks it.
      const path = `${user.id}/${gameId}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("game-photos")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (uploadError) return setError("upload");

      const { error: rowError } = await supabase
        .from("game_photos")
        .insert({ game_id: gameId, storage_path: path });
      if (rowError) {
        await supabase.storage.from("game-photos").remove([path]); // do not leave an orphan
        // P0001 comes from the per-game photo cap trigger.
        return setError(rowError.code === "P0001" ? "limit" : "upload");
      }
      router.refresh();
    });
  }

  function remove(photo: Photo) {
    setError(null);
    startTransition(async () => {
      // Row first: never leave a row pointing at a missing file.
      const { error: rowError } = await supabase
        .from("game_photos")
        .delete()
        .eq("id", photo.id);
      if (rowError) return setError("delete");
      await supabase.storage.from("game-photos").remove([photo.path]);
      router.refresh();
    });
  }

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    upload(event.target.files?.[0]);
    event.target.value = ""; // allow picking the same file again
  };

  return (
    <section aria-labelledby="photos-title" className="flex flex-col gap-4">
      <div>
        <h2 id="photos-title" className="text-lg font-semibold tracking-tight">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <li
              key={photo.id}
              className="relative overflow-hidden rounded-xl border border-border bg-muted"
            >
              {photo.url ? (
                // Short-lived signed URL of a private file: next/image would add nothing.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.url}
                  alt={t("alt", { number: index + 1, name: gameName })}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="aspect-square w-full" />
              )}
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute top-2 right-2 size-10"
                aria-label={t("delete")}
                // Until Clerk has loaded there is no token: the request would go out anonymous.
                disabled={busy || !ready}
                onClick={() => remove(photo)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="lg"
          className="h-11"
          disabled={busy || atLimit || !ready}
          onClick={() => cameraInput.current?.click()}
        >
          <Camera aria-hidden />
          {busy ? t("uploading") : t("take")}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="h-11"
          disabled={busy || atLimit || !ready}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus aria-hidden />
          {t("choose")}
        </Button>
        {atLimit && (
          <p className="text-sm text-muted-foreground">{t("limit")}</p>
        )}
      </div>

      {/* `capture` opens the camera directly on phones; desktops show a file picker. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="photo-input-camera"
        onChange={onPick}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="photo-input-file"
        onChange={onPick}
      />

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${error}`)}
          </p>
        )}
      </div>
    </section>
  );
}
