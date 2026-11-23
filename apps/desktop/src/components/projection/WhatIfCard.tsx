import { useTranslation } from "react-i18next";
import { SlidersHorizontalIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Money,
} from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { insightsLocale } from "@/components/spending-trends/insights-chart";
import { EXPENSE_GROWTH_RATE, INCOME_GROWTH_RATE } from "@/lib/projection";

interface WhatIfCardProps {
  netMonthlyCents: number;
  /** "20 years" / "6 months" — the horizon the figures above were computed over. */
  horizonLabel: string;
  /** Takes the user to the full assumptions, which stay on the page below. */
  onSeeAssumptions: () => void;
}

/**
 * The four numbers the projection is built from, each as a pill so the whole model reads at a
 * glance. Read-only by design: all four are DERIVED from what the user records, so the way to
 * change them is to change the records — which is what the full assumptions panel explains.
 */
export function WhatIfCard({
  netMonthlyCents,
  horizonLabel,
  onSeeAssumptions,
}: WhatIfCardProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  const rows: { key: string; label: string; value: React.ReactNode }[] = [
    {
      key: "net",
      label: t("projection.netMonthlyCashFlow"),
      value: (
        <Money
          cents={netMonthlyCents}
          locale={locale}
          sign="always"
          {...maskProps}
        />
      ),
    },
    {
      key: "income",
      label: t("projection.incomeGrowth"),
      value: t("insights.v2.percentPerYear", {
        percent: (INCOME_GROWTH_RATE * 100).toFixed(1),
      }),
    },
    {
      key: "expense",
      label: t("projection.expenseGrowth"),
      value: t("insights.v2.percentPerYear", {
        percent: (EXPENSE_GROWTH_RATE * 100).toFixed(1),
      }),
    },
    {
      key: "horizon",
      label: t("insights.v2.lookingAhead"),
      value: horizonLabel,
    },
  ];

  return (
    <Card data-testid="projection-what-if">
      <CardHeader>
        <CardTitle icon={SlidersHorizontalIcon}>
          {t("insights.v2.whatIfTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl>
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-4 border-b border-line py-3.5 last:border-b-0"
            >
              <dt className="min-w-0 text-body text-ink-dim">{row.label}</dt>
              <dd>
                <Badge variant="brand">{row.value}</Badge>
              </dd>
            </div>
          ))}
        </dl>
        <Button
          variant="outline"
          size="lg"
          className="mt-4 w-full"
          onClick={onSeeAssumptions}
          data-testid="projection-see-assumptions"
        >
          {t("insights.v2.seeAssumptions")}
        </Button>
      </CardContent>
    </Card>
  );
}
