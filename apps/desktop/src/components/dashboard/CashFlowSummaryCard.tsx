import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Meter,
  Money,
  Skeleton,
  SubStat,
  focusRing,
} from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";

interface CashFlowSummaryCardProps {
  incomeCents: number;
  expensesCents: number;
  isLoading?: boolean;
}

export function CashFlowSummaryCard({
  incomeCents,
  expensesCents,
  isLoading,
}: CashFlowSummaryCardProps) {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();

  const netCents = incomeCents - expensesCents;
  const ratio = incomeCents > 0 ? (expensesCents / incomeCents) * 100 : 0;
  const amountHidden = t("common.amountHidden");

  if (isLoading) {
    return (
      <Card data-testid="cash-flow-card">
        <CardContent>
          {/* Title, three figures, meter. */}
          <Skeleton rows={5} />
        </CardContent>
      </Card>
    );
  }

  if (incomeCents === 0) {
    return (
      <Card
        interactive
        render={<Link to="/spending/income" />}
        aria-label={t("dashboard.noIncomeThisMonth")}
        data-testid="cash-flow-card"
      >
        <CardContent className="flex flex-col gap-1">
          <p className="text-body text-ink">{t("dashboard.noIncomeThisMonth")}</p>
          <p className="text-caption text-ink-dim">{t("dashboard.recordIncome")}</p>
        </CardContent>
      </Card>
    );
  }

  const isShortfall = netCents < 0;
  const spentPercent = Math.round(Math.min(ratio, 999));

  return (
    <Card data-testid="cash-flow-card">
      <CardHeader>
        <CardTitle>{t("dashboard.cashFlow")}</CardTitle>
      </CardHeader>

      <CardContent className="@container flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 @lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <span className="text-caption text-ink-dim">{t("dashboard.moneyIn")}</span>
            <Money
              className="text-h2 text-ink"
              cents={incomeCents}
              locale={i18n.language}
              masked={hidden}
              maskedLabel={amountHidden}
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-caption text-ink-dim">{t("dashboard.moneyOut")}</span>
            <Money
              className="text-h2 text-ink"
              cents={expensesCents}
              locale={i18n.language}
              masked={hidden}
              maskedLabel={amountHidden}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <SubStat
              label={t("dashboard.netLeftOver")}
              value={
                <span className={cn(isShortfall && "text-over-ink")}>
                  <Money
                    cents={netCents}
                    locale={i18n.language}
                    sign="always"
                    masked={hidden}
                    maskedLabel={amountHidden}
                  />
                </span>
              }
            />
            {/* The colour on a shortfall is never the only signal. */}
            <Badge variant={isShortfall ? "over" : "good"}>
              {isShortfall
                ? t("dashboard.cashFlowShortfall")
                : t("dashboard.cashFlowLeftOver")}
            </Badge>
          </div>
        </div>

        {/* A spreadsheet user's most practised habit is reading a running balance, so an
            unqualified net figure gets read as one. */}
        <p className="text-caption text-ink-dim" data-testid="cash-flow-net-caveat">
          {t("dashboard.cashFlowNetCaption")}
        </p>

        <div className="flex flex-col gap-1.5">
          <Meter
            label={t("dashboard.cashFlowMeterLabel")}
            value={Math.min(ratio, 100)}
            valueText={t("dashboard.cashFlowSpentOfIncome", { percent: spentPercent })}
          />
          <span className="text-caption text-ink-dim">
            {t("dashboard.cashFlowSpentOfIncome", { percent: spentPercent })}
          </span>
        </div>

        <Link
          to="/spending/income"
          className={cn(
            "text-label text-brand-ink underline-offset-4 hover:underline",
            focusRing,
          )}
          data-testid="cash-flow-income-link"
        >
          {t("dashboard.viewIncome")}
        </Link>
      </CardContent>
    </Card>
  );
}
