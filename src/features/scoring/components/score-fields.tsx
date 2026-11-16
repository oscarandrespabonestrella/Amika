"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Category, Definition } from "../engine/definition";
import type { FieldErrorCode, ScoreValue } from "../engine/evaluate";

type Props = {
  definition: Definition;
  values: Record<string, ScoreValue | undefined>;
  /** Field errors by category key (from `evaluate`). */
  errors?: Record<string, FieldErrorCode | undefined>;
  onChange: (key: string, value: ScoreValue | undefined) => void;
};

/**
 * One labelled control per category, built from the sheet definition. Shared by the
 * editor preview and (in step 5b) the match form. Calculated categories have no input.
 */
export function ScoreFields({
  definition,
  values,
  errors = {},
  onChange,
}: Props) {
  const t = useTranslations("Scoring");
  const prefix = useId();

  return (
    <div className="flex flex-col gap-4">
      {definition.categories.map((category) => {
        if (category.type === "derived") return null;
        const id = `${prefix}-${category.key}`;
        const error = errors[category.key];
        return (
          <div key={category.key} className="flex flex-col gap-1.5">
            <Control
              id={id}
              category={category}
              value={values[category.key]}
              invalid={error !== undefined}
              describedBy={error ? `${id}-error` : undefined}
              onChange={(value) => onChange(category.key, value)}
            />
            {error && (
              <p id={`${id}-error`} className="text-sm text-destructive">
                {t(`fieldErrors.${error}`)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

type ControlProps = {
  id: string;
  category: Exclude<Category, { type: "derived" }>;
  value: ScoreValue | undefined;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: ScoreValue | undefined) => void;
};

function Control({
  id,
  category,
  value,
  invalid,
  describedBy,
  onChange,
}: ControlProps) {
  const t = useTranslations("Scoring");
  const aria = {
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
  };

  switch (category.type) {
    case "boolean":
      return (
        <label
          htmlFor={id}
          className="flex min-h-11 items-center gap-3 text-sm font-medium"
        >
          <input
            id={id}
            type="checkbox"
            className="size-5 accent-primary"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
            {...aria}
          />
          {category.label}
        </label>
      );
    case "choice":
      return (
        <>
          <Label htmlFor={id}>{category.label}</Label>
          <NativeSelect
            id={id}
            className="h-11"
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              onChange(
                event.target.value === "" ? undefined : event.target.value,
              )
            }
            {...aria}
          >
            <option value="">{t("fields.none")}</option>
            {category.options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </>
      );
    case "set_bonus": {
      const record =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? value
          : {};
      return (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1.5 text-sm font-medium">
            {category.label}
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {category.inputs.map((input) => (
              <div key={input.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-${input.key}`}>{input.label}</Label>
                <NumberEntry
                  id={`${id}-${input.key}`}
                  value={record[input.key]}
                  onChange={(n) => {
                    const next = { ...record };
                    if (n === undefined) delete next[input.key];
                    else next[input.key] = n;
                    onChange(Object.keys(next).length > 0 ? next : undefined);
                  }}
                  {...aria}
                />
              </div>
            ))}
          </div>
        </fieldset>
      );
    }
    default:
      return (
        <>
          <Label htmlFor={id}>{category.label}</Label>
          <NumberEntry
            id={id}
            value={typeof value === "number" ? value : undefined}
            onChange={onChange}
            {...aria}
          />
        </>
      );
  }
}

/**
 * Numeric text input that reports any number it can parse (even a fraction, so the
 * engine can flag it) and `undefined` when empty. Keeps its own text while typing.
 */
function NumberEntry({
  id,
  value,
  onChange,
  ...aria
}: {
  id: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      step={1}
      className="h-11"
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        if (raw.trim() === "") onChange(undefined);
        else {
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(n);
        }
      }}
      {...aria}
    />
  );
}
