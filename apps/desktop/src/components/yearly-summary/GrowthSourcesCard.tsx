import { useTranslation } from "react-i18next";
import { TrendingUpIcon } from "lucide-react";
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
  SERIES_COLOR,
  insightsLocale,
} from "@/components/spending-trends/insights-chart";
import type { YearlySummaryData } from "@/lib/types";

/**
 * The two halves of a year's net worth gain: what you put in from your pay, and what the markets
 * and your home added on top. The split is the gain minus what was left over — so it only renders
 * when both parts are known AND positive. A "growth" bar with a negative half would be a lie told
 * in geometry, and this card simply stays away in that case.
 */
export function GrowthSourcesCard({ data }: { data: YearlySummaryData }) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  const gainCents = data.net_worth_gain_cents;
  if (!data.net_worth_gain_available || gainCents === null) return null;

  const savedCents = data.cash_flow_net_cents;
  const growthCents = gainCents - savedCents;
  if (savedCents <= 0 || growthCents <= 0) return null;

  const total = savedCents + growthCents;

  return (
    <Card data-testid="year-growth-sources">
      <CardHeader>
        <CardTitle icon={TrendingUpIcon}>
          {t("insights.v2.growthSourcesTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          aria-hidden="true"
          className="flex h-3 overflow-hidden rounded-full bg-track"
        >
          <span
            className="block"
            style={{
              flexGrow: savedCents,
              flexBasis: 0,
              background: SERIES_COLOR.in,
            }}
          />
          <span
            className="block"
            style={{
              flexGrow: growthCents,
              flexBasis: 0,
              background: SERIES_COLOR.projected,
            }}
          />
        </div>

        <ul className="mt-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
          {[
            {
              key: "saved",
              color: SERIES_COLOR.in,
              label: t("insights.v2.growthFromSaving"),
              cents: savedCents,
            },
            {
              key: "market",
              color: SERIES_COLOR.projected,
              label: t("insights.v2.growthFromMarkets"),
              cents: growthCents,
            },
          ].map((row) => (
            <li key={row.key} className="flex items-center gap-2.5 text-body">
              <LegendDot color={row.color} />
              <span className="text-ink-dim">{row.label}</span>
              <Money
                cents={row.cents}
                locale={locale}
                className="font-bold text-ink"
                {...maskProps}
              />
              <span className="money text-caption text-ink-faint">
                {t("insights.percentOfSpending", {
                  percent: Math.round((row.cents / total) * 100),
                })}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
