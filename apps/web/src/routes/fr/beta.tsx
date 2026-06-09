import { createFileRoute } from "@tanstack/react-router";

import { BetaPage, BETA_PAGE_PATHS } from "@/components/BetaPage";
import i18n from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

async function ensureFrLanguage(): Promise<void> {
  if (i18n.language?.startsWith("fr")) return;
  await i18n.changeLanguage("fr");
}

export const Route = createFileRoute("/fr/beta")({
  beforeLoad: ensureFrLanguage,
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
