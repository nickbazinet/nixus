import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Meter,
  Money,
  Skeleton,
  focusRing,
} from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";

interface CashFlowSummaryCardProps {
  incomeCents: number;
  expensesCents: number;
  isLoading?: boolean;
}

/** One bar per side of the month: what came in sets the scale, what went out is read against it. */
function FlowRow({
  label,
  cents,
  meterLabel,
  meterValue,
  meterValueText,
  color,
}: {
  label: string;
  cents: number;
  meterLabel: string;
  meterValue: number;
  meterValueText: string;
  color: string;
}) {
  const { i18n } = useTranslation();
  const { maskProps } = useValuesHidden();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-label text-ink-dim">{label}</span>
        <Money
          cents={cents}
          locale={i18n.language}
          className="text-h2 font-bold text-ink"
          {...maskProps}
        />
      </div>
      <Meter label={meterLabel} value={meterValue} valueText={meterValueText} color={color} />
    </div>
  );
}

/**
 * What came in against what went out, and the one figure that matters underneath: the net. The
 * two bars share a scale — money in is the whole track, money out is its share of it — so the
 * gap between them IS the net, read before any number is.
 */
export function CashFlowSummaryCard({
  incomeCents,
  expensesCents,
  isLoading,
}: CashFlowSummaryCardProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();

  const netCents = incomeCents - expensesCents;
  const ratio = incomeCents > 0 ? (expensesCents / incomeCents) * 100 : 0;

  if (isLoading) {
    return (
      <Card data-testid="cash-flow-card">
        <CardContent>
          {/* Title, two bars, the net. */}
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
        <CardHeader>
          <CardTitle icon={ArrowLeftRight}>{t("dashboard.cashFlow")}</CardTitle>
        </CardHeader>
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
        <CardTitle icon={ArrowLeftRight}>{t("dashboard.cashFlow")}</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <FlowRow
          label={t("dashboard.moneyIn")}
          cents={incomeCents}
          meterLabel={t("dashboard.v2.moneyInMeterLabel")}
          meterValue={100}
          meterValueText={t("dashboard.moneyIn")}
          color="var(--chart-2)"
        />
        <FlowRow
          label={t("dashboard.moneyOut")}
          cents={expensesCents}
          meterLabel={t("dashboard.cashFlowMeterLabel")}
          meterValue={Math.min(ratio, 100)}
          meterValueText={t("dashboard.cashFlowSpentOfIncome", { percent: spentPercent })}
          color="var(--chart-3)"
        />

        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-line pt-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-ink-dim">{t("dashboard.v2.netThisMonth")}</span>
            {/* The colour on a shortfall is never the only signal. */}
            <Badge variant={isShortfall ? "over" : "good"}>
              {isShortfall ? t("dashboard.cashFlowShortfall") : t("dashboard.cashFlowLeftOver")}
            </Badge>
          </div>
          <Money
            cents={netCents}
            locale={i18n.language}
            sign="always"
            className={cn("text-stat", isShortfall ? "text-over-ink" : "text-good-ink")}
            {...maskProps}
          />
        </div>

        {/* A spreadsheet user's most practised habit is reading a running balance, so an
            unqualified net figure gets read as one. */}
        <p className="text-caption text-ink-dim" data-testid="cash-flow-net-caveat">
          {t("dashboard.cashFlowNetCaption")}
        </p>

        <Link
          to="/spending/income"
          className={cn(
            "w-fit text-label text-brand-ink underline-offset-4 hover:underline",
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
