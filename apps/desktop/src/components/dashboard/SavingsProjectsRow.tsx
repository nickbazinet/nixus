import { useTranslation } from "react-i18next";
import { PiggyBank } from "lucide-react";
import { Meter, formatMoney } from "@nixus/shared";
import { NetWorthPartRow } from "@/components/dashboard/NetWorthCard";
import { useSavingsProjectsSummary } from "@/hooks/useProjects";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";

/**
 * What is already set aside, as the last part of what the user has. It belongs beside cash and
 * investments rather than in a card of its own: goal savings are not a separate pile of money,
 * they are a claim on the cash that is already counted above.
 *
 * Renders nothing when there is no active goal — an empty row would be a promise about a feature
 * the profile is not using.
 */
export function SavingsProjectsRow() {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const { data, isPending } = useSavingsProjectsSummary();

  const amountHidden = t("common.amountHidden");
  const money = (cents: number) =>
    hidden ? amountHidden : formatMoney({ cents, locale: i18n.language });

  // Pending is checked before the zero-project case so a cold load never flashes a row that then
  // disappears. A failed query lands here too, and suppressing beats a dashboard error state.
  if (isPending) return null;
  if (!data || data.active_project_count === 0) return null;

  const { active_project_count, total_saved_cents, total_target_cents } = data;
  const progressPercent =
    total_target_cents > 0 ? (total_saved_cents / total_target_cents) * 100 : 0;

  return (
    <NetWorthPartRow
      icon={PiggyBank}
      title={t("dashboard.savingsProjects")}
      subtitle={t("dashboard.v2.goalsSubtitle", { count: active_project_count })}
      cents={total_saved_cents}
      to="/wealth/projects"
      accessibleName={`${t("dashboard.savingsProjects")}: ${money(total_saved_cents)}`}
      data-testid="savings-projects-row"
      meter={
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
