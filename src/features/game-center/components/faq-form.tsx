"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createFaqAction } from "../actions/game-center-actions";

type Status =
  | { kind: "idle" }
  | { kind: "sent" }
  | { kind: "error"; code: string; field?: string };

/** Everyone can suggest a question; for an administrator it publishes straight away. */
export function FaqForm({ gameId, admin }: { gameId: string; admin: boolean }) {
  const t = useTranslations("GameCenter.faq");
  const te = useTranslations("GameCenter.errors");
  const locale = useLocale();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await createFaqAction({
        gameId,
        locale,
        question,
        answer,
      });
      if (result.ok) {
        setQuestion("");
        setAnswer("");
        setStatus({ kind: "sent" });
      } else {
        const [field, code] = Object.entries(result.fieldErrors ?? {})[0] ?? [
          undefined,
          result.error,
        ];
        setStatus({ kind: "error", code, field });
      }
    });
  }

  const message =
    status.kind === "error" && te.has(status.code as "failed")
      ? te(status.code as "failed")
      : null;

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
    >
      <div>
        <h3 className="font-semibold">
          {admin ? t("addTitle") : t("suggestTitle")}
        </h3>
        {!admin && (
          <p className="text-sm text-muted-foreground">{t("suggestHint")}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="faq-question">{t("question")}</Label>
        <Input
          id="faq-question"
          value={question}
          maxLength={300}
          className="h-10"
          onChange={(e) => setQuestion(e.target.value)}
          aria-invalid={
            status.kind === "error" && status.field === "question"
              ? true
              : undefined
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="faq-answer">{t("answer")}</Label>
        <Textarea
          id="faq-answer"
          rows={4}
          value={answer}
          maxLength={3000}
          onChange={(e) => setAnswer(e.target.value)}
          aria-invalid={
            status.kind === "error" && status.field === "answer"
              ? true
              : undefined
          }
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          size="lg"
          className="h-11 px-5"
          disabled={pending}
        >
          {pending ? t("sending") : admin ? t("publish") : t("send")}
        </Button>
        <div aria-live="polite" className="text-sm">
          {status.kind === "sent" && (
            <span className="text-success">
              {admin ? t("published") : t("sent")}
            </span>
          )}
          {message && (
            <span role="alert" className="text-destructive">
              {message}
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
