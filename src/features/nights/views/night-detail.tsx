"use client";

import { ChevronLeft, Dices, Ellipsis, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  closeNightAction,
  leaveNightAction,
  setNightGameAction,
} from "../actions/night-actions";
import { SectionLabel } from "../components/choice-chips";
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

const subscribeNothing = () => () => {};
const MS_PER_DAY = 86_400_000;

/** Days from the viewer's own today to `iso` (null on the server). */
function useDaysUntil(iso: string): number | null {
  const today = useSyncExternalStore(
    subscribeNothing,
    () => {
      const d = new Date();
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    },
    () => null,
  );
  if (today === null) return null;
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - today) / MS_PER_DAY);
}

/** Most voted first, then pinned; the rest keeps the order they were added in. */
function sortGames(games: Game[]): Game[] {
  return [...games].sort(
    (a, b) =>
      Number(a.played) - Number(b.played) ||
      b.votes - a.votes ||
      Number(b.pinned) - Number(a.pinned),
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
  const days = useDaysUntil(night.startsOn);

  const open = night.status === "open";
  const refresh = () => router.refresh();
  usePoll(() => {
    if (open) refresh();
  });

  const games = sortGames(night.games);
  const unplayed = games.filter((g) => !g.played);
  const candidates = unplayed.map(toCandidate);
  const votes = Object.fromEntries(games.map((g) => [g.gameId, g.votes]));
  const totalVotes = games.reduce((sum, g) => sum + g.votes, 0);
  const hostName = night.hostName || td("someone");
  const leader = unplayed[0] && unplayed[0].votes > 0 ? unplayed[0] : null;

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

  const when = !open
    ? t("list.closedBadge")
    : days === null
      ? null
      : days <= 0
        ? td("today")
        : days === 1
          ? td("tomorrow")
          : td("inDays", { count: days });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="-mx-3 flex items-center justify-between">
        <Link
          href="/nights"
          aria-label={t("back")}
          className="grid size-11 place-items-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        {open && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={td("options")}
              className="grid size-11 place-items-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Ellipsis className="size-5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  setConfirming(night.isOwner ? "close" : "leave")
                }
              >
                {night.isOwner ? td("close.action") : td("leave.action")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <header className="-mt-4 flex flex-col gap-1.5">
        {when && (
          <p
            className={cn(
              "text-sm font-semibold",
              open ? "text-primary" : "text-muted-foreground",
            )}
          >
            {when}
          </p>
        )}
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          {night.title}
        </h1>
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

      {night.isOwner && open && (
        <a
          href="#share-title"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-11 w-fit gap-2 px-4",
          )}
        >
          <Share2 className="size-4" aria-hidden />
          {td("share.title")}
        </a>
      )}

      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby="confirm-text"
          className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4"
        >
          <p id="confirm-text" className="text-sm">
            {confirming === "close" ? td("close.confirm") : td("leave.confirm")}
          </p>
          <div className="flex flex-wrap gap-2">
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
          </div>
        </div>
      )}

      <div aria-live="assertive" role="alert" className="empty:hidden">
        {error && (
          <p className="text-sm text-destructive">{t(`errors.${error}`)}</p>
        )}
      </div>

      <section aria-labelledby="games-title" className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <SectionLabel id="games-title">{td("gamesTitle")}</SectionLabel>
          <span className="text-sm text-muted-foreground">
            {td("totalVotes", { count: totalVotes })}
          </span>
        </div>
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
                totalVotes={totalVotes}
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

      {open && !night.isOwner && (
        <SuggestGame
          nightId={night.id}
          options={suggestable}
          disabled={pending}
          onError={setError}
          onDone={refresh}
        />
      )}

      {open && candidates.length > 1 && (
        <section
          aria-labelledby="spin-title"
          className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4"
        >
          <h2 id="spin-title" className="flex items-center gap-2 font-semibold">
            <Dices className="size-5 text-primary" aria-hidden />
            {td("spinTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{td("spinHint")}</p>
          <SpinCard candidates={candidates} votes={votes} playHref={playHref} />
        </section>
      )}

      {night.isOwner && (
        <>
          <InviteFriends
            nightId={night.id}
            hostName={hostName}
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

      {night.isOwner && open && leader && (
        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-2xl md:border">
          <Link
            href={`/games/${leader.gameId}/plays/new?night=${night.id}`}
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-13 w-full rounded-2xl text-base",
            )}
          >
            {td("startMatch", { name: leader.name })}
          </Link>
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
  totalVotes,
  onError,
  onDone,
  onSet,
}: {
  night: Night;
  game: Game;
  open: boolean;
  pending: boolean;
  totalVotes: number;
  onError: (code: NightErrorCode | null) => void;
  onDone: () => void;
  onSet: (change: { pinned?: boolean; played?: boolean } | "remove") => void;
}) {
  const td = useTranslations("Nights.detail");
  const voters = game.voters.map((n) => n || td("someone"));
  const tags = [
    game.pinned && td("pinned"),
    game.played && td("played"),
    game.source === "suggested" && td("suggested"),
  ].filter(Boolean);
  const subtitle = [
    voters.length > 0
      ? td("votedBy", { count: game.votes, names: voters.join(", ") })
      : td("noVotes"),
    ...tags,
  ].join(" · ");

  return (
    <li
      data-testid="night-game"
      className={cn("flex items-center gap-1", game.played && "opacity-70")}
    >
      <div className="min-w-0 flex-1">
        <VoteButton
          nightGameId={game.id}
          name={game.name}
          coverUrl={game.coverUrl}
          votes={game.votes}
          mine={game.mine}
          totalVotes={totalVotes}
          subtitle={subtitle}
          disabled={!open}
          onError={onError}
          onDone={onDone}
        />
      </div>
      {night.isOwner && open && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={td("moreFor", { name: game.name })}
            disabled={pending}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Ellipsis className="size-5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem asChild>
              <Link href={`/games/${game.gameId}/plays/new?night=${night.id}`}>
                {td("playThis")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSet({ pinned: !game.pinned })}>
              {game.pinned ? td("unpin") : td("pin")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSet({ played: !game.played })}>
              {game.played ? td("unmarkPlayed") : td("markPlayed")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onSet("remove")}
            >
              {td("remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
