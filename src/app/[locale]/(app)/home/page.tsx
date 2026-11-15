import { assertLocale } from "@/i18n/locale";
import { Library } from "lucide-react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";

export default async function HomePage({
  params,
}: PageProps<"/[locale]/home">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);
  return <Home />;
}

function Home() {
  const t = useTranslations("Home");
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {t("title")}
      </h1>
      <EmptyState
        icon={Library}
        title={t("emptyTitle")}
        description={t("emptyBody")}
      />
    </div>
  );
}
