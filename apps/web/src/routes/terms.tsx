import { createFileRoute } from "@tanstack/react-router";

import { TermsPage, TERMS_PAGE_PATHS } from "@/components/LegalPage";
import i18n, { applyRouteLocale } from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/terms")({
  beforeLoad: () => applyRouteLocale("en"),
  head: () => {
    const t = i18n.getFixedT("en");
    return buildMeta({
      locale: "en",
      path: TERMS_PAGE_PATHS.en,
      title: t("termsPage.meta.title"),
      description: t("termsPage.meta.description"),
      alternates: TERMS_PAGE_PATHS,
    });
  },
  component: () => <TermsPage locale="en" />,
});
