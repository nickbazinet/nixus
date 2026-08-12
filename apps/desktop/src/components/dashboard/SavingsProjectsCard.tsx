import { useTranslation } from "react-i18next";
import { Meter, Money, formatMoney } from "@nixus/shared";
import { DashboardMetricCard } from "@/components/dashboard/DashboardMetricCard";
import { useSavingsProjectsSummary } from "@/hooks/useProjects";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";

export function SavingsProjectsCard() {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const { data, isPending } = useSavingsProjectsSummary();

  const amountHidden = t("common.amountHidden");
  const money = (cents: number) =>
    hidden ? amountHidden : formatMoney({ cents, locale: i18n.language });

  // Pending is checked before the zero-project case so a cold load never flashes a card that then
  // disappears. A failed query lands here too, and suppressing beats a dashboard error state.
  if (isPending) {
    return (
      <DashboardMetricCard
        title={t("dashboard.savingsProjects")}
        value=""
        variant="secondary"
        isLoading
      />
    );
  }

  if (!data || data.active_project_count === 0) {
    return null;
  }

  const { active_project_count, total_saved_cents, total_target_cents } = data;
  const progressPercent =
    total_target_cents > 0 ? (total_saved_cents / total_target_cents) * 100 : 0;

  return (
    <DashboardMetricCard
      title={t("dashboard.savingsProjects")}
      value={
        <Money
          cents={total_saved_cents}
          locale={i18n.language}
          masked={hidden}
          maskedLabel={amountHidden}
        />
      }
      valueLabel={money(total_saved_cents)}
      variant="secondary"
      href="/wealth/projects"
      progressBar={
        total_target_cents > 0 ? (
          <Meter
            label={t("projects.dashboardMeterLabel")}
            value={Math.min(progressPercent, 100)}
            valueText={
              hidden
                ? amountHidden
                : t("projects.dashboardMeterValue", {
                    saved: money(total_saved_cents),
                    target: money(total_target_cents),
                    count: active_project_count,
                  })
            }
            data-testid="savings-projects-progress"
          />
        ) : undefined
      }
    />
  );
}
