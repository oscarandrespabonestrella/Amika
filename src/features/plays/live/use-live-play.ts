"use client";

import { useSession } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getLivePlayAction } from "../actions/sharing-actions";
import {
  applyChange,
  type LiveChange,
  type LivePlay,
} from "./merge-play-state";

const POLL_MS = 10_000;
const TOKEN_REFRESH_MS = 45_000;
const TABLES = [
  "plays",
  "play_participants",
  "play_scores",
  "play_members",
] as const;

/**
 * The live state of a match: Realtime changes (RLS-checked by the database) applied on top
 * of the first read, plus a fresh read when a change cannot be placed and every few seconds
 * as a fallback if the socket is down. Cleans up its channel on unmount.
 */
export function useLivePlay(initial: LivePlay) {
  const { session } = useSession();
  const [play, setPlay] = useState(initial);
  const [connected, setConnected] = useState(false);
  const refetching = useRef(false);
  const supabase = useMemo(
    () =>
      createSupabaseBrowserClient(
        async () => (await session?.getToken()) ?? null,
      ),
    [session],
  );

  useEffect(() => {
    if (!session) return;
    let alive = true;

    const refetch = async () => {
      if (refetching.current) return;
      refetching.current = true;
      try {
        const fresh = await getLivePlayAction(initial.id);
        if (alive && fresh) setPlay(fresh);
      } finally {
        refetching.current = false;
      }
    };

    const setAuth = async () => {
      const token = await session.getToken();
      if (token) supabase.realtime.setAuth(token);
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    void setAuth().then(() => {
      if (!alive) return;
      channel = supabase.channel(`play:${initial.id}`);
      for (const table of TABLES) {
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            // play_scores has no play column; RLS limits what arrives
            ...(table === "plays"
              ? { filter: `id=eq.${initial.id}` }
              : table === "play_scores"
                ? {}
                : { filter: `play_id=eq.${initial.id}` }),
          },
          (payload) => {
            const change: LiveChange = {
              table,
              type: payload.eventType,
              row: (payload.eventType === "DELETE"
                ? payload.old
                : payload.new) as Record<string, unknown>,
            };
            let needsRefetch = false;
            setPlay((prev) => {
              const next = applyChange(prev, change);
              if (next === "refetch") {
                needsRefetch = true;
                return prev;
              }
              return next;
            });
            if (needsRefetch) void refetch();
          },
        );
      }
      channel.subscribe((status) => setConnected(status === "SUBSCRIBED"));
    });

    const poll = setInterval(() => void refetch(), POLL_MS);
    const refreshAuth = setInterval(() => void setAuth(), TOKEN_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(refreshAuth);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [session, supabase, initial.id]);

  return { play, connected };
}
