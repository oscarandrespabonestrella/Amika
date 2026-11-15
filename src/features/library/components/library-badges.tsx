import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { LibraryStatus } from "../schemas";

type Props = {
  status: LibraryStatus;
  isFavorite: boolean;
  rating: number | null;
};

/** Status / favorite / rating chips shown on a library card. */
export function LibraryBadges({ status, isFavorite, rating }: Props) {
  const t = useTranslations("Library.badge");
  return (
    <>
      <Badge variant={status === "owned" ? "default" : "secondary"}>
        {t(status)}
      </Badge>
      {isFavorite && (
        <Badge variant="outline" className="gap-1">
          <Star className="size-3 fill-current" aria-hidden />
          {t("favorite")}
        </Badge>
      )}
      {rating !== null && (
        <Badge variant="outline">{t("rating", { rating })}</Badge>
      )}
    </>
  );
}
