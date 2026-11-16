"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  clearVoteAction,
  voteAction,
  type CommunityResult,
} from "../actions/community-actions";
import { VOTE_REASON_MAX } from "../schemas";
import type { MyVote } from "../services/community-service";

type ErrorCode = Extract<CommunityResult, { ok: false }>["error"];

/**
 * "How accurate was this sheet?": a thumbs up, or a report of a wrong total with a
 * reason. One vote per sheet version, changeable and removable. Shown on a match that
 * used somebody else's sheet.
 */
export function SheetVote({
  versionId,
  playId,
  current: initial,
}: {
  versionId: string;
  playId: string;
  current: MyVote;
}) {
  const t = useTranslations("Community");
  const [current, setCurrent] = useState<MyVote>(initial);
  const [choosing, setChoosing] = useState(initial === null);
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<"saved" | "cleared" | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function send(kind: "up" | "flag") {
    setError(null);
    setNotice(null);
    const body = kind === "flag" ? reason.trim() : null;
    startTransition(async () => {
      const result = await voteAction({
        versionId,
        playId,
        kind,
        reason: body,
      });
      if (!result.ok) return setError(result.error);
      setCurrent({ kind, reason: body });
      setChoosing(false);
      setFlagging(false);
      setReason("");
      setNotice("saved");
    });
  }

  function clear() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await clearVoteAction(versionId);
      if (!result.ok) return setError(result.error);
      setCurrent(null);
      setChoosing(true);
      setNotice("cleared");
    });
  }

  return (
    <section
      id="vote"
      aria-labelledby="vote-title"
      className="flex max-w-3xl flex-col gap-3 rounded-2xl border border-border bg-card p-5"
    >
      <div>
        <h2 id="vote-title" className="text-lg font-semibold tracking-tight">
          {t("vote.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("vote.hint")}</p>
      </div>

      {current && !choosing && (
        <div className="flex flex-col gap-3">
          <p className="text-sm break-words">
            {current.kind === "up"
              ? t("vote.current")
              : t("vote.currentFlag", { reason: current.reason ?? "" })}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              disabled={pending}
              onClick={() => setChoosing(true)}
            >
              {t("vote.change")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-4"
              disabled={pending}
              onClick={clear}
            >
              {t("vote.clear")}
            </Button>
          </div>
        </div>
      )}

      {choosing && !flagging && (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            className="h-11 px-4"
            disabled={pending}
            onClick={() => send("up")}
          >
            {t("vote.up")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            onClick={() => setFlagging(true)}
          >
            {t("vote.flag")}
          </Button>
          {current && (
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-4"
              disabled={pending}
              onClick={() => setChoosing(false)}
            >
              {t("vote.cancel")}
            </Button>
          )}
        </div>
      )}

      {choosing && flagging && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vote-reason">{t("vote.reasonLabel")}</Label>
            <Textarea
              id="vote-reason"
              rows={3}
              maxLength={VOTE_REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              className="h-11 px-4"
              disabled={pending || reason.trim() === ""}
              onClick={() => send("flag")}
            >
              {t("vote.send")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-4"
              disabled={pending}
              onClick={() => setFlagging(false)}
            >
              {t("vote.cancel")}
            </Button>
          </div>
        </div>
      )}

      <div aria-live="polite" className="text-sm">
        {notice && (
          <span className="text-success">
            {notice === "saved" ? t("vote.saved") : t("vote.cleared")}
          </span>
        )}
        {error && (
          <span role="alert" className="text-destructive">
            {t(`errors.${error}`)}
          </span>
        )}
      </div>
    </section>
  );
}
