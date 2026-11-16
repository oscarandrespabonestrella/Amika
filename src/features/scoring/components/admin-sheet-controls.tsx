"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  setDisabledAction,
  setVerifiedAction,
  type CommunityResult,
} from "../actions/community-actions";

type ErrorCode = Extract<CommunityResult, { ok: false }>["error"];

/** Administrators only: verify or disable a public sheet, and read the reports on it. */
export function AdminSheetControls({
  sheetId,
  verified,
  disabled,
  flags,
}: {
  sheetId: string;
  verified: boolean;
  disabled: boolean;
  flags: { version: number; reason: string; createdAt: string }[];
}) {
  const t = useTranslations("Community.admin");
  const te = useTranslations("Community.errors");
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function run(call: () => Promise<CommunityResult>) {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <section
      aria-labelledby="admin-title"
      className="flex max-w-3xl flex-col gap-4 rounded-2xl border border-border bg-card p-5"
    >
      <h2 id="admin-title" className="text-lg font-semibold tracking-tight">
        {t("title")}
      </h2>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4"
          disabled={pending || (disabled && !verified)}
          onClick={() => run(() => setVerifiedAction(sheetId, !verified))}
        >
          {verified ? t("unverify") : t("verify")}
        </Button>
        <Button
          type="button"
          variant={disabled ? "default" : "destructive"}
          className="h-11 px-4"
          disabled={pending}
          onClick={() => run(() => setDisabledAction(sheetId, !disabled))}
        >
          {disabled ? t("enable") : t("disable")}
        </Button>
      </div>

      <div>
        <h3 className="text-sm font-medium">{t("flags")}</h3>
        {flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noFlags")}</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {flags.map((flag, i) => (
              <li key={i} className="break-words">
                {t("flagItem", { version: flag.version, reason: flag.reason })}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {te(error)}
          </p>
        )}
      </div>
    </section>
  );
}
