import { setRequestLocale } from "next-intl/server";
import { listGroups } from "@/features/groups";
import {
  getPickerShortlist,
  listNightInvites,
  listNights,
  parsePickerQuery,
  todayIso,
} from "@/features/nights";
import { NightsHome } from "@/features/nights/views/nights-home";
import { assertLocale } from "@/i18n/locale";

export default async function NightsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/nights">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const query = parsePickerQuery(await searchParams);
  // UTC date: only ranks games; a day of drift near midnight is acceptable.
  const today = todayIso();
  const [invites, nights, groups, initial] = await Promise.all([
    listNightInvites(),
    listNights(),
    listGroups(),
    getPickerShortlist(query, today),
  ]);

  return (
    <NightsHome
      invites={invites}
      nights={nights}
      groups={groups}
      initial={initial}
      query={query}
    />
  );
}
