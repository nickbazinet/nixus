import { createFileRoute } from "@tanstack/react-router";

import { TermsPage, TERMS_PAGE_PATHS } from "@/components/LegalPage";
import i18n, { applyRouteLocale } from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/terms")({
  beforeLoad: () => applyRouteLocale("fr"),
  head: () => {
    const t = i18n.getFixedT("fr");
    return buildMeta({
      locale: "fr",
      path: TERMS_PAGE_PATHS.fr,
      title: t("termsPage.meta.title"),
      description: t("termsPage.meta.description"),
      alternates: TERMS_PAGE_PATHS,
    });
  },
  component: () => <TermsPage locale="fr" />,
});
