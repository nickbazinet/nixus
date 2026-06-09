import { createFileRoute } from "@tanstack/react-router";

import { BetaPage, BETA_PAGE_PATHS } from "@/components/BetaPage";
import i18n from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/beta")({
  head: () => {
    const t = i18n.getFixedT("en");
    return buildMeta({
      locale: "en",
      path: BETA_PAGE_PATHS.en,
      title: t("betaPage.meta.title"),
      description: t("betaPage.meta.description"),
      alternates: BETA_PAGE_PATHS,
    });
  },
  component: BetaPage,
});
