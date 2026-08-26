import { createFileRoute } from "@tanstack/react-router";

import { PrivacyPage, PRIVACY_PAGE_PATHS } from "@/components/LegalPage";
import i18n, { applyRouteLocale } from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/privacy")({
  beforeLoad: () => applyRouteLocale("en"),
  head: () => {
    const t = i18n.getFixedT("en");
    return buildMeta({
      locale: "en",
      path: PRIVACY_PAGE_PATHS.en,
      title: t("privacyPage.meta.title"),
      description: t("privacyPage.meta.description"),
      alternates: PRIVACY_PAGE_PATHS,
    });
  },
  component: () => <PrivacyPage locale="en" />,
});
