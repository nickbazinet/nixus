import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { NetWorthSectionNav } from "@/components/financial-health/NetWorthSectionNav";

export const Route = createFileRoute("/net-worth")({
  component: NetWorthLayout,
});

function NetWorthLayout() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isFinancialHealth = pathname.startsWith("/net-worth/financial-health");

  return (
    <div>
      <PageHeader
        title={t("nav.netWorth")}
        subtitle={
          isFinancialHealth ? t("financialHealth.section.subtitle") : undefined
        }
      />
      <NetWorthSectionNav />
      <Outlet />
    </div>
  );
}
