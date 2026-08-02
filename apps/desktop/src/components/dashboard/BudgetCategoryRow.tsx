import { useTranslation } from "react-i18next";
import { AttentionRow, Badge, Money, formatMoney } from "@nixus/shared";
import type { AttentionStatus } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";

interface DashboardBudgetCategoryRowProps {
  name: string;
  targetCents: number;
  spentCents: number;
}

type Pacing = "over" | "met" | "under";

// The shipped rule badged anything at >=75% of target as "Warning", which reads a mortgage at
// exactly $1,650/$1,650 as a problem. Pacing is derived from the remainder alone: over target is
// unambiguously over, and a commitment that has simply been met is `neutral`, never a warning.
//
// A `due_soon` / `overdue` distinction would need to know which categories are bills that cannot
// move. No such field exists on DashboardBudgetCategory, so this deliberately does not guess.
function getPacing(spentCents: number, targetCents: number): Pacing {
  if (targetCents <= 0) return "under";
  if (spentCents > targetCents) return "over";
  if (spentCents === targetCents) return "met";
  return "under";
}

const pacingStatus: Record<Pacing, AttentionStatus> = {
  over: "over",
  met: "neutral",
  under: "good",
};

const pacingBadgeVariant = {
  over: "over",
  met: "neutral",
  under: "good",
} as const;

export function DashboardBudgetCategoryRow({
  name,
  targetCents,
  spentCents,
}: DashboardBudgetCategoryRowProps) {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();

  const pacing = getPacing(spentCents, targetCents);
  const remainingCents = targetCents - spentCents;

  const amountHidden = t("common.amountHidden");
  const money = (cents: number) =>
    hidden ? amountHidden : formatMoney({ cents, locale: i18n.language });

  const badgeLabel =
    pacing === "over"
      ? t("dashboard.categoryOverBy", { amount: money(Math.abs(remainingCents)) })
      : pacing === "met"
        ? t("dashboard.categoryFullySpent")
        : t("dashboard.categoryLeft", { amount: money(remainingCents) });

  // One coherent sentence: the dot, figure, and badge are all presentational inside AttentionRow.
  const accessibleName =
    pacing === "over"
      ? t("dashboard.categoryRowOver", {
          name,
          amount: money(Math.abs(remainingCents)),
        })
      : pacing === "met"
        ? t("dashboard.categoryRowFullySpent", {
            name,
            spent: money(spentCents),
            target: money(targetCents),
          })
        : t("dashboard.categoryRowUnder", {
            name,
            spent: money(spentCents),
            target: money(targetCents),
            remaining: money(remainingCents),
          });

  return (
    <AttentionRow
      status={pacingStatus[pacing]}
      name={name}
      figure={
        <Money
          cents={spentCents}
          locale={i18n.language}
          masked={hidden}
          maskedLabel={amountHidden}
          data-testid="category-amount"
        />
      }
      badge={
        <Badge variant={pacingBadgeVariant[pacing]} data-testid="category-badge">
          {badgeLabel}
        </Badge>
      }
      accessibleName={accessibleName}
      data-testid="dashboard-category-row"
    />
  );
}
