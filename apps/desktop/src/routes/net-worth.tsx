import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@nkbaz/shared";
import { Card, CardContent } from "@nkbaz/shared";
import { NetWorthTrendChart } from "@/components/net-worth/NetWorthTrendChart";
import { NetWorthBreakdownBar } from "@/components/net-worth/NetWorthBreakdownBar";
import {
  useCurrentNetWorth,
  useNetWorthHistory,
  useNetWorthChange,
} from "@/hooks/useNetWorth";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { parseNetWorthBreakdown } from "@/lib/parseNetWorthBreakdown";
import { cn } from "@/lib/utils";
import { PillTabs } from "@nkbaz/shared";

export const Route = createFileRoute("/net-worth")({
  component: NetWorthPage,
});

const PERIODS = ["6m", "1y", "all"] as const;
// PERIOD_LABELS is built inside the component to access t()

function NetWorthPage() {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const [period, setPeriod] = useState<string>("1y");

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

  const latestSnapshot = historyData.length > 0 ? historyData[historyData.length - 1] : null;
  const breakdownCategories = latestSnapshot
    ? parseNetWorthBreakdown(latestSnapshot.breakdown_json)
    : [];

  const trendText = (() => {
    if (!changeData || changeData.direction === "flat") return null;
    const arrow = changeData.direction === "up" ? "↑" : "↓";
    const sign = changeData.direction === "up" ? "+" : "";
    return `${arrow} ${sign}${formatCurrency(changeData.absolute_change_cents)} (${sign}${changeData.percentage_change.toFixed(1)}%)`;
  })();

  const trendColor =
    changeData?.direction === "up"
      ? "text-emerald-600"
      : changeData?.direction === "down"
        ? "text-rose-600"
        : "text-muted-foreground";

  const isEmpty = historyData.length === 0 && !history.isPending;

  return (
    <div>
      <PageHeader
        title={t("nav.netWorth")}
        subtitle={
          nw
            ? undefined
            : undefined
        }
      />

      {/* Current total + trend */}
      {nw && (
        <div className="mb-4">
          <span
            className="text-[32px] font-mono font-semibold"
            data-testid="net-worth-total"
          >
            {formatCurrency(nw.total_cents)}
          </span>
          {trendText && (
            <span className={cn("ml-3 text-sm", trendColor)} data-testid="net-worth-trend">
              {trendText}
            </span>
          )}
        </div>
      )}

      {/* Period tabs */}
      <div className="mb-4">
        <PillTabs
          options={PERIODS}
          labels={periodLabels}
          value={period}
          onChange={setPeriod}
          data-testid="period-tabs"
        />
      </div>

      {isEmpty ? (
        <Card className="shadow-sm rounded-lg" data-testid="empty-net-worth">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              {t("netWorth.noHistory")}
            </p>
            <div className="flex gap-2 justify-center mt-3">
              <Link to="/accounts">
                <Button data-testid="add-account-btn">{t("accounts.addAccount")}</Button>
              </Link>
              <Link to="/assets">
                <Button variant="outline" data-testid="add-asset-btn">{t("assets.addAsset")}</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <NetWorthTrendChart
            data={historyData}
            isLoading={history.isPending}
          />

          <div className="mt-4">
            <NetWorthBreakdownBar
              breakdown={breakdownCategories}
              isLoading={history.isPending}
            />
          </div>
        </>
      )}
    </div>
  );
}
