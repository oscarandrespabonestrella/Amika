"use client";

import { Dices, ThumbsUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { usePoll } from "../components/use-poll";
import { guestNameSchema } from "../schemas";

type GuestGame = {
  id: string;
  name: string;
  cover: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlaytime: number | null;
  maxPlaytime: number | null;
  votes: number;
  voters: string[];
  mine: boolean;
};

type GuestState = {
  night: {
    title: string;
    startsOn: string;
    hostName: string | null;
    status: string;
  };
  games: GuestGame[];
  guest: { name: string } | null;
};

type ErrorKey =
  | "inactive"
  | "rate"
  | "full"
  | "closed"
  | "invalidName"
  | "needName"
  | "failed";

const ERROR_BY_CODE: Record<string, ErrorKey> = {
  link_invalid: "inactive",
  not_found: "inactive",
  rate_limited: "rate",
  limit: "full",
  closed: "closed",
  invalid: "invalidName",
  no_guest: "needName",
};

type Outcome =
  { ok: true; state: GuestState | null } | { ok: false; error: ErrorKey };

/** The only door to the data: the guest route. The cookie travels by itself (same origin). */
async function call(
  token: string,
  body?: Record<string, string>,
): Promise<Outcome> {
  try {
    const res = await fetch(`/api/nights/guest/${encodeURIComponent(token)}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const code =
        json && typeof json === "object" && "error" in json
          ? String((json as { error: unknown }).error)
          : "";
      return { ok: false, error: ERROR_BY_CODE[code] ?? "failed" };
    }
    const state =
      json && typeof json === "object" && "night" in json
        ? (json as GuestState)
        : null;
    return { ok: true, state };
  } catch {
    return { ok: false, error: "failed" };
  }
}

function range(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min === null || max === null || min === max) return String(min ?? max);
  return `${min}–${max}`;
}

/** /n/:token — a guest without an account reads the night and votes. */
export function GuestNight({ token }: { token: string }) {
  const t = useTranslations("Nights.guest");
  const locale = useLocale();
  const [state, setState] = useState<GuestState | null>(null);
  const [inactive, setInactive] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [wantsVote, setWantsVote] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Latest GET wins: a slow poll that started before a vote must not overwrite newer state.
  const requestId = useRef(0);
  const voting = useRef(false);
  const submitting = useRef(false);

  const apply = useCallback((out: Outcome): boolean => {
    if (out.ok) {
      if (out.state) setState(out.state);
      return true;
    }
    if (out.error === "inactive") setInactive(true);
    else setError(out.error);
    return false;
  }, []);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const out = await call(token);
    if (id !== requestId.current) return;
    if (out.ok && out.state) {
      setState(out.state);
      setError((e) => (e === "needName" ? e : null));
    } else if (!out.ok && out.error === "inactive") setInactive(true);
    else if (!out.ok) setError((e) => e ?? out.error);
  }, [token]);

  useEffect(() => {
    // Initial load: the state lives on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  usePoll(() => {
    if (!inactive && !busy) void refresh();
  });

  async function vote(nightGameId: string) {
    if (voting.current) return;
    voting.current = true;
    setError(null);
    setNotice("");
    setBusy(true);
    const out = await call(token, { action: "vote", nightGameId });
    if (out.ok) {
      await refresh();
      setNotice(t("updated"));
    } else if (out.error === "needName") {
      // The cookie is gone (cleared, or another browser): ask for the name again.
      setState((s) => (s ? { ...s, guest: null } : s));
      setWantsVote(nightGameId);
      setError("needName");
    } else apply(out);
    voting.current = false;
    setBusy(false);
  }

  function askName(nightGameId: string) {
    setWantsVote(nightGameId);
    setError("needName");
    nameRef.current?.focus();
  }

  async function submitName(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const parsed = guestNameSchema.safeParse(name);
    if (!parsed.success) {
      setError("invalidName");
      return;
    }
    submitting.current = true;
    setError(null);
    setNotice("");
    setBusy(true);
    const joining = !state?.guest;
    const out = await call(token, {
      action: joining ? "join" : "rename",
      name: parsed.data,
    });
    if (apply(out)) {
      await refresh();
      setName("");
      setRenaming(false);
      const pending = wantsVote;
      setWantsVote(null);
      submitting.current = false;
      if (joining && pending) await vote(pending);
    }
    submitting.current = false;
    setBusy(false);
  }

  if (inactive) {
    return (
      <Shell>
        <p
          role="alert"
          className="rounded-2xl border border-border bg-card p-6 text-center font-medium"
        >
          {t("errors.inactive")}
        </p>
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <p role="status" className="text-muted-foreground">
          {error ? t(`errors.${error}`) : t("loading")}
        </p>
      </Shell>
    );
  }

  const open = state.night.status === "open";
  const guest = state.guest;
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(`${state.night.startsOn}T00:00:00Z`));
  const showForm = open && (!guest || renaming);

  return (
    <Shell>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {state.night.title}
        </h1>
        <p className="text-muted-foreground">
          {date} ·{" "}
          {t("hostedBy", { host: state.night.hostName || t("someone") })}
        </p>
        {!open && (
          <p className="text-sm text-muted-foreground">{t("closedNotice")}</p>
        )}
      </header>

      <div aria-live="assertive" role="alert" className="empty:hidden">
        {error && (
          <p className="text-sm text-destructive">{t(`errors.${error}`)}</p>
        )}
      </div>
      <p aria-live="polite" role="status" className="sr-only">
        {notice}
      </p>

      {open && guest && !renaming && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3">
          <p className="text-sm">{t("youAre", { name: guest.name })}</p>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            onClick={() => {
              setName(guest.name);
              setRenaming(true);
            }}
          >
            {t("changeName")}
          </Button>
        </div>
      )}

      {open && (
        <form
          onSubmit={submitName}
          hidden={!showForm}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
        >
          {!guest && (
            <>
              <h2 className="font-semibold">{t("nameTitle")}</h2>
              <p className="text-sm text-muted-foreground">
                {wantsVote ? t("needNameToVote") : t("nameHint")}
              </p>
            </>
          )}
          <label htmlFor="guest-name" className="text-sm font-medium">
            {t("nameLabel")}
          </label>
          <Input
            id="guest-name"
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            autoComplete="nickname"
            className="h-11"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="min-h-11 flex-1">
              {guest ? t("saveName") : busy ? t("joining") : t("join")}
            </Button>
            {guest && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setRenaming(false)}
              >
                {t("cancel")}
              </Button>
            )}
          </div>
        </form>
      )}

      <section aria-labelledby="guest-games" className="flex flex-col gap-3">
        <h2 id="guest-games" className="font-semibold">
          {t("gamesTitle")}
        </h2>
        {state.games.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noGames")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.games.map((g) => {
              const players = range(g.minPlayers, g.maxPlayers);
              const minutes = range(g.minPlaytime, g.maxPlaytime);
              const facts = [
                players && t("players", { range: players }),
                minutes && t("minutes", { range: minutes }),
              ].filter(Boolean);
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
                >
                  <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-tint text-tint-foreground">
                    {g.cover ? (
                      // External hotlinked image (BGG): next/image optimization is not applicable.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={g.cover}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="size-full object-cover"
                      />
                    ) : (
                      <Dices className="size-7" aria-hidden />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-semibold text-balance">{g.name}</span>
                    {facts.length > 0 && (
                      <span className="text-sm text-muted-foreground">
                        {facts.join(" · ")}
                      </span>
                    )}
                    <span className="text-sm text-muted-foreground">
                      {g.votes > 0
                        ? t("votedBy", {
                            count: g.votes,
                            names: g.voters
                              .map((n) => n || t("someone"))
                              .join(", "),
                          })
                        : t("noVotes")}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-pressed={g.mine}
                    aria-label={t("voteFor", { name: g.name })}
                    disabled={!open || busy}
                    onClick={() => (guest ? vote(g.id) : askName(g.id))}
                    className={cn(
                      "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
                      g.mine
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-muted",
                    )}
                  >
                    <ThumbsUp className="size-4" aria-hidden />
                    <span aria-hidden>{g.votes}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Nights.guest");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-1 flex-col gap-6">{children}</div>
      <footer className="border-t border-border pt-4 text-center">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          {t("what")}
        </Link>
      </footer>
    </main>
  );
}
