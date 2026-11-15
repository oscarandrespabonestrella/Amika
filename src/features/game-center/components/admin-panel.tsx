"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { LOCALE_NAMES } from "@/i18n/locales";
import { routing } from "@/i18n/routing";
import {
  addImageAction,
  addResourceAction,
  saveRulesSummaryAction,
  type GameCenterResult,
} from "../actions/game-center-actions";
import { RESOURCE_KINDS } from "../schemas";

type Feedback =
  { ok: true } | { ok: false; code: string; field?: string } | null;

function useSubmit() {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const submit = (work: () => Promise<GameCenterResult>, onOk?: () => void) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        setFeedback({ ok: true });
        onOk?.();
      } else {
        const [field, code] = Object.entries(result.fieldErrors ?? {})[0] ?? [
          undefined,
          result.error,
        ];
        setFeedback({ ok: false, code, field });
      }
    });
  };
  return { feedback, pending, submit };
}

function Status({ feedback }: { feedback: Feedback }) {
  const t = useTranslations("GameCenter");
  return (
    <div aria-live="polite" className="text-sm">
      {feedback?.ok && <span className="text-success">{t("admin.saved")}</span>}
      {feedback && !feedback.ok && (
        <span role="alert" className="text-destructive">
          {t.has(`errors.${feedback.code}` as "errors.failed")
            ? t(`errors.${feedback.code}` as "errors.failed")
            : t("errors.failed")}
        </span>
      )}
    </div>
  );
}

/** Content editor. Only rendered for administrators; the database enforces it anyway. */
export function AdminPanel({ gameId }: { gameId: string }) {
  const t = useTranslations("GameCenter.admin");

  return (
    <details className="rounded-2xl border border-border bg-card p-5">
      <summary className="cursor-pointer text-lg font-semibold tracking-tight select-none">
        {t("title")}
      </summary>
      <p className="mt-1 text-sm text-muted-foreground">{t("hint")}</p>
      <div className="mt-5 grid gap-8 lg:grid-cols-1">
        <ResourceForm gameId={gameId} />
        <RulesForm gameId={gameId} />
        <ImageForm gameId={gameId} />
      </div>
    </details>
  );
}

function LanguageSelect({
  id,
  includeAny,
  value,
  onChange,
}: {
  id: string;
  includeAny?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("GameCenter.admin");
  return (
    <NativeSelect
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {includeAny && <option value="any">{t("anyLanguage")}</option>}
      {routing.locales.map((locale) => (
        <option key={locale} value={locale}>
          {LOCALE_NAMES[locale]}
        </option>
      ))}
    </NativeSelect>
  );
}

function ResourceForm({ gameId }: { gameId: string }) {
  const t = useTranslations("GameCenter.admin.resource");
  const [kind, setKind] = useState<(typeof RESOURCE_KINDS)[number]>("rules");
  const [locale, setLocale] = useState("en");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [official, setOfficial] = useState(false);
  const { feedback, pending, submit } = useSubmit();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          () =>
            addResourceAction({
              gameId,
              kind,
              locale,
              title,
              target,
              isOfficial: official,
            }),
          () => {
            setTitle("");
            setTarget("");
          },
        );
      }}
    >
      <h3 className="font-semibold">{t("title")}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="res-kind">{t("kind")}</Label>
          <NativeSelect
            id="res-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {RESOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="res-locale">{t("language")}</Label>
          <LanguageSelect
            id="res-locale"
            includeAny
            value={locale}
            onChange={setLocale}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="res-title">{t("titleLabel")}</Label>
        <Input
          id="res-title"
          value={title}
          maxLength={200}
          className="h-10"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="res-target">
          {kind === "video" ? t("targetVideo") : t("targetUrl")}
        </Label>
        <Input
          id="res-target"
          value={target}
          maxLength={500}
          inputMode="url"
          className="h-10"
          aria-invalid={
            feedback && !feedback.ok && feedback.field === "target"
              ? true
              : undefined
          }
          onChange={(e) => setTarget(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={official}
          onChange={(e) => setOfficial(e.target.checked)}
          className="size-4 accent-primary"
        />
        {t("official")}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          size="lg"
          className="h-11 px-5"
          disabled={pending}
        >
          {t("add")}
        </Button>
        <Status feedback={feedback} />
      </div>
    </form>
  );
}

function RulesForm({ gameId }: { gameId: string }) {
  const t = useTranslations("GameCenter.admin.rules");
  const uiLocale = useLocale();
  const [locale, setLocale] = useState<string>(uiLocale);
  const [body, setBody] = useState("");
  const { feedback, pending, submit } = useSubmit();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          () => saveRulesSummaryAction({ gameId, locale, body }),
          () => setBody(""),
        );
      }}
    >
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rules-locale">{t("language")}</Label>
        <LanguageSelect id="rules-locale" value={locale} onChange={setLocale} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rules-body">{t("body")}</Label>
        <Textarea
          id="rules-body"
          rows={6}
          value={body}
          maxLength={20000}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          size="lg"
          className="h-11 px-5"
          disabled={pending}
        >
          {t("save")}
        </Button>
        <Status feedback={feedback} />
      </div>
    </form>
  );
}

function ImageForm({ gameId }: { gameId: string }) {
  const t = useTranslations("GameCenter.admin.image");
  const [url, setUrl] = useState("");
  const [attribution, setAttribution] = useState("");
  const [license, setLicense] = useState("");
  const [caption, setCaption] = useState("");
  const { feedback, pending, submit } = useSubmit();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          () =>
            addImageAction({
              gameId,
              url,
              attribution,
              license: license || undefined,
              caption: caption || undefined,
            }),
          () => {
            setUrl("");
            setAttribution("");
            setLicense("");
            setCaption("");
          },
        );
      }}
    >
      <h3 className="font-semibold">{t("title")}</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="img-url">{t("url")}</Label>
        <Input
          id="img-url"
          value={url}
          maxLength={500}
          inputMode="url"
          className="h-10"
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="img-attribution">{t("attribution")}</Label>
          <Input
            id="img-attribution"
            value={attribution}
            maxLength={200}
            className="h-10"
            onChange={(e) => setAttribution(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="img-license">{t("license")}</Label>
          <Input
            id="img-license"
            value={license}
            maxLength={100}
            className="h-10"
            onChange={(e) => setLicense(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="img-caption">{t("caption")}</Label>
        <Input
          id="img-caption"
          value={caption}
          maxLength={200}
          className="h-10"
          onChange={(e) => setCaption(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          size="lg"
          className="h-11 px-5"
          disabled={pending}
        >
          {t("add")}
        </Button>
        <Status feedback={feedback} />
      </div>
    </form>
  );
}
