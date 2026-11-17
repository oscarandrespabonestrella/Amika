import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { JoinFriend } from "@/features/friends/components/join-friend";
import { friendCodeSchema } from "@/features/friends/schemas";
import { assertLocale } from "@/i18n/locale";

export default async function JoinFriendPage({
  params,
}: PageProps<"/[locale]/friends/join/[code]">) {
  const { locale: rawLocale, code } = await params;
  setRequestLocale(assertLocale(rawLocale));
  if (!friendCodeSchema.safeParse(code).success) notFound();
  const t = await getTranslations("Friends.join");

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground">{t("description")}</p>
      <JoinFriend code={code} />
    </div>
  );
}
