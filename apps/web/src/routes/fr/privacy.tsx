import { createFileRoute } from "@tanstack/react-router";

import { PrivacyPage, PRIVACY_PAGE_PATHS } from "@/components/LegalPage";
import i18n, { applyRouteLocale } from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/privacy")({
  beforeLoad: () => applyRouteLocale("fr"),
  head: () => {
    const t = i18n.getFixedT("fr");
    return buildMeta({
      locale: "fr",
      path: PRIVACY_PAGE_PATHS.fr,
      title: t("privacyPage.meta.title"),
      description: t("privacyPage.meta.description"),
      alternates: PRIVACY_PAGE_PATHS,
    });
  },
  component: () => <PrivacyPage locale="fr" />,
});
