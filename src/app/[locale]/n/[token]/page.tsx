import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { GuestNight } from "@/features/nights/views/guest-night";
import { assertLocale } from "@/i18n/locale";

/**
 * Public page of a shared night: no account needed. The token is only in the URL; it is
 * never put in the title, metadata or any outgoing link.
 */
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/n/[token]">): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Nights.guest" });
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function GuestNightPage({
  params,
}: PageProps<"/[locale]/n/[token]">) {
  const { locale: rawLocale, token } = await params;
  setRequestLocale(assertLocale(rawLocale));
  return <GuestNight token={token} />;
}
