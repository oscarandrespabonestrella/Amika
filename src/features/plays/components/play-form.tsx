"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import type { SheetOption } from "@/features/scoring";
import {
  IntField,
  ScoreFields,
  type ScoreValue,
} from "@/features/scoring/client";
import {
  createPlayAction,
  deletePlayAction,
  updatePlayAction,
  type PlayResult,
} from "../actions/play-actions";
import { computePlay } from "../compute";
import { PLAY_LIMITS } from "../schemas";
import type { PlayDetail } from "../services/play-service";

type Props = {
  gameId: string;
  gameName: string;
  /** The user's sheets for this game (latest version each). */
  sheets: SheetOption[];
  defaultSheetId: string | null;
  /** Expansions of this game that exist in the catalog. */
  expansions: { id: string; name: string }[];
  /** Present when editing a saved match. */
  initial?: PlayDetail;
};

/**
 * Each player row keeps a client-only id for its whole life: React keys on it, never
 * on the typed name (a key that changes while typing would drop the focus).
 */
type Row = {
  uid: number;
  name: string;
  values: Record<string, ScoreValue | undefined>;
  manual: number | undefined;
};
let nextUid = 0;
const newRow = (
  name = "",
  values: Row["values"] = {},
  manual?: number,
): Row => ({ uid: nextUid++, name, values, manual });

const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

type State = {
  playedOn: string;
  duration: string;
  notes: string;
  sheetId: string;
  expansionIds: string[];
  rows: Row[];
};

const snapshot = (s: State) =>
  JSON.stringify([
    s.playedOn,
    s.duration,
    s.notes,
    [...s.expansionIds].sort(),
    s.rows.map((r) => [r.name, r.values, r.manual]),
  ]);

const iconButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40";

