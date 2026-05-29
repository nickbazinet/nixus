import { useTranslation } from "react-i18next";
import { Badge } from "@nkbaz/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";

interface DashboardBudgetCategoryRowProps {
  name: string;
  targetCents: number;
  spentCents: number;
}

function getSpentRatio(spent: number, target: number): number {
  if (target <= 0) return 0;
  return spent / target;
}

function getBarColor(ratio: number): string {
  if (ratio > 1.0) return "bg-rose-500";
  if (ratio >= 0.75) return "bg-amber-500";
  return "bg-primary";
}

export function DashboardBudgetCategoryRow({
  name,
  targetCents,
  spentCents,
}: DashboardBudgetCategoryRowProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const ratio = getSpentRatio(spentCents, targetCents);
  const progressPercent = Math.min(ratio * 100, 100);
  const barColor = getBarColor(ratio);

  const badgeLabel =
    ratio > 1.0
      ? t("dashboard.over")
      : ratio >= 0.75
        ? t("dashboard.warning")
        : t("dashboard.onTrack");
  const badgeClassName =
    ratio > 1.0
      ? "bg-rose-500/10 text-rose-600 border-transparent"
      : ratio >= 0.75
        ? "bg-amber-500/10 text-amber-600 border-transparent"
        : "bg-emerald-500/10 text-emerald-600 border-transparent";

  const percentUsed = Math.round(ratio * 100);

  return (
    <div
      className="py-2"
      data-testid="dashboard-category-row"
      aria-label={`${name}: ${formatCurrency(spentCents)} of ${formatCurrency(targetCents)}, ${percentUsed}% used`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium">{name}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm" data-testid="category-amount">
            {formatCurrency(spentCents)} / {formatCurrency(targetCents)}
          </span>
          <Badge className={badgeClassName} data-testid="category-badge">
            {badgeLabel}
          </Badge>
        </div>
      </div>
      <div
        className="h-2 w-full rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={spentCents}
        aria-valuemin={0}
        aria-valuemax={targetCents}
        data-testid="category-progress"
      >
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
