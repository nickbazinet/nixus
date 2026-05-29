import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import i18n from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/404")({
  head: () => {
    const t = i18n.getFixedT("en");
    return buildMeta({
      locale: "en",
      path: "/404",
      title: t("meta.notFound.title"),
      description: t("meta.notFound.description"),
    });
  },
  component: NotFoundPage,
});

function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex max-w-[1280px] flex-col items-center justify-center gap-4 px-6 py-24 text-center md:px-8">
      <h1 className="text-4xl font-bold tracking-tight">404</h1>
      <p className="text-lg text-muted-foreground">{t("notFound.heading")}</p>
      <Link
        to="/"
        className="text-sm font-medium underline underline-offset-4"
      >
        {t("notFound.backHome")}
      </Link>
    </section>
  );
}
