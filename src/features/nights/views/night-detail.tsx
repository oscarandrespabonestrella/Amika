"use client";

import { Dices } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  closeNightAction,
  leaveNightAction,
  setNightGameAction,
} from "../actions/night-actions";
import { InviteFriends, type InviteFriend } from "../components/invite-friends";
import { ShareLink } from "../components/share-link";
import { SpinCard } from "../components/spin-card";
import { SuggestGame, type SuggestOption } from "../components/suggest-game";
import { usePoll } from "../components/use-poll";
import { VoteButton } from "../components/vote-button";
import { toNightError, type NightErrorCode } from "../error-codes";
import type { Ranked } from "../rank";
import type { NightDetail as Night } from "../services/night-service";

type Game = Night["games"][number];

/** Most voted first, then pinned; the rest keeps the order they were added in. */
function sortGames(games: Game[]): Game[] {
  return [...games].sort(
    (a, b) => b.votes - a.votes || Number(b.pinned) - Number(a.pinned),
  );
}

/** Spin input for a saved night: no score, the votes are the weight. */
function toCandidate(g: Game): Ranked {
  return {
    gameId: g.gameId,
    name: g.name,
    coverUrl: g.coverUrl,
    isCustom: false,
    minPlayers: null,
    maxPlayers: null,
    minPlaytime: null,
    maxPlaytime: null,
    isFavorite: false,
    rating: null,
    playCount: 0,
    lastPlayedOn: null,
    score: 0,
    reasons: [],
  };
}

