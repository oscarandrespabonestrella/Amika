"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function AppError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const t = useTranslations("Errors");
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-14 text-center"
    >
      <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t("body")}</p>
      <Button type="button" size="lg" className="h-11 px-5" onClick={reset}>
        {t("retry")}
      </Button>
    </div>
  );
}
