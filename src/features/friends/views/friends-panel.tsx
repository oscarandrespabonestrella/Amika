"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { respondNightInviteAction } from "@/features/nights/actions/night-actions";
import { toNightError } from "@/features/nights/error-codes";
import type { NightInvite } from "@/features/nights/client";
import { toFriendError } from "../error-codes";
import {
  respondPlayerLinkAction,
  respondPlayInviteAction,
} from "@/features/plays/actions/sharing-actions";
import type {
  LinkRequest,
  PlayInvite,
} from "@/features/plays/services/sharing-service";
import {
  createFriendInviteAction,
  removeFriendAction,
  revokeFriendInviteAction,
} from "../actions/friend-actions";
import type { Friend } from "../services/friends-service";

type Props = {
  friends: Friend[];
  invites: PlayInvite[];
  linkRequests: LinkRequest[];
  nightInvites: NightInvite[];
};

/** Friends, my invitation link, and what is waiting for my answer. */
export function FriendsPanel({
  friends,
  invites,
  linkRequests,
  nightInvites,
}: Props) {
  const t = useTranslations("Friends");
  const te = useTranslations("Friends.errors");
  const tn = useTranslations("Nights.errors");
  const locale = useLocale();
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nightError, setNightError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const link = code
    ? `${window.location.origin}/${locale}/friends/join/${code}`
    : null;

  function act(
    call: () => Promise<{ ok: true } | { ok: false; error: string }>,
    after?: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        after?.();
        router.refresh();
      } else setError(result.error);
    });
  }

  function respondNight(nightId: string, accept: boolean) {
    setNightError(null);
    startTransition(async () => {
      const result = await respondNightInviteAction(nightId, accept);
      if (result.ok) router.refresh();
      else setNightError(toNightError(result.error));
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {nightError && (
        <p role="alert" className="text-sm text-destructive">
          {tn(toNightError(nightError))}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {te(toFriendError(error))}
        </p>
      )}

      {invites.length > 0 && (
        <section aria-labelledby="invites" className="flex flex-col gap-3">
          <h2 id="invites" className="text-xl font-semibold">
            {t("invitesTitle")}
          </h2>
          <ul className="flex flex-col gap-2">
            {invites.map((i) => (
              <li
                key={i.memberId}
                data-testid="play-invite"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <span>
                  {t("invite", { who: i.invitedByName, game: i.gameName })}
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      act(() =>
                        respondPlayInviteAction({
                          id: i.memberId,
                          accept: true,
                        }),
                      )
                    }
                  >
                    {t("accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      act(() =>
                        respondPlayInviteAction({
                          id: i.memberId,
                          accept: false,
                        }),
                      )
                    }
                  >
                    {t("decline")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {nightInvites.length > 0 && (
        <section
          aria-labelledby="night-invites"
          className="flex flex-col gap-3"
        >
          <h2 id="night-invites" className="text-xl font-semibold">
            {t("nightInvitesTitle")}
          </h2>
          <ul className="flex flex-col gap-2">
            {nightInvites.map((n) => (
              <li
                key={n.nightId}
                data-testid="night-invite"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <span>
                  {t("nightInvite", {
                    who: n.hostName || t("unnamed"),
                    title: n.title,
                    date: n.startsOn,
                  })}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Link
                    href={`/nights/${n.nightId}`}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                    )}
                  >
                    {t("viewNight")}
                  </Link>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => respondNight(n.nightId, true)}
                  >
                    {t("accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => respondNight(n.nightId, false)}
                  >
                    {t("decline")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {linkRequests.length > 0 && (
        <section aria-labelledby="links" className="flex flex-col gap-3">
          <h2 id="links" className="text-xl font-semibold">
            {t("linkTitle")}
          </h2>
          <ul className="flex flex-col gap-2">
            {linkRequests.map((r) => (
              <li
                key={r.requestId}
                data-testid="link-request"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <span>
                  {t("linkRequest", {
                    owner: r.ownerName,
                    player: r.playerName,
                    plays: r.plays,
                  })}
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      act(() =>
                        respondPlayerLinkAction({
                          id: r.requestId,
                          accept: true,
                        }),
                      )
                    }
                  >
                    {t("accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      act(() =>
                        respondPlayerLinkAction({
                          id: r.requestId,
                          accept: false,
                        }),
                      )
                    }
                  >
                    {t("decline")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="mylink" className="flex flex-col gap-3">
        <h2 id="mylink" className="text-xl font-semibold">
          {t("myLink.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("myLink.hint")}</p>
        {link ? (
          <div className="flex flex-col gap-2">
            <input
              readOnly
              value={link}
              aria-label={t("myLink.title")}
              data-testid="friend-link"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              onFocus={(e) => e.currentTarget.select()}
            />
            <span className="flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await navigator.clipboard?.writeText(link).catch(() => {});
                  setCopied(true);
                }}
              >
                {copied ? t("myLink.copied") : t("myLink.copy")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  act(
                    () => revokeFriendInviteAction(code),
                    () => {
                      setCode(null);
                      setCopied(false);
                    },
                  )
                }
              >
                {t("myLink.revoke")}
              </Button>
            </span>
          </div>
        ) : (
          <div>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await createFriendInviteAction();
                  if (result.ok) setCode(result.code);
                  else setError(result.error);
                })
              }
            >
              {t("myLink.create")}
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="friends" className="flex flex-col gap-3">
        <h2 id="friends" className="text-xl font-semibold">
          {t("listTitle")}
        </h2>
        {friends.length === 0 ? (
          <p className="text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {friends.map((f) => (
              <li
                key={f.userId}
                data-testid="friend"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <span className="font-medium">
                  {f.displayName || t("unnamed")}
                </span>
                {confirming === f.userId ? (
                  <span className="flex items-center gap-2 text-sm">
                    {t("removeConfirm", {
                      name: f.displayName || t("unnamed"),
                    })}
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() =>
                        act(
                          () => removeFriendAction(f.userId),
                          () => setConfirming(null),
                        )
                      }
                    >
                      {t("removeYes")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirming(null)}
                    >
                      {t("keep")}
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirming(f.userId)}
                  >
                    {t("remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