/** /nights/:id for the host and the friends who accepted: votes, suggestions, spin. */
export function NightDetail({
  night,
  friends,
  suggestable,
}: {
  night: Night;
  /** Host only: all my friends. */
  friends: InviteFriend[];
  /** Friends only: catalog games of my library not yet on the night. */
  suggestable: SuggestOption[];
}) {
  const t = useTranslations("Nights");
  const td = useTranslations("Nights.detail");
  const router = useRouter();
  const [error, setError] = useState<NightErrorCode | null>(null);
  const [confirming, setConfirming] = useState<"close" | "leave" | null>(null);
  const [pending, startTransition] = useTransition();

  const open = night.status === "open";
  const refresh = () => router.refresh();
  usePoll(() => {
    if (open) refresh();
  });

  const games = sortGames(night.games);
  const candidates = games.filter((g) => !g.played).map(toCandidate);
  const votes = Object.fromEntries(games.map((g) => [g.gameId, g.votes]));
  const hostName = night.hostName || td("someone");

  function run(
    call: () => Promise<{ ok: true } | { ok: false; error: string }>,
    after: () => void = refresh,
  ) {
    setError(null);
    setConfirming(null);
    startTransition(async () => {
      const result = await call();
      if (result.ok) after();
      else setError(toNightError(result.error));
    });
  }

  const playHref = (gameId: string) =>
    night.isOwner ? `/games/${gameId}/plays/new?night=${night.id}` : null;

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link href="/nights" className="text-sm font-medium underline">
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            {night.title}
          </h1>
          {!open && <Badge variant="secondary">{t("list.closedBadge")}</Badge>}
        </div>
        <p className="text-muted-foreground">
          {night.startsOn} · {td("hostedBy", { host: hostName })}
          {night.players !== null &&
            ` · ${td("players", { count: night.players })}`}
          {night.maxMinutes !== null &&
            ` · ${t("filters.minutes", { minutes: night.maxMinutes })}`}
        </p>
        {!open && (
          <p className="text-sm text-muted-foreground">{td("closedNotice")}</p>
        )}
      </header>

      <div aria-live="assertive" role="alert" className="empty:hidden">
        {error && (
          <p className="text-sm text-destructive">{t(`errors.${error}`)}</p>
        )}
      </div>

      <section aria-labelledby="games-title" className="flex flex-col gap-3">
        <h2 id="games-title" className="font-semibold">
          {td("gamesTitle")}
        </h2>
        {games.length === 0 ? (
          <p className="text-sm text-muted-foreground">{td("noGames")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {games.map((g) => (
              <GameRow
                key={g.id}
                night={night}
                game={g}
                open={open}
                pending={pending}
                onError={setError}
                onDone={refresh}
                onSet={(change) =>
                  run(() => setNightGameAction(night.id, g.gameId, change))
                }
              />
            ))}
          </ul>
        )}
      </section>

      {open && candidates.length > 0 && (
        <section
          aria-labelledby="spin-title"
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
        >
          <h2 id="spin-title" className="flex items-center gap-2 font-semibold">
            <Dices className="size-5 text-primary" aria-hidden />
            {td("spinTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{td("spinHint")}</p>
          <SpinCard candidates={candidates} votes={votes} playHref={playHref} />
        </section>
      )}

      {open && !night.isOwner && (
        <SuggestGame
          nightId={night.id}
          options={suggestable}
          disabled={pending}
          onError={setError}
          onDone={refresh}
        />
      )}

      {night.isOwner && (
        <>
          <InviteFriends
            nightId={night.id}
            friends={friends}
            members={night.members}
            disabled={!open || pending}
            onError={setError}
            onDone={refresh}
          />
          {open && (
            <ShareLink
              nightId={night.id}
              title={night.title}
              linkExpiresAt={night.linkExpiresAt}
              onError={setError}
              onDone={refresh}
            />
          )}
        </>
      )}

      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {confirming === null ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              disabled={pending}
              onClick={() => setConfirming(night.isOwner ? "close" : "leave")}
            >
              {night.isOwner ? td("close.action") : td("leave.action")}
            </Button>
          ) : (
            <>
              <span className="text-sm">
                {confirming === "close"
                  ? td("close.confirm")
                  : td("leave.confirm")}
              </span>
              <Button
                type="button"
                variant="destructive"
                className="h-11 px-4"
                disabled={pending}
                onClick={() =>
                  confirming === "close"
                    ? run(() => closeNightAction(night.id))
                    : run(
                        () => leaveNightAction(night.id),
                        () => router.push("/nights"),
                      )
                }
              >
                {confirming === "close" ? td("close.yes") : td("leave.yes")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                onClick={() => setConfirming(null)}
              >
                {td("keep")}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GameRow({
  night,
  game,
  open,
  pending,
  onError,
  onDone,
  onSet,
}: {
  night: Night;
  game: Game;
  open: boolean;
  pending: boolean;
  onError: (code: NightErrorCode | null) => void;
  onDone: () => void;
  onSet: (change: { pinned?: boolean; played?: boolean } | "remove") => void;
}) {
  const td = useTranslations("Nights.detail");
  const voters = game.voters.map((n) => n || td("someone"));
  const label = (action: string) =>
    td("actionFor", { action, name: game.name });

  return (
    <li
      data-testid="night-game"
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-3",
        game.played && "opacity-70",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-tint text-tint-foreground">
          {game.coverUrl ? (
            // External hotlinked image (BGG): next/image optimization is not applicable.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={game.coverUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <Dices className="size-6" aria-hidden />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium break-words">{game.name}</span>
          <span className="flex flex-wrap gap-1.5">
            {game.pinned && <Badge variant="secondary">{td("pinned")}</Badge>}
            {game.played && <Badge variant="secondary">{td("played")}</Badge>}
            {game.source === "suggested" && (
              <Badge variant="secondary">{td("suggested")}</Badge>
            )}
          </span>
        </div>
        <VoteButton
          nightGameId={game.id}
          name={game.name}
          votes={game.votes}
          mine={game.mine}
          disabled={!open}
          onError={onError}
          onDone={onDone}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {voters.length > 0
          ? td("votedBy", {
              count: game.votes,
              names: voters.join(", "),
            })
          : td("noVotes")}
      </p>
      {night.isOwner && open && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/games/${game.gameId}/plays/new?night=${night.id}`}
            aria-label={label(td("playThis"))}
            className={cn(buttonVariants({ size: "sm" }), "h-11 px-4")}
          >
            {td("playThis")}
          </Link>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            aria-label={label(game.pinned ? td("unpin") : td("pin"))}
            onClick={() => onSet({ pinned: !game.pinned })}
          >
            {game.pinned ? td("unpin") : td("pin")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            aria-label={label(
              game.played ? td("unmarkPlayed") : td("markPlayed"),
            )}
            onClick={() => onSet({ played: !game.played })}
          >
            {game.played ? td("unmarkPlayed") : td("markPlayed")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            aria-label={label(td("remove"))}
            onClick={() => onSet("remove")}
          >
            {td("remove")}
          </Button>
        </div>
      )}
    </li>
  );
}
