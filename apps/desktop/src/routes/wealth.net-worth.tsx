import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LineChart, TrendingDown, TrendingUp } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  formatMoney,
  PillTabs,
  Stat,
} from "@nixus/shared";
import { NetWorthTrendChart } from "@/components/net-worth/NetWorthTrendChart";
import { NetWorthBreakdownBar } from "@/components/net-worth/NetWorthBreakdownBar";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  useCurrentNetWorth,
  useNetWorthHistory,
  useNetWorthChange,
} from "@/hooks/useNetWorth";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import { parseNetWorthBreakdown } from "@/lib/parseNetWorthBreakdown";

export const Route = createFileRoute("/wealth/net-worth")({
  component: NetWorthIndexPage,
});

const PERIODS = ["6m", "1y", "all"] as const;

function NetWorthIndexPage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("1y");

  const periodLabels: Record<string, string> = {
    "6m": t("netWorth.period6M"),
    "1y": t("netWorth.period1Y"),
    all: t("netWorth.periodAll"),
  };

  const netWorth = useCurrentNetWorth();
  const history = useNetWorthHistory(period);
  const change = useNetWorthChange(period);

  const nw = netWorth.data;
  const historyData = history.data ?? [];
  const changeData = change.data;

  const latestSnapshot =
    historyData.length > 0 ? historyData[historyData.length - 1] : null;
  const breakdownCategories = latestSnapshot
    ? parseNetWorthBreakdown(latestSnapshot.breakdown_json)
    : [];

  // A rise or fall in net worth is an ordinary fluctuation, not a pass or a fail, so it is stated in
  // words at ink-dim rather than coloured good/over — status colours are not decoration for a delta.
  const changeCaption = (() => {
    if (!changeData || changeData.direction === "flat") return null;
    const amount = maskProps.masked
      ? maskProps.maskedLabel
      : formatMoney({
          cents: Math.abs(changeData.absolute_change_cents),
          locale: i18n.language,
        });
    const percent = new Intl.NumberFormat(i18n.language, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(Math.abs(changeData.percentage_change) / 100);
    return t(
      changeData.direction === "up"
        ? "netWorth.changeUp"
        : "netWorth.changeDown",
      { amount, percent }
    );
  })();

  const ChangeIcon = changeData?.direction === "down" ? TrendingDown : TrendingUp;
  const isEmpty = historyData.length === 0 && !history.isPending;

  return (
    <div>
      {/* Carries the surface <h1>, which is also the shell's skip-link and route-change focus
       * target — without it a keyboard user landing here has nothing to focus. */}
      <PageHeader title={t("nav.netWorth")} />

      <div className="flex flex-col gap-section-gap">
        {nw && (
          <div className="flex flex-col gap-1">
            <Stat
              label={t("netWorth.totalLabel")}
              value={formatMoney({
                cents: nw.total_cents,
                locale: i18n.language,
              })}
              data-testid="net-worth-total"
              {...maskProps}
            />
            {changeCaption && (
              <p
                className="flex items-center gap-1.5 text-caption text-ink-dim"
                data-testid="net-worth-trend"
              >
                <ChangeIcon className="size-3.5 shrink-0" aria-hidden="true" />
                {changeCaption}
              </p>
            )}
          </div>
        )}

        <PillTabs
          options={PERIODS}
          labels={periodLabels}
          value={period}
          onChange={setPeriod}
          data-testid="period-tabs"
        />

        {isEmpty ? (
          <Card data-testid="empty-net-worth">
            <CardContent>
              <EmptyState
                icon={<LineChart />}
                title={t("netWorth.empty.title")}
                description={t("netWorth.empty.body")}
                action={
                  <Button
                    render={<Link to="/wealth/accounts" />}
                    data-testid="add-account-btn"
                  >
                    {t("netWorth.empty.action")}
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <NetWorthTrendChart
              data={historyData}
              isLoading={history.isPending}
            />
            <NetWorthBreakdownBar
              breakdown={breakdownCategories}
              isLoading={history.isPending}
            />
          </>
        )}
      </div>
    </div>
  );
}
