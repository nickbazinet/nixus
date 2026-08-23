import { createFileRoute } from "@tanstack/react-router";

import { BetaPage, BETA_PAGE_PATHS } from "@/components/BetaPage";
import i18n, { applyRouteLocale } from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/beta")({
  beforeLoad: () => applyRouteLocale("fr"),
  head: () => {
    const t = i18n.getFixedT("fr");
    return buildMeta({
      locale: "fr",
      path: BETA_PAGE_PATHS.fr,
      title: t("betaPage.meta.title"),
      description: t("betaPage.meta.description"),
      alternates: BETA_PAGE_PATHS,
    });
  },
  component: BetaPage,
});
