"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { groupFill, type Group } from "@/features/groups/client";
import { Link, useRouter } from "@/i18n/navigation";
import { markPlayLogged } from "@/features/pwa";
import {
  normalizePlayerName,
  PlayerPicker,
  type Player,
} from "@/features/players/client";
import type { SheetOption } from "@/features/scoring";
import type { ScoreValue } from "@/features/scoring/client";
import {
  createPlayAction,
  deletePlayAction,
  updatePlayAction,
  type PlayResult,
} from "../actions/play-actions";
import { computePlay } from "../compute";
import { PLAY_LIMITS } from "../schemas";
import { ScoreBoard } from "../components/score-board";
import type { PlayDetail } from "../services/play-service";

type Props = {
  gameId: string;
  gameName: string;
  /** The user's sheets for this game (latest version each). */
  sheets: SheetOption[];
  defaultSheetId: string | null;
  /** Expansions of this game that exist in the catalog. */
  expansions: { id: string; name: string }[];
  /** The user's own players (the picker offers them; new names create players). */
  roster: Player[];
  /** The user's saved groups: one click adds their members to the match. */
  groups: Group[];
  /** Present when editing a saved match. */
  initial?: PlayDetail;
};

/**
 * Each player row keeps a client-only id for its whole life: React keys on it, never
 * on the typed name (a key that changes while typing would drop the focus).
 */
type Row = {
  uid: number;
  /** The roster player picked, or null for a new (typed) name. */
  playerId: string | null;
  name: string;
  values: Record<string, ScoreValue | undefined>;
  manual: number | undefined;
  /** The name field was visited: only then do we explain that it is empty. */
  touched: boolean;
};
let nextUid = 0;
const newRow = (
  name = "",
  values: Row["values"] = {},
  manual?: number,
  playerId: string | null = null,
): Row => ({
  uid: nextUid++,
  playerId,
  name,
  values,
  manual,
  touched: false,
});

const subscribeNothing = () => () => {};

/** The viewer's own date as YYYY-MM-DD. */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
    s.rows.map((r) => [r.playerId, r.name, r.values, r.manual]),
  ]);

const iconButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40";

