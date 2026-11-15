"use client";

import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { reviewFaqAction } from "../actions/game-center-actions";

export function FaqReview({ faqId }: { faqId: string }) {
  const t = useTranslations("GameCenter.faq");
  const te = useTranslations("GameCenter.errors");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function review(decision: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const result = await reviewFaqAction({ faqId, decision });
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        className="h-9"
        disabled={pending}
        onClick={() => review("approve")}
      >
        <Check aria-hidden />
        {t("approve")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9"
        disabled={pending}
        onClick={() => review("reject")}
      >
        <X aria-hidden />
        {t("reject")}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {te(error as "failed")}
        </span>
      )}
    </span>
  );
}
