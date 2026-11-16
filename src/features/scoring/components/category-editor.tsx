"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { slugifyKey } from "../draft";
import { DERIVED_OPS, SCORE_LIMITS, type Category } from "../engine/definition";
import { IntField } from "./int-field";

type Props = {
  category: Category;
  index: number;
  count: number;
  /** Every other category: the candidates a calculated category can use. */
  others: Category[];
  /** Already translated problems for this category. */
  problems: string[];
  onLabel: (label: string) => void;
  onChange: (next: Category) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
};

const iconButton =
  "inline-flex size-11 items-center justify-center rounded-lg border border-border bg-background outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40";

export function CategoryEditor({
  category,
  index,
  count,
  others,
  problems,
  onLabel,
  onChange,
  onMove,
  onRemove,
}: Props) {
  const t = useTranslations("Scoring.editor");
  const tt = useTranslations("Scoring.types");
  const id = useId();
  const name = category.label || tt(category.type);

  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
          <Label htmlFor={`${id}-label`}>
            {t("label")}
            <Badge variant="secondary" className="ml-1">
              {tt(category.type)}
            </Badge>
          </Label>
          <Input
            id={`${id}-label`}
            value={category.label}
            maxLength={SCORE_LIMITS.maxLabel}
            className="h-11"
            aria-invalid={category.label.trim() === "" || undefined}
            onChange={(event) => onLabel(event.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={iconButton}
            aria-label={t("moveUp", { label: name })}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label={t("moveDown", { label: name })}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label={t("remove", { label: name })}
            onClick={onRemove}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <TypeFields
        idBase={id}
        category={category}
        others={others}
        onChange={onChange}
      />

      <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={category.scoring}
          onChange={(event) =>
            onChange({ ...category, scoring: event.target.checked })
          }
        />
        {t("counts")}
      </label>

      {problems.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-1 text-sm text-destructive"
        >
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function RemoveItem({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={iconButton}
      aria-label={label}
      onClick={onClick}
    >
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}

function AddItem({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 w-fit px-4"
      disabled={disabled}
      onClick={onClick}
    >
      <Plus className="size-4" aria-hidden />
      {label}
    </Button>
  );
}

function TypeFields({
  idBase,
  category,
  others,
  onChange,
}: {
  idBase: string;
  category: Category;
  others: Category[];
  onChange: (next: Category) => void;
}) {
  const t = useTranslations("Scoring.editor");
  const to = useTranslations("Scoring.ops");
  const row = "flex flex-wrap items-end gap-3";

  switch (category.type) {
    case "number":
      return (
        <div className={row}>
          <IntField
            optional
            id={`${idBase}-min`}
            label={t("min")}
            value={category.min}
            onChange={(min) => onChange({ ...category, min })}
          />
          <IntField
            optional
            id={`${idBase}-max`}
            label={t("max")}
            value={category.max}
            onChange={(max) => onChange({ ...category, max })}
          />
        </div>
      );
    case "count_times":
      return (
        <div className={row}>
          <IntField
            id={`${idBase}-each`}
            label={t("pointsEach")}
            value={category.pointsEach}
            onChange={(pointsEach) => onChange({ ...category, pointsEach })}
          />
          <IntField
            optional
            id={`${idBase}-max`}
            label={t("max")}
            value={category.max}
            onChange={(max) => onChange({ ...category, max })}
          />
        </div>
      );
    case "per_n":
      return (
        <div className={row}>
          <IntField
            id={`${idBase}-n`}
            label={t("n")}
            value={category.n}
            onChange={(n) => onChange({ ...category, n: Math.max(1, n) })}
          />
          <IntField
            id={`${idBase}-per`}
            label={t("pointsPer")}
            value={category.pointsPer}
            onChange={(pointsPer) => onChange({ ...category, pointsPer })}
          />
          <IntField
            optional
            id={`${idBase}-max`}
            label={t("max")}
            value={category.max}
            onChange={(max) => onChange({ ...category, max })}
          />
        </div>
      );
    case "boolean":
      return (
        <div className={row}>
          <IntField
            id={`${idBase}-points`}
            label={t("points")}
            value={category.points}
            onChange={(points) => onChange({ ...category, points })}
          />
        </div>
      );
    case "choice":
      return (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">{t("options")}</legend>
          {category.options.map((option, i) => (
            <div key={option.key} className={row}>
              <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1.5">
                <Label htmlFor={`${idBase}-o${i}`}>{t("optionLabel")}</Label>
                <Input
                  id={`${idBase}-o${i}`}
                  className="h-11"
                  value={option.label}
                  maxLength={SCORE_LIMITS.maxLabel}
                  aria-invalid={option.label.trim() === "" || undefined}
                  onChange={(event) =>
                    onChange({
                      ...category,
                      options: category.options.map((o, j) =>
                        j === i ? { ...o, label: event.target.value } : o,
                      ),
                    })
                  }
                />
              </div>
              <IntField
                id={`${idBase}-op${i}`}
                label={t("optionPoints")}
                value={option.points}
                onChange={(points) =>
                  onChange({
                    ...category,
                    options: category.options.map((o, j) =>
                      j === i ? { ...o, points } : o,
                    ),
                  })
                }
              />
              <RemoveItem
                label={t("removeItem")}
                onClick={() =>
                  category.options.length > 1 &&
                  onChange({
                    ...category,
                    options: category.options.filter((_, j) => j !== i),
                  })
                }
              />
            </div>
          ))}
          <AddItem
            label={t("addOption")}
            disabled={category.options.length >= SCORE_LIMITS.maxOptions}
            onClick={() =>
              onChange({
                ...category,
                options: [
                  ...category.options,
                  {
                    key: slugifyKey(
                      "option",
                      category.options.map((o) => o.key),
                    ),
                    label: String(category.options.length + 1),
                    points: 0,
                  },
                ],
              })
            }
          />
        </fieldset>
      );
    case "table":
      return (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">{t("rows")}</legend>
          {category.rows.map((tableRow, i) => (
            <div key={i} className={row}>
              <IntField
                id={`${idBase}-v${i}`}
                label={t("rowValue")}
                value={tableRow.value}
                onChange={(value) =>
                  onChange({
                    ...category,
                    rows: category.rows.map((r, j) =>
                      j === i ? { ...r, value } : r,
                    ),
                  })
                }
              />
              <IntField
                id={`${idBase}-p${i}`}
                label={t("rowPoints")}
                value={tableRow.points}
                onChange={(points) =>
                  onChange({
                    ...category,
                    rows: category.rows.map((r, j) =>
                      j === i ? { ...r, points } : r,
                    ),
                  })
                }
              />
              <RemoveItem
                label={t("removeItem")}
                onClick={() =>
                  category.rows.length > 1 &&
                  onChange({
                    ...category,
                    rows: category.rows.filter((_, j) => j !== i),
                  })
                }
              />
            </div>
          ))}
          <AddItem
            label={t("addRow")}
            disabled={category.rows.length >= SCORE_LIMITS.maxTableRows}
            onClick={() =>
              onChange({
                ...category,
                rows: [
                  ...category.rows,
                  {
                    value: Math.max(...category.rows.map((r) => r.value)) + 1,
                    points: 0,
                  },
                ],
              })
            }
          />
        </fieldset>
      );
    case "set_bonus":
      return (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">{t("inputs")}</legend>
          {category.inputs.map((input, i) => (
            <div key={input.key} className={row}>
              <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1.5">
                <Label htmlFor={`${idBase}-i${i}`}>{t("inputLabel")}</Label>
                <Input
                  id={`${idBase}-i${i}`}
                  className="h-11"
                  value={input.label}
                  maxLength={SCORE_LIMITS.maxLabel}
                  aria-invalid={input.label.trim() === "" || undefined}
                  onChange={(event) =>
                    onChange({
                      ...category,
                      inputs: category.inputs.map((x, j) =>
                        j === i ? { ...x, label: event.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
              <RemoveItem
                label={t("removeItem")}
                onClick={() =>
                  category.inputs.length > 2 &&
                  onChange({
                    ...category,
                    inputs: category.inputs.filter((_, j) => j !== i),
                  })
                }
              />
            </div>
          ))}
          <AddItem
            label={t("addInput")}
            disabled={category.inputs.length >= SCORE_LIMITS.maxSetInputs}
            onClick={() =>
              onChange({
                ...category,
                inputs: [
                  ...category.inputs,
                  {
                    key: slugifyKey(
                      "counter",
                      category.inputs.map((x) => x.key),
                    ),
                    label: String(category.inputs.length + 1),
                  },
                ],
              })
            }
          />
          <IntField
            id={`${idBase}-set`}
            label={t("perSet")}
            value={category.perSet}
            onChange={(perSet) => onChange({ ...category, perSet })}
          />
        </fieldset>
      );
    case "derived": {
      const fixedRefs = category.op === "floor_div";
      const setRefs = (refs: string[]) => onChange({ ...category, refs });
      return (
        <div className="flex flex-col gap-3">
          <div className="flex max-w-xs flex-col gap-1.5">
            <Label htmlFor={`${idBase}-op`}>{t("op")}</Label>
            <NativeSelect
              id={`${idBase}-op`}
              className="h-11"
              value={category.op}
              onChange={(event) => {
                const op = event.target.value as (typeof DERIVED_OPS)[number];
                onChange({
                  ...category,
                  op,
                  refs:
                    op === "floor_div"
                      ? category.refs.slice(0, 2)
                      : category.refs,
                });
              }}
            >
              {DERIVED_OPS.map((op) => (
                <option key={op} value={op}>
                  {to(op)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">{t("refs")}</legend>
            {category.refs.map((ref, i) => (
              <div key={i} className={row}>
                <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1.5">
                  <Label htmlFor={`${idBase}-r${i}`}>{t("ref")}</Label>
                  <NativeSelect
                    id={`${idBase}-r${i}`}
                    className="h-11"
                    value={ref}
                    onChange={(event) =>
                      setRefs(
                        category.refs.map((r, j) =>
                          j === i ? event.target.value : r,
                        ),
                      )
                    }
                  >
                    {/* A ref to a category that no longer exists stays visible so it can be fixed. */}
                    {!others.some((o) => o.key === ref) && (
                      <option value={ref}>{ref}</option>
                    )}
                    {others.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label || o.key}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                {!fixedRefs && category.refs.length > 2 && (
                  <RemoveItem
                    label={t("removeItem")}
                    onClick={() =>
                      setRefs(category.refs.filter((_, j) => j !== i))
                    }
                  />
                )}
              </div>
            ))}
            {!fixedRefs && (
              <AddItem
                label={t("addRef")}
                disabled={
                  category.refs.length >= SCORE_LIMITS.maxRefs ||
                  others.length === 0
                }
                onClick={() => setRefs([...category.refs, others[0].key])}
              />
            )}
          </fieldset>
        </div>
      );
    }
  }
}