export function PlayForm({
  gameId,
  gameName,
  sheets,
  defaultSheetId,
  expansions,
  roster,
  groups,
  initial,
}: Props) {
  const t = useTranslations("Plays.form");
  const te = useTranslations("Plays.errors");
  const ts = useTranslations("Scoring");
  const router = useRouter();
  const editing = initial !== undefined;

  const [start] = useState<State>(() => ({
    playedOn: initial?.playedOn ?? "",
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
          newRow(e.name, e.values, e.manualTotal ?? undefined, e.playerId),
        )
      : [newRow(), newRow()],
  }));
  const [playedOn, setPlayedOn] = useState(start.playedOn);
  // Today is the viewer's, not the server's: "" while hydrating, then the local date.
  const today = useSyncExternalStore(subscribeNothing, localToday, () => "");
  const date = playedOn !== "" ? playedOn : today;
  const [duration, setDuration] = useState(start.duration);
  const [notes, setNotes] = useState(start.notes);
  // A live match starts open: friends can be invited and fill their own points.
  const [live, setLive] = useState(false);
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
    date !== "" &&
    computation.ok;

  // Why Save is off, said out loud once the user has touched the form.
  const showProblems =
    rows.some((r) => r.touched && r.name.trim() === "") ||
    !durationValid ||
    !computation.ok;

  // What the OTHER rows of this match already use: a player cannot be picked twice.
  const takenIdsExcept = (uid: number): Set<string> =>
    new Set(
      rows
        .filter((r) => r.uid !== uid && r.playerId !== null)
        .map((r) => r.playerId as string),
    );
  const takenNamesExcept = (uid: number): Set<string> =>
    new Set(
      rows
        .filter((r) => r.uid !== uid && r.name.trim() !== "")
        .map((r) => normalizePlayerName(r.name)),
    );

  const setRow = (uid: number, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  // A group only fills in rows of THIS match; the group itself is never touched.
  function addGroup(group: Group) {
    setRows((cur) => {
      const { fillIndexes, append } = groupFill(
        cur,
        group.members,
        PLAY_LIMITS.maxParticipants,
      );
      const next = cur.map((row, index) => {
        const fill = fillIndexes.find((f) => f.rowIndex === index);
        return fill
          ? { ...row, playerId: fill.member.id, name: fill.member.name }
          : row;
      });
      return [
        ...next,
        ...append.map((m) => newRow(m.name, {}, undefined, m.id)),
      ];
    });
  }

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
        playerId: r.playerId,
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
        playedOn: date,
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
            status: live ? "open" : "closed",
            ...common,
          });
      if (!result.ok) return setFailure(result.error);
      if (editing) {
        setBaseline(snapshot(current));
        setNotice(true);
        return;
      }
      markPlayLogged(); // unlocks the deferred "install the app" invitation
      if (live) {
        router.replace(`/games/${gameId}/plays/${result.playId}/live`);
      } else {
        const usedOthersSheet =
          sheetId !== "" && sheets.some((s) => s.id === sheetId && !s.isMine);
        router.replace(
          usedOthersSheet
            ? `/games/${gameId}/plays/${result.playId}#vote`
            : `/games/${gameId}`,
        );
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
            value={date}
            aria-invalid={date === "" || undefined}
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
              {[true, false].map((mine) => {
                const group = sheets.filter((sheet) => sheet.isMine === mine);
                if (group.length === 0) return null;
                return (
                  <optgroup
                    key={String(mine)}
                    label={t(mine ? "mySheetsGroup" : "communityGroup")}
                  >
                    {group.map((sheet) => (
                      <option key={sheet.id} value={sheet.id}>
                        {sheet.verified
                          ? `${sheet.title} ${t("verifiedSuffix")}`
                          : sheet.title}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
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
                <fieldset className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
                  <legend className="px-1 text-sm font-medium">
                    {t("player", { n: index + 1 })}
                  </legend>
                  <div className="flex items-end gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Label
                        id={`name-${index}-label`}
                        htmlFor={`name-${index}`}
                        className="sr-only"
                      >
                        {t("playerName", { n: index + 1 })}
                      </Label>
                      <PlayerPicker
                        id={`name-${index}`}
                        labelId={`name-${index}-label`}
                        value={{ playerId: row.playerId, name: row.name }}
                        roster={roster}
                        takenIds={takenIdsExcept(row.uid)}
                        takenNames={takenNamesExcept(row.uid)}
                        onChange={(picked) =>
                          setRow(row.uid, {
                            playerId: picked.playerId,
                            name: picked.name,
                          })
                        }
                        onClosed={() => setRow(row.uid, { touched: true })}
                        invalid={row.name.trim() === ""}
                        describedBy={
                          row.touched && row.name.trim() === ""
                            ? `name-${index}-hint`
                            : undefined
                        }
                      />
                      {row.touched && row.name.trim() === "" && (
                        <p
                          id={`name-${index}-hint`}
                          className="text-sm text-destructive"
                        >
                          {t("nameRequired")}
                        </p>
                      )}
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

                  <div className="flex flex-wrap items-center gap-3 text-sm">
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
                    {errors.total && (
                      <p className="w-full text-sm text-destructive">
                        {ts(`fieldErrors.${errors.total}`)}
                      </p>
                    )}
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
          {groups.length > 0 && (
            <div
              role="group"
              aria-label={t("addGroup")}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-sm text-muted-foreground">
                {t("addGroup")}:
              </span>
              {groups.map((group) => (
                <Button
                  key={group.id}
                  type="button"
                  variant="outline"
                  className="h-11 px-4"
                  disabled={group.members.length === 0}
                  aria-label={t("addGroupChoice", { name: group.name })}
                  onClick={() => addGroup(group)}
                >
                  {group.name} ({group.members.length})
                </Button>
              ))}
            </div>
          )}
          <Link
            href="/players"
            className="inline-flex h-11 items-center rounded-lg px-3 text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t("managePlayers")}
          </Link>
          {rows.length >= PLAY_LIMITS.maxParticipants && (
            <p className="text-sm text-muted-foreground">
              {t("maxPlayers", { max: PLAY_LIMITS.maxParticipants })}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="scores-title" className="flex flex-col gap-3">
        <h2 id="scores-title" className="text-lg font-semibold tracking-tight">
          {t("scores")}
        </h2>
        <ScoreBoard
          key={sheetId}
          definition={definition}
          rows={rows.map((row, index) => ({
            uid: row.uid,
            label: row.name.trim() || t("player", { n: index + 1 }),
            values: row.values,
            manual: row.manual,
            errors: computation.participants[index]?.errors ?? {},
          }))}
          onValue={(uid, key, value) =>
            setRows((cur) =>
              cur.map((r) =>
                r.uid === uid
                  ? { ...r, values: { ...r.values, [key]: value } }
                  : r,
              ),
            )
          }
          onManual={(uid, manual) => setRow(uid, { manual })}
        />
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

      {showProblems && (
        <p id="save-hint" className="text-sm text-destructive">
          {t("problems")}
        </p>
      )}

      {!editing && (
        <label className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("live")}</span>
            <span className="block text-muted-foreground">{t("liveHint")}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
            className="relative h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full border border-border bg-muted transition-colors outline-none before:absolute before:top-0.5 before:left-0.5 before:size-5 before:rounded-full before:bg-foreground before:transition-transform before:content-[''] checked:border-primary checked:bg-primary checked:before:translate-x-5 checked:before:bg-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            data-testid="live-toggle"
          />
        </label>
      )}

      <Link
        href={`/games/${gameId}`}
        className="inline-flex h-11 w-fit items-center rounded-lg text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {t("back", { game: gameName })}
      </Link>

      {/* Stays in reach while scoring; on a phone it rides above the bottom navigation. */}
      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-2xl md:border">
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full rounded-xl px-6 text-base sm:w-auto"
          disabled={!canSave}
          aria-describedby={showProblems ? "save-hint" : undefined}
        >
          {pending ? t("saving") : t("save")}
        </Button>
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
