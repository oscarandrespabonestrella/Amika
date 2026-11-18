import {
  BookOpenText,
  ExternalLink,
  HelpCircle,
  Images,
  Video,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { LOCALE_NAMES } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/routing";
import type {
  FaqView,
  GameCenterData,
  ResourceView,
} from "../services/game-center-service";
import { AdminPanel } from "./admin-panel";
import { FaqForm } from "./faq-form";
import { FaqReview } from "./faq-review";
import { RemoveButton } from "./remove-button";
import { VideoPlayer } from "./video-player";

const languageName = (locale: string) =>
  LOCALE_NAMES[locale as AppLocale] ?? locale.toUpperCase();

function Section({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string;
  icon: typeof Video;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-24 flex-col gap-4"
    >
      <h2
        id={`${id}-title`}
        className="flex items-center gap-2 text-lg font-semibold tracking-tight"
      >
        <Icon className="size-5 text-primary" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

function LanguageBadge({ locale }: { locale: string | null }) {
  if (!locale) return null;
  return (
    <Badge variant="outline" lang={locale}>
      {languageName(locale)}
    </Badge>
  );
}

function ResourceLink({
  resource,
  admin,
  actions,
}: {
  resource: ResourceView;
  admin: boolean;
  /** Extra buttons for this link, supplied by the page (e.g. download for offline use). */
  actions?: ReactNode;
}) {
  const t = useTranslations("GameCenter");
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
      <a
        href={resource.url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-0 items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
      >
        <span className="truncate">{resource.title}</span>
        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
      </a>
      <LanguageBadge locale={resource.locale} />
      {resource.isOfficial && (
        <Badge variant="secondary">{t("rules.official")}</Badge>
      )}
      {resource.publisher && (
        <span className="text-sm text-muted-foreground">
          {resource.publisher}
        </span>
      )}
      {actions}
      {admin && (
        <RemoveButton
          target={{ type: "resource", id: resource.id }}
          label={t("admin.remove")}
        />
      )}
    </li>
  );
}

function FaqItem({
  faq,
  badge,
  defaultOpen = false,
  children,
}: {
  faq: FaqView;
  /** Open on load (the review queue: the admin has to read the answer to decide). */
  defaultOpen?: boolean;
  /** Always visible next to the question (e.g. the review status), even when collapsed. */
  badge?: ReactNode;
  children?: ReactNode;
}) {
  const locale = useLocale();
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-border bg-card px-4 py-3"
    >
      <summary className="cursor-pointer font-medium select-none">
        {faq.question}
        {faq.locale !== locale && (
          <span className="ml-2 align-middle">
            <LanguageBadge locale={faq.locale} />
          </span>
        )}
        {badge && <span className="ml-2 align-middle">{badge}</span>}
      </summary>
      {/* Plain text only: React escapes it, newlines are kept. */}
      <p
        lang={faq.locale}
        className="mt-2 max-w-prose text-pretty whitespace-pre-line text-muted-foreground"
      >
        {faq.answer}
      </p>
      {children && (
        <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
      )}
    </details>
  );
}

type Props = {
  gameId: string;
  data: GameCenterData;
  /** Rendered at the top of the Rules section (the page plugs the manual search in here). */
  rulesSlot?: ReactNode;
  /** Extra buttons for each rules link (the page decides which links get them). */
  renderRuleActions?: (resource: ResourceView) => ReactNode;
};

export function GameCenter({
  gameId,
  data,
  rulesSlot,
  renderRuleActions,
}: Props) {
  const t = useTranslations("GameCenter");
  const { isAdmin, faq } = data;
  const hasRules =
    data.rulesLinks.length > 0 ||
    data.rulesSummaries.length > 0 ||
    data.links.length > 0;

  const jumps = [
    { id: "rules", label: t("nav.rules") },
    { id: "videos", label: t("nav.videos") },
    { id: "faq", label: t("nav.faq") },
    { id: "gallery", label: t("nav.gallery") },
  ];

  return (
    <div className="flex flex-col gap-10">
      <nav aria-label={t("nav.label")} className="flex flex-wrap gap-2">
        {jumps.map((jump) => (
          <a
            key={jump.id}
            href={`#${jump.id}`}
            className="inline-flex min-h-10 items-center rounded-full border border-border bg-card px-4 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {jump.label}
          </a>
        ))}
      </nav>

      <Section id="rules" icon={BookOpenText} title={t("rules.title")}>
        {rulesSlot}
        {!hasRules && (
          <p className="text-muted-foreground">{t("rules.empty")}</p>
        )}

        {data.rulesLinks.length > 0 && (
          <ul className="flex flex-col gap-2">
            {data.rulesLinks.map((r) => (
              <ResourceLink
                key={r.id}
                resource={r}
                admin={isAdmin}
                actions={renderRuleActions?.(r)}
              />
            ))}
          </ul>
        )}

        {data.rulesSummaries.map((summary, index) => (
          <details
            key={summary.locale}
            open={index === 0}
            className="rounded-xl border border-border bg-card px-4 py-3"
          >
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 font-medium select-none">
              {t("rules.summary")}
              <LanguageBadge locale={summary.locale} />
            </summary>
            <p
              lang={summary.locale}
              className="mt-2 max-w-prose text-pretty whitespace-pre-line"
            >
              {summary.body}
            </p>
            {isAdmin && (
              <div className="mt-3">
                <RemoveButton
                  target={{ type: "rules", gameId, locale: summary.locale }}
                  label={t("admin.remove")}
                />
              </div>
            )}
          </details>
        ))}

        {data.links.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("links.title")}
            </h3>
            <ul className="flex flex-col gap-2">
              {data.links.map((r) => (
                <ResourceLink key={r.id} resource={r} admin={isAdmin} />
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section id="videos" icon={Video} title={t("videos.title")}>
        {data.videos.length === 0 ? (
          <p className="text-muted-foreground">{t("videos.empty")}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {data.videos.map((video) => (
              <li key={video.id} className="flex flex-col gap-2">
                <VideoPlayer youtubeId={video.youtubeId!} title={video.title} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{video.title}</span>
                  <LanguageBadge locale={video.locale} />
                  {video.isOfficial && (
                    <Badge variant="secondary">{t("rules.official")}</Badge>
                  )}
                  {isAdmin && (
                    <RemoveButton
                      target={{ type: "resource", id: video.id }}
                      label={t("admin.remove")}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="faq" icon={HelpCircle} title={t("faq.title")}>
        {faq.published.length === 0 ? (
          <p className="text-muted-foreground">{t("faq.empty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {faq.published.map((item) => (
              <FaqItem key={item.id} faq={item}>
                {isAdmin && (
                  <RemoveButton
                    target={{ type: "faq", id: item.id }}
                    label={t("admin.remove")}
                  />
                )}
              </FaqItem>
            ))}
          </div>
        )}

        {faq.mine.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("faq.mine")}
            </h3>
            {faq.mine.map((item) => (
              <FaqItem
                key={item.id}
                faq={item}
                badge={
                  <Badge
                    variant={
                      item.status === "rejected" ? "destructive" : "secondary"
                    }
                  >
                    {t(`faq.status.${item.status as "pending"}`)}
                  </Badge>
                }
              >
                {item.status === "pending" && (
                  <RemoveButton
                    target={{ type: "faq", id: item.id }}
                    label={t("faq.withdraw")}
                  />
                )}
              </FaqItem>
            ))}
          </div>
        )}

        {isAdmin && faq.review.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="faq-review">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("faq.review", { count: faq.review.length })}
            </h3>
            {faq.review.map((item) => (
              <FaqItem key={item.id} faq={item} defaultOpen>
                <FaqReview faqId={item.id} />
                <RemoveButton
                  target={{ type: "faq", id: item.id }}
                  label={t("admin.remove")}
                />
              </FaqItem>
            ))}
          </div>
        )}

        <FaqForm gameId={gameId} admin={isAdmin} />
      </Section>

      <Section id="gallery" icon={Images} title={t("gallery.title")}>
        {data.images.length === 0 ? (
          <p className="text-muted-foreground">{t("gallery.empty")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.images.map((image, index) => (
              <li key={image.id} className="flex flex-col gap-1.5">
                <figure className="overflow-hidden rounded-xl border border-border bg-muted">
                  {/* Linked third-party image: next/image optimization does not apply. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={
                      image.caption ?? t("gallery.alt", { number: index + 1 })
                    }
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="aspect-square w-full object-cover"
                  />
                  <figcaption className="flex flex-col gap-0.5 p-2 text-xs text-muted-foreground">
                    {image.caption && (
                      <span className="text-foreground">{image.caption}</span>
                    )}
                    <span>
                      {t("gallery.credit", { attribution: image.attribution })}
                    </span>
                    {image.license && (
                      <span>
                        {t("gallery.license", { license: image.license })}
                      </span>
                    )}
                  </figcaption>
                </figure>
                {isAdmin && (
                  <RemoveButton
                    target={{ type: "image", id: image.id }}
                    label={t("admin.remove")}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {isAdmin && <AdminPanel gameId={gameId} />}
    </div>
  );
}
