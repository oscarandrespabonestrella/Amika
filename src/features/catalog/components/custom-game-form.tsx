"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { createCustomGameAction } from "../actions/catalog-actions";
import {
  type CustomGameData,
  type CustomGameInput,
  customGameSchema,
} from "../schemas";

export function CustomGameForm() {
  const t = useTranslations("NewGame");
  const tKind = useTranslations("Games.kind");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [formError, setFormError] = useState<
    "unauthenticated" | "failed" | null
  >(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<CustomGameInput, unknown, CustomGameData>({
    resolver: zodResolver(customGameSchema),
    defaultValues: {
      name: "",
      kind: "base",
      yearPublished: "",
      minPlayers: "",
      maxPlayers: "",
      minPlaytime: "",
      maxPlaytime: "",
      minAge: "",
      description: "",
      locale,
    },
  });
  const {
    register,
    formState: { errors },
  } = form;

  /** Zod messages are stable codes (required, range…): translate them here. */
  const errorText = (code?: string) =>
    code && t.has(`errors.${code}` as "errors.required")
      ? t(`errors.${code}` as "errors.required")
      : undefined;

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      // Send the raw strings: the server validates them again with the same schema.
      const result = await createCustomGameAction({
        ...form.getValues(),
        locale,
      });
      if (result.ok) {
        router.push(`/games/${result.id}`);
      } else if (result.error === "invalid") {
        for (const [field, code] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof CustomGameInput, { message: code });
        }
      } else {
        setFormError(result.error);
      }
    });
  });

  const field = (
    name: keyof CustomGameInput,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => {
    const message = errorText(errors[name]?.message);
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={name}>{label}</Label>
        <Input
          id={name}
          className="h-10"
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${name}-error` : undefined}
          {...register(name)}
          {...props}
        />
        {message && (
          <p id={`${name}-error`} className="text-sm text-destructive">
            {message}
          </p>
        )}
      </div>
    );
  };

  const descriptionError = errorText(errors.description?.message);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {field("name", t("fields.name"), {
        required: true,
        maxLength: 200,
        autoComplete: "off",
      })}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kind">{t("fields.kind")}</Label>
        <NativeSelect id="kind" {...register("kind")}>
          <option value="base">{tKind("base")}</option>
          <option value="expansion">{tKind("expansion")}</option>
        </NativeSelect>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {field("minPlayers", t("fields.minPlayers"), {
          type: "text",
          inputMode: "numeric",
        })}
        {field("maxPlayers", t("fields.maxPlayers"), {
          type: "text",
          inputMode: "numeric",
        })}
        {field("minPlaytime", t("fields.minPlaytime"), {
          type: "text",
          inputMode: "numeric",
        })}
        {field("maxPlaytime", t("fields.maxPlaytime"), {
          type: "text",
          inputMode: "numeric",
        })}
        {field("yearPublished", t("fields.yearPublished"), {
          type: "text",
          inputMode: "numeric",
        })}
        {field("minAge", t("fields.minAge"), {
          type: "text",
          inputMode: "numeric",
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">{t("fields.description")}</Label>
        <Textarea
          id="description"
          rows={5}
          maxLength={5000}
          aria-invalid={descriptionError ? true : undefined}
          aria-describedby={descriptionError ? "description-error" : undefined}
          {...register("description")}
        />
        {descriptionError && (
          <p id="description-error" className="text-sm text-destructive">
            {descriptionError}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${formError}`)}
        </p>
      )}

      <div className="flex gap-3">
        <Button
          type="submit"
          size="lg"
          className="h-11 px-6"
          disabled={pending}
        >
          {pending ? t("submitting") : t("submit")}
        </Button>
        <Link
          href="/games"
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "h-11 px-6",
          )}
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
