"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Link, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  createSheetAction,
  renameSheetAction,
  saveSheetVersionAction,
  type ScoringResult,
} from "../actions/sheet-actions";
import { canAddType, moveItem, newCategory, relabelCategory } from "../draft";
import {
  CATEGORY_TYPES,
  type Category,
  type CategoryType,
  type Definition,
} from "../engine/definition";
import { validateDefinition, type DefinitionIssue } from "../engine/validate";
import { SHEET_TITLE_MAX } from "../schemas";
import { CategoryEditor } from "./category-editor";
import { ScorePreview } from "./score-preview";

type Props = {
  gameId: string;
  gameName: string;
  /** Present when editing an existing sheet; absent when creating one. */
  initial?: {
    sheetId: string;
    title: string;
    locale: string;
    definition: Definition;
    version: number;
  };
};

type Failure = Extract<ScoringResult, { ok: false }>;

/**
 * Each row keeps a client-only id for its whole life. React keys on it, not on the
 * category key: an unsaved category's key follows its label, and a changing React
 * key would remount the card (and drop focus) on every keystroke.
 */
type Row = { uid: number; category: Category };
let nextUid = 0;
const toRow = (category: Category): Row => ({ uid: nextUid++, category });

export function SheetEditor({ gameId, gameName, initial }: Props) {
  const t = useTranslations("Scoring.editor");
  const tt = useTranslations("Scoring.types");
  const ti = useTranslations("Scoring.issues");
  const tf = useTranslations("Scoring.fieldMessages");
  const te = useTranslations("Scoring.errors");
  const uiLocale = useLocale();
  const router = useRouter();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [locale, setLocale] = useState(initial?.locale ?? uiLocale);
  const [rows, setRows] = useState<Row[]>(() =>
    (initial?.definition.categories ?? []).map(toRow),
  );
  const categories = useMemo(() => rows.map((row) => row.category), [rows]);
  const [newType, setNewType] = useState<CategoryType>("number");
  // Keys already saved in a version never change; new categories derive theirs from the label.
  const [frozenKeys, setFrozenKeys] = useState<ReadonlySet<string>>(
    () => new Set(initial?.definition.categories.map((c) => c.key) ?? []),
  );
  const [saved, setSaved] = useState(() => ({
    title: initial?.title ?? "",
    locale: initial?.locale ?? uiLocale,
    json: JSON.stringify(initial?.definition.categories ?? []),
    version: initial?.version ?? 0,
  }));
  const [notice, setNotice] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();

  const languageNames = useMemo(
    () => new Intl.DisplayNames([uiLocale], { type: "language" }),
    [uiLocale],
  );

  const definition = useMemo(
    () => ({ schemaVersion: 1 as const, categories }),
    [categories],
  );
  const validation = useMemo(
    () => validateDefinition(definition),
    [definition],
  );

  const keys = categories.map((c) => c.key);
  const json = JSON.stringify(categories);
  const dirty =
    !initial ||
    title.trim() !== saved.title ||
    locale !== saved.locale ||
    json !== saved.json;
  const canSave =
    !pending &&
    dirty &&
    validation.ok &&
    title.trim() !== "" &&
    categories.length > 0;

  // --- problems, per category and global -----------------------------------------
  const { byCategory, general } = useMemo(() => {
    const by = new Map<number, Set<string>>();
    const global = new Set<string>();
    if (validation.ok) return { byCategory: by, general: global };

    const message = (issue: DefinitionIssue) =>
      issue.code === "shape" &&
      issue.message &&
      tf.has(issue.message as "required")
        ? tf(issue.message as "required")
        : ti(issue.code);

    for (const issue of validation.issues) {
      const fromPath = /^categories\.(\d+)/.exec(issue.path ?? "")?.[1];
      const index =
        fromPath !== undefined
          ? Number(fromPath)
          : issue.categoryKey !== undefined
            ? keys.indexOf(issue.categoryKey)
            : -1;
      const text = message(issue);
      if (index >= 0) by.set(index, (by.get(index) ?? new Set()).add(text));
      else if (categories.length > 0) global.add(text);
    }
    return { byCategory: by, general: global };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validation, categories.length, ti, tf]);

  // --- editing -------------------------------------------------------------------
  function addCategory() {
    if (!canAddType(newType, keys)) return;
    setRows((current) => [
      ...current,
      toRow(
        newCategory(
          newType,
          t("newCategoryLabel"),
          current.map((row) => row.category.key),
        ),
      ),
    ]);
  }

  const replaceAt = (index: number, next: Category) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, category: next } : row)),
    );

  // --- saving --------------------------------------------------------------------
  function save() {
    setFailure(null);
    setNotice(null);
    startTransition(async () => {
      const cleanTitle = title.trim();
      if (!initial) {
        const result = await createSheetAction({
          gameId,
          title: cleanTitle,
          locale,
          definition,
        });
        if (result.ok)
          router.replace(`/games/${gameId}/sheets/${result.sheetId}`);
        else setFailure(result);
        return;
      }

      if (cleanTitle !== saved.title || locale !== saved.locale) {
        const renamed = await renameSheetAction({
          sheetId: initial.sheetId,
          title: cleanTitle,
          locale,
        });
        if (!renamed.ok) return setFailure(renamed);
      }

      let version = saved.version;
      if (json !== saved.json) {
        const result = await saveSheetVersionAction({
          sheetId: initial.sheetId,
          definition,
          baseVersion: saved.version,
        });
        if (!result.ok) return setFailure(result);
        version = result.version;
      }
      setSaved({ title: cleanTitle, locale, json, version });
      setFrozenKeys(new Set(keys));
      setNotice(version);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form
        className="flex min-w-0 flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) save();
        }}
      >
        <p className="text-muted-foreground">
          {t("intro", { game: gameName })}
        </p>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sheet-title">{t("name")}</Label>
            <Input
              id="sheet-title"
              value={title}
              maxLength={SHEET_TITLE_MAX}
              className="h-11"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sheet-locale">{t("language")}</Label>
            <NativeSelect
              id="sheet-locale"
              className="h-11"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
            >
              {routing.locales.map((code) => (
                <option key={code} value={code}>
                  {languageNames.of(code) ?? code}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <section
          aria-labelledby="categories-title"
          className="flex flex-col gap-3"
        >
          <h2
            id="categories-title"
            className="text-lg font-semibold tracking-tight"
          >
            {t("categories")}
          </h2>

          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("noCategories")}</p>
          )}

          <ol className="flex flex-col gap-3">
            {rows.map(({ uid, category }, index) => (
              <CategoryEditor
                key={uid}
                category={category}
                index={index}
                count={categories.length}
                others={categories.filter((_, i) => i !== index)}
                problems={[...(byCategory.get(index) ?? [])]}
                onLabel={(label) =>
                  setRows((current) => {
                    const next = relabelCategory(
                      current.map((row) => row.category),
                      index,
                      label,
                      frozenKeys,
                    );
                    return current.map((row, i) => ({
                      ...row,
                      category: next[i],
                    }));
                  })
                }
                onChange={(next) => replaceAt(index, next)}
                onMove={(delta) =>
                  setRows((current) => moveItem(current, index, delta))
                }
                onRemove={() =>
                  setRows((current) => current.filter((_, i) => i !== index))
                }
              />
            ))}
          </ol>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-type">{t("categoryType")}</Label>
              <NativeSelect
                id="new-type"
                className="h-11 w-56"
                value={newType}
                onChange={(event) =>
                  setNewType(event.target.value as CategoryType)
                }
              >
                {CATEGORY_TYPES.map((type) => (
                  <option
                    key={type}
                    value={type}
                    disabled={!canAddType(type, keys)}
                  >
                    {tt(type)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              disabled={categories.length >= 40 || !canAddType(newType, keys)}
              onClick={addCategory}
            >
              <Plus className="size-4" aria-hidden />
              {t("addCategory")}
            </Button>
          </div>
        </section>

        {general.size > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
          >
            <p className="font-medium">{t("problems")}</p>
            <ul className="mt-1 list-disc pl-5">
              {[...general].map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="lg"
            className="h-11 px-6"
            disabled={!canSave}
          >
            {pending ? t("saving") : t("save")}
          </Button>
          <Link
            href={`/games/${gameId}/sheets`}
            className="inline-flex h-11 items-center rounded-lg px-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t("back")}
          </Link>
          <div aria-live="polite" className="text-sm">
            {notice !== null && (
              <span className="text-success">{t("saved", { n: notice })}</span>
            )}
            {failure && (
              <span role="alert" className="text-destructive">
                {te(failure.error)}
                {failure.error === "conflict" && (
                  <button
                    type="button"
                    className="ml-2 underline underline-offset-4"
                    onClick={() => router.refresh()}
                  >
                    {t("reload")}
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
      </form>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <ScorePreview
          definition={validation.ok ? validation.definition : null}
        />
      </div>
    </div>
  );
}
