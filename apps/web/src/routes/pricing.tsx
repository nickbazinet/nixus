import { createFileRoute } from "@tanstack/react-router";

import { PricingPage } from "@/components/PricingPage";
import i18n, { applyRouteLocale } from "@/lib/i18n";
import { PRICING_PAGE_PATHS } from "@/lib/localePaths";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/pricing")({
  beforeLoad: () => applyRouteLocale("en"),
  head: () => {
    const t = i18n.getFixedT("en");
    return buildMeta({
      locale: "en",
      path: PRICING_PAGE_PATHS.en,
      title: t("pricing.meta.title"),
      description: t("pricing.meta.description"),
      alternates: PRICING_PAGE_PATHS,
    });
  },
  component: () => <PricingPage locale="en" />,
});
