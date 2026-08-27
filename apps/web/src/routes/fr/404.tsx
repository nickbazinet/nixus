import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import i18n, { applyRouteLocale } from "@/lib/i18n";
import { NOT_FOUND_PAGE_PATHS } from "@/lib/localePaths";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/404")({
  beforeLoad: () => applyRouteLocale("fr"),
  head: () => {
    const t = i18n.getFixedT("fr");
    return buildMeta({
      locale: "fr",
      path: NOT_FOUND_PAGE_PATHS.fr,
      title: t("meta.notFound.title"),
      description: t("meta.notFound.description"),
      alternates: NOT_FOUND_PAGE_PATHS,
      noindex: true,
    });
  },
  component: NotFoundPageFr,
});

function NotFoundPageFr() {
  const { t } = useTranslation();
  return (
    <section className="mkt-page-x mkt-section-y mx-auto flex max-w-[1280px] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">404</h1>
      <p className="text-lead text-muted-foreground">{t("notFound.heading")}</p>
      <Link
        to="/fr"
        className="mkt-tap inline-flex items-center text-sm font-medium underline underline-offset-4"
      >
        {t("notFound.backHome")}
      </Link>
    </section>
  );
}
