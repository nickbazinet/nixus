import { useTranslation } from "react-i18next";
import { AttentionRow, Badge, Meter, Money, formatMoney } from "@nixus/shared";
import type { AttentionStatus } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { rampColor } from "@/components/spending-trends/insights-chart";

interface DashboardBudgetCategoryRowProps {
  name: string;
  targetCents: number;
  spentCents: number;
  /** Position in the ranked list. Picks the row's ramp colour — never the category's identity. */
  rank: number;
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
  rank,
}: DashboardBudgetCategoryRowProps) {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();

  const pacing = getPacing(spentCents, targetCents);
  const remainingCents = targetCents - spentCents;
  const utilization = targetCents > 0 ? (spentCents / targetCents) * 100 : 0;

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
    // The meter sits outside the AttentionRow, not inside it: the row's one accessible sentence
    // already carries the spend, the target and the remainder, so a second progressbar inside it
    // would announce the same ratio twice. Here it is purely the visual ranking.
    <div className="border-b border-line pb-3 last:border-b-0">
      <AttentionRow
        className="border-b-0 py-3"
        status={pacingStatus[pacing]}
        name={<span className="text-label">{name}</span>}
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
      {targetCents > 0 && (
        <Meter
          aria-hidden="true"
          label={t("dashboard.v2.categoryMeterLabel", { name })}
          value={Math.min(utilization, 100)}
          color={pacing === "over" ? "var(--over)" : rampColor(rank)}
        />
      )}
    </div>
  );
}
