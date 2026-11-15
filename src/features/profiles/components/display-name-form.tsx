"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateDisplayName } from "../actions/update-display-name";

type Status = "idle" | "saved" | "tooLong" | "failed";

export function DisplayNameForm({ initialName }: { initialName: string }) {
  const t = useTranslations("Settings.profile");
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<Status>("idle");
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("idle");
    startTransition(async () => {
      const result = await updateDisplayName({ displayName: name });
      setStatus(
        result.ok ? "saved" : result.error === "tooLong" ? "tooLong" : "failed",
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">{t("displayName")}</Label>
        <Input
          id="displayName"
          name="displayName"
          value={name}
          maxLength={60}
          autoComplete="nickname"
          className="h-10"
          aria-invalid={status === "tooLong" ? true : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setStatus("idle");
          }}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          size="lg"
          className="h-11 px-5"
          disabled={pending}
        >
          {pending ? t("saving") : t("save")}
        </Button>
        <p aria-live="polite" className="text-sm">
          {status === "saved" && (
            <span className="text-success">{t("saved")}</span>
          )}
          {status === "tooLong" && (
            <span className="text-destructive">{t("tooLong")}</span>
          )}
          {status === "failed" && (
            <span className="text-destructive">{t("error")}</span>
          )}
        </p>
      </div>
    </form>
  );
}
