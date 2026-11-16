"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Base = { id: string; label: string; className?: string };
type Props = Base &
  (
    | {
        optional: true;
        value: number | undefined;
        onChange: (n: number | undefined) => void;
      }
    | { optional?: false; value: number; onChange: (n: number) => void }
  );

/**
 * A whole-number input. It keeps its own text so a half-typed value ("-") does not
 * fight the user, and only reports values that are integers. A required field keeps
 * the last valid number while its text is invalid (and is flagged as invalid).
 */
export function IntField(props: Props) {
  const { id, label, className } = props;
  const [text, setText] = useState(
    props.value === undefined ? "" : String(props.value),
  );
  const empty = text.trim() === "";
  const number = Number(text);
  const textIsValid = empty ? !!props.optional : Number.isInteger(number);
  const invalid = !textIsValid;
  // If the value changed from outside (a row above was removed, so this field now
  // shows another row), follow it. A half-typed, invalid text is left alone.
  const outOfSync =
    textIsValid && (empty ? props.value !== undefined : number !== props.value);
  const shown = outOfSync ? String(props.value ?? "") : text;

  function change(raw: string) {
    setText(raw);
    if (raw.trim() === "") {
      if (props.optional) props.onChange(undefined);
      return;
    }
    const n = Number(raw);
    if (Number.isInteger(n)) props.onChange(n);
  }

  return (
    <div className={className ?? "flex flex-col gap-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        value={shown}
        aria-invalid={invalid || undefined}
        className="h-11"
        onChange={(event) => change(event.target.value)}
      />
    </div>
  );
}
