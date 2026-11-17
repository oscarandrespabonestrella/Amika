"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { Friend } from "@/features/friends";
import {
  type Definition,
  ScoreFields,
  type ScoreValue,
} from "@/features/scoring/client";
import { Link, useRouter } from "@/i18n/navigation";
import {
  closePlayAction,
  inviteToPlayAction,
  leavePlayAction,
  saveMyScoresAction,
} from "../actions/sharing-actions";
import { computePlay } from "../compute";
import { toLiveError } from "../live/error-codes";
import {
  type LiveParticipant,
  type LivePlay,
  shownTotal,
} from "../live/merge-play-state";
import { useLivePlay } from "../live/use-live-play";

type Props = {
  initial: LivePlay;
  /** The match's sheet; null when it is scored with manual totals. */
  definition: Definition | null;
  me: string;
  isOwner: boolean;
  friends: Friend[];
  gameId: string;
  gameName: string;
};

/** A match in progress: everybody sees it update; each member fills their own column. */
export function LivePlay({
  initial,
  definition,
  me,
  isOwner,
  friends,
  gameId,
  gameName,
}: Props) {
  const t = useTranslations("Live");
  const te = useTranslations("Live.errors");
  const router = useRouter();
  const { play, connected } = useLivePlay(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pending, startTransition] = useTransition();
  const open = play.status === "open";

  function act(
    call: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done?: () => void,
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await call();
      if (result.ok) done?.();
      else setError(result.error);
    });
  }

  const memberStatus = (p: LiveParticipant) =>
    p.userId ? play.members.find((m) => m.userId === p.userId)?.status : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant={open ? "default" : "secondary"}
          data-testid="live-status"
        >
          {open ? t("open") : t("closed")}
        </Badge>
        {open && (
          <span
            role="status"
            data-testid="live-connection"
            className="text-sm text-muted-foreground"
          >
            {connected ? t("connected") : t("offline")}
          </span>
        )}
        <Link
          href={`/games/${gameId}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {t("back")} · {gameName}
        </Link>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {te(toLiveError(error))}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {!open && <p className="text-muted-foreground">{t("closedNote")}</p>}
      {!definition && (
        <p className="text-sm text-muted-foreground">{t("noSheet")}</p>
      )}

      <ul className="grid gap-4 sm:grid-cols-2" aria-label={t("title")}>
        {play.participants.map((p) => (
          <Column
            key={p.id}
            participant={p}
            playId={play.id}
            definition={definition}
            status={memberStatus(p)}
            mine={p.userId === me && p.userId !== null}
            editable={open && p.userId === me && definition !== null}
            total={shownTotal(play, p, provisionalTotal(definition, p))}
            provisional={open}
            onSave={(values) =>
              act(
                () => saveMyScoresAction({ playId: play.id, values }),
                () => setNotice(t("saved")),
              )
            }
            pending={pending}
          />
        ))}
      </ul>

      {isOwner && open && (
        <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <InviteForm
            friends={friends.filter(
              (f) =>
                !play.members.some(
                  (m) =>
                    m.userId === f.userId &&
                    (m.status === "accepted" || m.status === "invited"),
                ),
            )}
            seats={play.participants.filter((p) => !p.userId)}
            pending={pending}
            onInvite={(friendId, seat) =>
              act(
                () => inviteToPlayAction({ playId: play.id, friendId, seat }),
                () => setNotice(t("invited")),
              )
            }
          />
        </section>
      )}

      {isOwner && open && (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/games/${gameId}/plays/${play.id}`}
            className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm"
          >
            {t("editPoints")}
          </Link>
          {confirmClose ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              {t("closeConfirm")}
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  act(
                    () => closePlayAction(play.id),
                    () => router.refresh(),
                  )
                }
              >
                {t("closeYes")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmClose(false)}
              >
                {t("cancel")}
              </Button>
            </span>
          ) : (
            <Button variant="outline" onClick={() => setConfirmClose(true)}>
              {t("close")}
            </Button>
          )}
        </div>
      )}

      {!isOwner && (
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              act(
                () => leavePlayAction(play.id),
                () => router.replace("/friends"),
              )
            }
          >
            {t("leave")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Provisional total (display only): the engine over what is entered so far. */
function provisionalTotal(
  definition: Definition | null,
  p: LiveParticipant,
): number | null {
  if (!definition) return p.total;
  const result = computePlay(definition, [
    { name: p.name, values: p.scores as Record<string, ScoreValue> },
  ]);
  return result.participants[0]?.total ?? null;
}

function Column({
  participant: p,
  definition,
  status,
  mine,
  editable,
  total,
  provisional,
  onSave,
  pending,
}: {
  participant: LiveParticipant;
  playId: string;
  definition: Definition | null;
  status: string | null | undefined;
  mine: boolean;
  editable: boolean;
  total: number | null;
  provisional: boolean;
  onSave: (values: Record<string, ScoreValue>) => void;
  pending: boolean;
}) {
  const t = useTranslations("Live");
  const [draft, setDraft] = useState<Record<string, ScoreValue | undefined>>(
    () => p.scores as Record<string, ScoreValue>,
  );
  const label =
    status === "invited"
      ? t("waiting")
      : status === "declined"
        ? t("declined")
        : null;

  return (
    <li
      data-testid="live-column"
      data-seat={p.seat}
      data-mine={mine ? "true" : undefined}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {p.name}
          {mine && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({t("yourColumn")})
            </span>
          )}
        </h2>
        {label && <Badge variant="outline">{label}</Badge>}
      </div>

      {editable && definition ? (
        <>
          <ScoreFields
            definition={definition}
            values={draft}
            onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
          />
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              onSave(
                Object.fromEntries(
                  Object.entries(draft).filter(([, v]) => v !== undefined),
                ) as Record<string, ScoreValue>,
              )
            }
          >
            {t("save")}
          </Button>
        </>
      ) : (
        definition && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            {definition.categories
              .filter(
                (c) => c.type !== "derived" && p.scores[c.key] !== undefined,
              )
              .map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-muted-foreground">{c.label}</dt>
                  <dd>{String(p.scores[c.key])}</dd>
                </div>
              ))}
          </dl>
        )
      )}

      <p className="text-sm" data-testid="live-total">
        <span className="text-muted-foreground">
          {t("total")}
          {provisional && total !== null ? ` (${t("provisional")})` : ""}:{" "}
        </span>
        <strong>{total ?? "—"}</strong>
      </p>
    </li>
  );
}