export function PlayForm({
  gameId,
  gameName,
  sheets,
  defaultSheetId,
  expansions,
  initial,
}: Props) {
  const t = useTranslations("Plays.form");
  const te = useTranslations("Plays.errors");
  const ts = useTranslations("Scoring");
  const router = useRouter();
  const editing = initial !== undefined;

  const [start] = useState<State>(() => ({
    playedOn: initial?.playedOn ?? todayLocal(),
    duration: initial?.durationMinutes?.toString() ?? "",
    notes: initial?.notes ?? "",
    sheetId:
      initial?.sheet?.sheetId ??
      (sheets.some((s) => s.id === defaultSheetId) ? defaultSheetId! : ""),
    expansionIds: (initial?.expansionIds ?? []).filter((id) =>
      expansions.some((e) => e.id === id),
    ),
    rows: initial
      ? initial.entries.map((e) =>
          newRow(e.name, e.values, e.manualTotal ?? undefined),
        )
      : [newRow(), newRow()],
  }));
  const [playedOn, setPlayedOn] = useState(start.playedOn);
  const [duration, setDuration] = useState(start.duration);
  const [notes, setNotes] = useState(start.notes);
  const [sheetId, setSheetId] = useState(start.sheetId);
  const [expansionIds, setExpansionIds] = useState(start.expansionIds);
  const [rows, setRows] = useState<Row[]>(start.rows);
  const [baseline, setBaseline] = useState(() => snapshot(start));
  const [notice, setNotice] = useState(false);
  const [failure, setFailure] = useState<
    Extract<PlayResult, { ok: false }>["error"] | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  // Stored expansions that are not offered here are kept, not silently dropped.
  const preservedExpansionIds = (initial?.expansionIds ?? []).filter(
    (id) => !expansions.some((e) => e.id === id),
  );

  const definition = editing
    ? (initial.sheet?.definition ?? null)
    : (sheets.find((s) => s.id === sheetId)?.definition ?? null);

  const computation = useMemo(
    () =>
      computePlay(
        definition,
        rows.map((r) => ({
          name: r.name,
          values: r.values,
          manualTotal: r.manual ?? null,
        })),
      ),
    [definition, rows],
  );

  const durationNumber = duration === "" ? null : Number(duration);
  const durationValid =
    durationNumber === null ||
    (Number.isInteger(durationNumber) &&
      durationNumber >= 1 &&
      durationNumber <= PLAY_LIMITS.maxDuration);
  const namesFilled = rows.every((r) => r.name.trim() !== "");
  const current: State = {
    playedOn,
    duration,
    notes,
    sheetId,
    expansionIds,
    rows,
  };
  const dirty = !editing || snapshot(current) !== baseline;
  const canSave =
    !pending &&
    dirty &&
    namesFilled &&
    durationValid &&
    playedOn !== "" &&
    computation.ok;

  const setRow = (uid: number, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  function changeSheet(next: string) {
    setSheetId(next);
    // Values belong to a sheet: a different sheet starts from a clean slate.
    setRows((cur) => cur.map((r) => ({ ...r, values: {}, manual: undefined })));
  }

  function save() {
    setFailure(null);
    setNotice(false);
    startTransition(async () => {
      const participants = rows.map((r) => ({
        name: r.name,
        ...(definition
          ? {
              values: Object.fromEntries(
                Object.entries(r.values).filter(([, v]) => v !== undefined),
              ),
            }
          : { manualTotal: r.manual ?? null }),
      }));
      const common = {
        playedOn,
        durationMinutes: durationNumber,
        notes,
        expansionIds: [...expansionIds, ...preservedExpansionIds],
        participants,
      };

      const result = editing
        ? await updatePlayAction({ playId: initial.id, ...common })
        : await createPlayAction({
            gameId,
            sheetId: sheetId || null,
            ...common,
          });
      if (!result.ok) return setFailure(result.error);
      if (editing) {
        setBaseline(snapshot(current));
        setNotice(true);
      } else {
        router.replace(`/games/${gameId}`);
      }
    });
  }

  function remove() {
    if (!initial) return;
    setFailure(null);
    startTransition(async () => {
      const result = await deletePlayAction(initial.id);
      if (result.ok) router.replace(`/games/${gameId}`);
      else setFailure(result.error);
    });
  }

  return (
    <form
      className="flex max-w-3xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) save();
      }}
    >
      <p className="text-muted-foreground">{t("intro", { game: gameName })}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="play-date">{t("date")}</Label>
          <Input
            id="play-date"
            type="date"
            className="h-11"
            value={playedOn}
            aria-invalid={playedOn === "" || undefined}
            onChange={(event) => setPlayedOn(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="play-duration">{t("duration")}</Label>
          <Input
            id="play-duration"
            type="number"
            inputMode="numeric"
            className="h-11"
            value={duration}
            aria-invalid={!durationValid || undefined}
            onChange={(event) => setDuration(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="play-sheet">{t("sheet")}</Label>
        <NativeSelect
          id="play-sheet"
          className="h-11"
          disabled={editing}
          value={editing ? "locked" : sheetId}
          onChange={(event) => changeSheet(event.target.value)}
        >
          {editing ? (
            <option value="locked">
              {initial.sheetTitle ?? t("manualSheet")}
            </option>
          ) : (
            <>
              <option value="">{t("manualSheet")}</option>
              {sheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.title}
                </option>
              ))}
            </>
          )}
        </NativeSelect>
        {editing && (
          <p className="text-sm text-muted-foreground">{t("sheetLocked")}</p>
        )}
      </div>

      {expansions.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">
            {t("expansions")}
          </legend>
          {expansions.map((expansion) => (
            <label
              key={expansion.id}
              className="flex min-h-11 items-center gap-3 text-sm"
            >
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={expansionIds.includes(expansion.id)}
                onChange={(event) =>
                  setExpansionIds((cur) =>
                    event.target.checked
                      ? [...cur, expansion.id]
                      : cur.filter((id) => id !== expansion.id),
                  )
                }
              />
              {expansion.name}
            </label>
          ))}
        </fieldset>
      )}

      <section aria-labelledby="players-title" className="flex flex-col gap-3">
        <h2 id="players-title" className="text-lg font-semibold tracking-tight">
          {t("players")}
        </h2>
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const result = computation.participants[index];
            const errors = result?.errors ?? {};
            return (
              <li key={row.uid}>
                <fieldset className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
                  <legend className="px-1 text-sm font-medium">
                    {t("player", { n: index + 1 })}
                  </legend>
                  <div className="flex items-end gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Label htmlFor={`name-${row.uid}`}>
                        {t("playerName", { n: index + 1 })}
                      </Label>
                      <Input
                        id={`name-${row.uid}`}
                        className="h-11"
                        value={row.name}
                        maxLength={PLAY_LIMITS.maxName}
                        aria-invalid={row.name.trim() === "" || undefined}
                        onChange={(event) =>
                          setRow(row.uid, { name: event.target.value })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className={iconButton}
                      aria-label={t("removePlayer", { n: index + 1 })}
                      disabled={rows.length <= 1}
                      onClick={() =>
                        setRows((cur) => cur.filter((r) => r.uid !== row.uid))
                      }
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>

                  {definition ? (
                    <ScoreFields
                      key={`${row.uid}-${sheetId}`}
                      definition={definition}
                      values={row.values}
                      errors={errors}
                      onChange={(key, value) =>
                        setRow(row.uid, {
                          values: { ...row.values, [key]: value },
                        })
                      }
                    />
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <IntField
                        optional
                        id={`manual-${row.uid}`}
                        label={t("manualTotal")}
                        value={row.manual}
                        onChange={(manual) => setRow(row.uid, { manual })}
                      />
                      {errors.manual && (
                        <p className="text-sm text-destructive">
                          {ts(`fieldErrors.${errors.manual}`)}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
                    <span>
                      {t("total")}:{" "}
                      <strong
                        className="tabular-nums"
                        data-testid={`total-${index}`}
                      >
                        {result?.total ?? t("noTotal")}
                      </strong>
                    </span>
                    {result?.rank != null && (
                      <Badge variant="outline">
                        {t("rank", { n: result.rank })}
                      </Badge>
                    )}
                    {result?.isWinner && <Badge>{t("winner")}</Badge>}
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={rows.length >= PLAY_LIMITS.maxParticipants}
            onClick={() => setRows((cur) => [...cur, newRow()])}
          >
            <Plus className="size-4" aria-hidden />
            {t("addPlayer")}
          </Button>
          {rows.length >= PLAY_LIMITS.maxParticipants && (
            <p className="text-sm text-muted-foreground">
              {t("maxPlayers", { max: PLAY_LIMITS.maxParticipants })}
            </p>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="play-notes">{t("notes")}</Label>
        <Textarea
          id="play-notes"
          rows={3}
          maxLength={PLAY_LIMITS.maxNotes}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

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
          href={`/games/${gameId}`}
          className="inline-flex h-11 items-center rounded-lg px-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t("back", { game: gameName })}
        </Link>
        <div aria-live="polite" className="text-sm">
          {notice && <span className="text-success">{t("saved")}</span>}
          {failure && (
            <span role="alert" className="text-destructive">
              {te(failure)}
            </span>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {!confirmDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-4"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              {t("delete")}
            </Button>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {t("deleteConfirm")}
              </p>
              <Button
                type="button"
                variant="destructive"
                className="h-11 px-4"
                disabled={pending}
                onClick={remove}
              >
                {t("deleteYes")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                disabled={pending}
                onClick={() => setConfirmDelete(false)}
              >
                {t("deleteNo")}
              </Button>
            </>
          )}
        </div>
      )}
    </form>
  );
}
