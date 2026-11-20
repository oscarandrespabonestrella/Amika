import { Search, SlidersHorizontal } from "lucide-react";
import Form from "next/form";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { SearchParams } from "../schemas";

/** Plain GET form: works without JavaScript and keeps the state in the URL. */
export function SearchForm({ params }: { params: SearchParams }) {
  const t = useTranslations("Games.search");
  const tKind = useTranslations("Games.kind");
  const locale = useLocale();
  const hasFilters = Boolean(params.kind || params.players || params.time);

  return (
    <Form
      action={`/${locale}/games`}
      role="search"
      className="flex flex-col gap-3"
    >
      {/* CSS-only toggle (same as the library): the checkbox drives the filters panel. */}
      <input
        id="more-filters"
        type="checkbox"
        defaultChecked={hasFilters}
        className="peer sr-only"
      />
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            type="search"
            defaultValue={params.q}
            maxLength={100}
            aria-label={t("label")}
            placeholder={t("placeholder")}
            className="h-12 rounded-xl pl-9 focus-visible:border-primary"
          />
        </div>
        <label
          htmlFor="more-filters"
          title={t("filters")}
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "relative h-12 cursor-pointer rounded-xl px-3 select-none sm:px-4",
            "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
            "peer-checked:border-primary peer-checked:bg-primary/10",
          )}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">{t("filters")}</span>
          {hasFilters && (
            <span
              aria-hidden
              className="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary"
            />
          )}
        </label>
        <Button type="submit" size="lg" className="h-12 rounded-xl px-5">
          {t("submit")}
        </Button>
      </div>

      <div className="hidden rounded-xl border border-border bg-card px-4 py-3 peer-checked:block">
        <div className="grid grid-cols-1 gap-4 pb-2 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kind">{t("kind")}</Label>
            <NativeSelect
              id="kind"
              name="kind"
              defaultValue={params.kind ?? ""}
            >
              <option value="">{t("kindAny")}</option>
              <option value="base">{tKind("base")}</option>
              <option value="expansion">{tKind("expansion")}</option>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="players">{t("players")}</Label>
            <Input
              id="players"
              name="players"
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              defaultValue={params.players ?? ""}
              aria-label={t("playersHint")}
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="time">{t("time")}</Label>
            <Input
              id="time"
              name="time"
              type="number"
              inputMode="numeric"
              min={1}
              max={10000}
              defaultValue={params.time ?? ""}
              aria-label={t("timeHint")}
              className="h-10"
            />
          </div>
        </div>
        {hasFilters && (
          <Link
            href={
              `/games?q=${encodeURIComponent(params.q)}`
            }
            className="inline-block pb-2 text-sm text-primary underline-offset-4 hover:underline"
          >
            {t("clear")}
          </Link>
        )}
      </div>
    </Form>
  );
}
