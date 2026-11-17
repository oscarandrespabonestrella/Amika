import { getTranslations, setRequestLocale } from "next-intl/server";
import { FriendsPanel } from "@/features/friends/components/friends-panel";
import { listFriends } from "@/features/friends";
import { ensureDisplayName } from "@/features/profiles";
import {
  listMyInvites,
  listMyLinkRequests,
} from "@/features/plays/services/sharing-service";
import { assertLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";

export default async function FriendsPage({
  params,
}: PageProps<"/[locale]/friends">) {
  const { locale: rawLocale } = await params;
  setRequestLocale(assertLocale(rawLocale));

  // Fills my own name first when it is empty, so the people I am friends with can read it.
  await ensureDisplayName();
  const [t, friends, invites, linkRequests] = await Promise.all([
    getTranslations("Friends"),
    listFriends(),
    listMyInvites(),
    listMyLinkRequests(),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
        <Link
          href="/plays/elsewhere"
          className="w-fit text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("elsewhereLink")}
        </Link>
      </header>
      <FriendsPanel
        friends={friends}
        invites={invites}
        linkRequests={linkRequests}
      />
    </div>
  );
}
