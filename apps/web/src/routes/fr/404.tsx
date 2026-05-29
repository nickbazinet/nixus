import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import i18n from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

async function ensureFrLanguage(): Promise<void> {
  if (i18n.language?.startsWith("fr")) return;
  await i18n.changeLanguage("fr");
}

export const Route = createFileRoute("/fr/404")({
  beforeLoad: ensureFrLanguage,
  head: () => {
    const t = i18n.getFixedT("fr");
    return buildMeta({
      locale: "fr",
      path: "/fr/404",
      title: t("meta.notFound.title"),
      description: t("meta.notFound.description"),
    });
  },
  component: NotFoundPageFr,
});

function NotFoundPageFr() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex max-w-[1280px] flex-col items-center justify-center gap-4 px-6 py-24 text-center md:px-8">
      <h1 className="text-4xl font-bold tracking-tight">404</h1>
      <p className="text-lg text-muted-foreground">{t("notFound.heading")}</p>
      <Link
        to="/fr"
        className="text-sm font-medium underline underline-offset-4"
      >
        {t("notFound.backHome")}
      </Link>
    </section>
  );
}
