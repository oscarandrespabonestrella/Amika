"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { Definition } from "../engine/definition";
import {
  evaluate,
  type FieldErrorCode,
  type ScoreValue,
} from "../engine/evaluate";
import { ScoreFields } from "./score-fields";

/** Lets the author try the sheet with sample values and see the totals live. */
export function ScorePreview({
  definition,
}: {
  definition: Definition | null;
}) {
  const t = useTranslations("Scoring.editor.preview");
  const [values, setValues] = useState<Record<string, ScoreValue | undefined>>(
    {},
  );

  const result = useMemo(
    () => (definition ? evaluate(definition, values) : null),
    [definition, values],
  );

  const errors = useMemo(() => {
    const out: Record<string, FieldErrorCode> = {};
    for (const c of result?.categories ?? []) if (c.error) out[c.key] = c.error;
    return out;
  }, [result]);

  return (
    <section
      aria-labelledby="preview-title"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
    >
      <div>
        <h2 id="preview-title" className="text-lg font-semibold tracking-tight">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {definition ? t("hint") : t("invalid")}
        </p>
      </div>

      {definition && result && (
        <>
          <ScoreFields
            definition={definition}
            values={values}
            errors={errors}
            onChange={(key, value) =>
              setValues((current) => ({ ...current, [key]: value }))
            }
          />
          <dl className="flex flex-col gap-1.5 border-t border-border pt-4 text-sm">
            {definition.categories.map((category, i) => {
              const row = result.categories[i];
              return (
                <div key={category.key} className="flex justify-between gap-4">
                  <dt className="min-w-0 break-words text-muted-foreground">
                    {category.label}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {t("pts", { n: row?.points ?? 0 })}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p
            aria-live="polite"
            className="flex items-baseline justify-between gap-4 border-t border-border pt-4"
          >
            <span className="font-semibold">{t("total")}</span>
            <span
              data-testid="preview-total"
              className="text-3xl font-semibold tabular-nums"
            >
              {result.total}
            </span>
          </p>
        </>
      )}
    </section>
  );
}
