import { useTranslation } from "react-i18next";
import { DatabaseIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Money,
} from "@nixus/shared";
import { LegendDot } from "@/components/charts/DonutBreakdown";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  insightsLocale,
  rampColor,
} from "@/components/spending-trends/insights-chart";
import { GOVERNMENT_PENSION_MIN_AGE_CA } from "@/lib/retirement";

interface RetirementIncomeCardProps {
  governmentPensionAnnualCents: number;
  gateGovernmentPensionByAge: boolean;
  employerPensionAnnualCents: number;
  employerPensionStartAge: number;
}

/**
 * The retirement income that arrives whether or not the portfolio is ready — the two pensions the
 * assumptions panel below collects, with the age each one starts and what they come to in a year.
 * Gross, before tax, which is how they were entered; the card says so rather than quietly applying
 * the rate the grid uses.
 *
 * Nothing renders when both are zero: a card of $0 rows would read as a finding.
 */
export function RetirementIncomeCard({
  governmentPensionAnnualCents,
  gateGovernmentPensionByAge,
  employerPensionAnnualCents,
  employerPensionStartAge,
}: RetirementIncomeCardProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  const rows = [
    {
      key: "government",
      color: rampColor(0),
      label: t("retirement.v2.governmentPension"),
      caption: gateGovernmentPensionByAge
        ? t("retirement.v2.fromAge", { age: GOVERNMENT_PENSION_MIN_AGE_CA })
        : t("retirement.v2.fromWheneverYouRetire"),
      cents: governmentPensionAnnualCents,
    },
    {
      key: "employer",
      color: rampColor(1),
      label: t("retirement.v2.employerPension"),
      caption: t("retirement.v2.fromAge", { age: employerPensionStartAge }),
      cents: employerPensionAnnualCents,
    },
  ].filter((row) => row.cents > 0);

  if (rows.length === 0) return null;

  const total = rows.reduce((sum, row) => sum + row.cents, 0);

  return (
    <Card data-testid="retirement-income-sources">
      <CardHeader>
        <CardTitle icon={DatabaseIcon}>
          {t("retirement.v2.incomeSourcesTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul>
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center gap-3 border-b border-line py-3.5"
            >
              <LegendDot color={row.color} />
              <div className="min-w-0 flex-1">
                <p className="text-body text-ink">{row.label}</p>
                <p className="text-caption text-ink-dim">{row.caption}</p>
              </div>
              <Money
                cents={row.cents}
                locale={locale}
                className="font-bold text-ink"
                {...maskProps}
              />
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-4 pt-3.5">
          <span className="text-label text-ink">
            {t("retirement.v2.totalAYear")}
          </span>
          <Money
            cents={total}
            locale={locale}
            className="text-h2 font-bold text-ink"
            {...maskProps}
          />
        </div>
        <p className="mt-3 text-caption text-ink-faint">
          {t("retirement.v2.incomeSourcesBasis")}
        </p>
      </CardContent>
    </Card>
  );
}