function InviteForm({
  friends,
  seats,
  pending,
  onInvite,
}: {
  friends: Friend[];
  seats: LiveParticipant[];
  pending: boolean;
  onInvite: (friendId: string, seat: number) => void;
}) {
  const t = useTranslations("Live");
  const tf = useTranslations("Friends");
  const [friendId, setFriendId] = useState("");
  const [seat, setSeat] = useState("");
  if (friends.length === 0 || seats.length === 0) return null;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (friendId && seat !== "") onInvite(friendId, Number(seat));
      }}
    >
      <h2 className="text-lg font-semibold">{t("inviteTitle")}</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("inviteSeat")}
          <NativeSelect
            value={seat}
            onChange={(e) => setSeat(e.target.value)}
            data-testid="invite-seat"
          >
            <option value="" />
            {seats.map((s) => (
              <option key={s.id} value={s.seat}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("inviteFriend")}
          <NativeSelect
            value={friendId}
            onChange={(e) => setFriendId(e.target.value)}
            data-testid="invite-friend"
          >
            <option value="">{t("invitePick")}</option>
            {friends.map((f) => (
              <option key={f.userId} value={f.userId}>
                {f.displayName || tf("unnamed")}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" disabled={pending || !friendId || seat === ""}>
          {t("inviteSend")}
        </Button>
      </div>
    </form>
  );
}
