import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("Common");
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">{t("loading")}</span>
      <div className="h-9 w-48 animate-pulse rounded-lg bg-muted" />
      <div className="h-11 w-full animate-pulse rounded-lg bg-muted" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-22 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
