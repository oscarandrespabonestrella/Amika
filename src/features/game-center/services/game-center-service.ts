import "server-only";
import { cache } from "react";
import { pickByLocale } from "@/lib/locale-fallback";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ResourceKind } from "../schemas";

export type ResourceView = {
  id: string;
  kind: ResourceKind;
  locale: string | null;
  title: string;
  url: string | null;
  youtubeId: string | null;
  isOfficial: boolean;
};

export type ImageView = {
  id: string;
  url: string;
  caption: string | null;
  license: string | null;
  attribution: string;
};

export type FaqStatus = "pending" | "published" | "rejected";

export type FaqView = {
  id: string;
  status: FaqStatus;
  /** Written in this language (the viewer's, or the best fallback). */
  locale: string;
  question: string;
  answer: string;
  /** Languages this entry exists in. */
  languages: string[];
};

export type GameCenterData = {
  isAdmin: boolean;
  rulesLinks: ResourceView[];
  rulesSummaries: { locale: string; body: string }[];
  links: ResourceView[];
  videos: ResourceView[];
  images: ImageView[];
  faq: {
    published: FaqView[];
    /** The viewer's own suggestions that are not published (pending or rejected). */
    mine: FaqView[];
    /** Admin only: every pending suggestion awaiting review. */
    review: FaqView[];
  };
};

/** True only for administrators. Per request. RLS still enforces every write. */
export const isAdmin = cache(async (): Promise<boolean> => {
  const { data, error } = await createSupabaseServerClient().rpc("is_admin");
  if (error) throw error;
  return data === true;
});

/** Entries for the viewer's language first, then English, then the rest. */
export function orderByLocale<T extends { locale: string | null }>(
  rows: T[],
  locale: string,
): T[] {
  const rank = (row: T) =>
    row.locale === locale
      ? 0
      : row.locale === "en"
        ? 1
        : row.locale === null
          ? 2
          : 3;
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

type FaqRow = {
  id: string;
  status: string;
  created_by: string | null;
  faq_translations: { locale: string; question: string; answer: string }[];
};

function toFaqView(row: FaqRow, locale: string): FaqView | null {
  const translation = pickByLocale(row.faq_translations, locale, "en");
  if (!translation) return null;
  return {
    id: row.id,
    status: row.status as FaqStatus,
    locale: translation.locale,
    question: translation.question,
    answer: translation.answer,
    languages: row.faq_translations.map((t) => t.locale).sort(),
  };
}

export async function getGameCenter(
  gameId: string,
  locale: string,
  userId: string,
): Promise<GameCenterData> {
  const supabase = createSupabaseServerClient();
  const [admin, resources, rules, images, faq] = await Promise.all([
    isAdmin(),
    supabase
      .from("game_resources")
      .select(
        "id, kind, locale, title, url, youtube_id, is_official, sort, created_at",
      )
      .eq("game_id", gameId)
      .order("sort")
      .order("created_at"),
    supabase.from("rules_content").select("locale, body").eq("game_id", gameId),
    supabase
      .from("game_images")
      .select("id, url, caption, license, attribution")
      .eq("game_id", gameId)
      .order("sort")
      .order("created_at"),
    supabase
      .from("faq_entries")
      .select(
        "id, status, created_by, faq_translations(locale, question, answer)",
      )
      .eq("game_id", gameId)
      .order("sort")
      .order("created_at"),
  ]);
  for (const result of [resources, rules, images, faq])
    if (result.error) throw result.error;

  const views: ResourceView[] = (resources.data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as ResourceKind,
    locale: r.locale,
    title: r.title,
    url: r.url,
    youtubeId: r.youtube_id,
    isOfficial: r.is_official,
  }));

  const faqRows = (faq.data ?? []) as FaqRow[];
  const faqViews = faqRows.flatMap((row) => {
    const view = toFaqView(row, locale);
    return view ? [{ row, view }] : [];
  });

  return {
    isAdmin: admin,
    rulesLinks: orderByLocale(
      views.filter((r) => r.kind === "rules"),
      locale,
    ),
    rulesSummaries: orderByLocale(rules.data ?? [], locale),
    links: orderByLocale(
      views.filter((r) => r.kind === "link"),
      locale,
    ),
    videos: orderByLocale(
      views.filter((r) => r.kind === "video"),
      locale,
    ),
    images: (images.data ?? []).map((i) => ({
      id: i.id,
      url: i.url,
      caption: i.caption,
      license: i.license,
      attribution: i.attribution,
    })),
    faq: {
      published: faqViews
        .filter((f) => f.view.status === "published")
        .map((f) => f.view),
      mine: faqViews
        .filter(
          (f) => f.view.status !== "published" && f.row.created_by === userId,
        )
        .map((f) => f.view),
      review: admin
        ? faqViews.filter((f) => f.view.status === "pending").map((f) => f.view)
        : [],
    },
  };
}
