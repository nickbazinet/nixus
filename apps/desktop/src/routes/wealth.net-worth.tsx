import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChartNoAxesColumn,
  CreditCard,
  House,
  LineChart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  formatMoney,
  IconChip,
  Meter,
  Money,
  PillTabs,
} from "@nixus/shared";
import { NetWorthTrendChart } from "@/components/net-worth/NetWorthTrendChart";
import { NetWorthBreakdownBar } from "@/components/net-worth/NetWorthBreakdownBar";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  useCurrentNetWorth,
  useNetWorthHistory,
  useNetWorthChange,
} from "@/hooks/useNetWorth";
import { useAccounts } from "@/hooks/useAccounts";
import { useAssets } from "@/hooks/useAssets";
import { useYearlySummary } from "@/hooks/useYearlySummary";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import {
  isLiabilityAccountType,
  owedBalanceCents,
  partitionAccounts,
  sumBalanceCents,
  sumLiabilityOwedCents,
  ACCOUNT_TYPE_ICONS,
  ACCOUNT_TYPE_KEYS,
} from "@/lib/accountUtils";
import { parseNetWorthBreakdown } from "@/lib/parseNetWorthBreakdown";

export const Route = createFileRoute("/wealth/net-worth")({
  component: NetWorthIndexPage,
});

const PERIODS = ["6m", "1y", "all"] as const;

/** The account types that are money you can spend today rather than money that is invested. */
const CASH_TYPES = ["chequing", "savings"] as const;

interface HoldingLine {
  key: string;
  icon: LucideIcon;
  label: string;
  caption: string | null;
  cents: number;
}

/** One hairline row of a composition card: a chip, what it is, and how much of it there is. */
function HoldingRow({ line, sign }: { line: HoldingLine; sign?: "never" }) {
  const { i18n } = useTranslation();
  const maskProps = useMaskProps();

  return (
    <div className="flex items-center gap-3 border-b border-line py-3.5 last:border-b-0">
      <IconChip icon={line.icon} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-label text-ink">{line.label}</p>
        {line.caption && (
          <p className="truncate text-caption text-ink-dim">{line.caption}</p>
        )}
      </div>
      <span className="money shrink-0 text-label font-bold text-ink">
        <Money
          cents={line.cents}
          locale={i18n.language}
          sign={sign}
          {...maskProps}
        />
      </span>
    </div>
  );
}

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
  // `?? []` rather than a destructuring default: a read that resolves to null (an empty profile,
  // a partial dataset) is not `undefined`, so the default would not fire and the sums below would
  // be handed a non-iterable.
  const accountsQuery = useAccounts();
  const assetsQuery = useAssets();
  const accounts = accountsQuery.data ?? [];
  const assets = assetsQuery.data ?? [];
  const yearlySummary = useYearlySummary(new Date().getFullYear());

  const nw = netWorth.data;
  const historyData = history.data ?? [];
  const changeData = change.data;

  const latestSnapshot =
    historyData.length > 0 ? historyData[historyData.length - 1] : null;
  const breakdownCategories = latestSnapshot
    ? parseNetWorthBreakdown(latestSnapshot.breakdown_json)
    : [];

  // What the user has, in the three groups they think in — built from the accounts and assets the
  // app already holds, so every line is a sum of real rows rather than a share of a total.
  const holdings = useMemo<HoldingLine[]>(() => {
    const { assetAccounts } = partitionAccounts(accounts);
    const cashAccounts = assetAccounts.filter((account) =>
      (CASH_TYPES as readonly string[]).includes(account.account_type)
    );
    const investmentAccounts = assetAccounts.filter(
      (account) => !(CASH_TYPES as readonly string[]).includes(account.account_type)
    );

    const lines: HoldingLine[] = [];
    if (cashAccounts.length > 0) {
      lines.push({
        key: "cash",
        icon: Wallet,
        label: t("wealth.v2.accounts.cash"),
        caption: t("wealth.v2.accounts.accountCount", {
          count: cashAccounts.length,
        }),
        cents: sumBalanceCents(cashAccounts),
      });
    }
    if (investmentAccounts.length > 0) {
      lines.push({
        key: "investments",
        icon: ChartNoAxesColumn,
        label: t("wealth.v2.accounts.investments"),
        caption: t("wealth.v2.accounts.accountCount", {
          count: investmentAccounts.length,
        }),
        cents: sumBalanceCents(investmentAccounts),
      });
    }
    if (assets.length > 0) {
      lines.push({
        key: "assets",
        icon: House,
        label: t("wealth.v2.netWorth.things"),
        caption: t("wealth.v2.netWorth.assetCount", { count: assets.length }),
        cents: assets.reduce((sum, asset) => sum + asset.value_cents, 0),
      });
    }
    return lines;
  }, [accounts, assets, t]);

  const debts = useMemo<HoldingLine[]>(
    () =>
      accounts
        .filter((account) => isLiabilityAccountType(account.account_type))
        .map((account) => ({
          key: `debt-${account.id}`,
          icon: ACCOUNT_TYPE_ICONS[account.account_type] ?? CreditCard,
          label: account.name,
          caption: ACCOUNT_TYPE_KEYS[account.account_type]
            ? t(ACCOUNT_TYPE_KEYS[account.account_type])
            : account.account_type,
          cents: owedBalanceCents(account.balance_cents),
        })),
    [accounts, t]
  );

  const holdingsTotal = holdings.reduce((sum, line) => sum + line.cents, 0);
  const debtTotal = sumLiabilityOwedCents(
    accounts.filter((account) => isLiabilityAccountType(account.account_type))
  );

  // Only the year's own figures, and only when Rust says the net-worth gain is knowable: the two
  // halves are "what you put in" (cash flow) and "what the market and the house did" (the rest).
  const year = yearlySummary.data;
  const yearGainCents =
    year?.net_worth_gain_available && year.net_worth_gain_cents !== null
      ? year.net_worth_gain_cents
      : null;
  const savedCents = year?.cash_flow_net_cents ?? 0;
  const growthCents = yearGainCents === null ? 0 : yearGainCents - savedCents;
  const movementScale = Math.max(Math.abs(savedCents), Math.abs(growthCents), 1);

  // A rise or fall in net worth is an ordinary fluctuation, not a pass or a fail, so it is stated in
  // words rather than only as a colour — the direction word leads the sentence.
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

  const isDown = changeData?.direction === "down";
  const ChangeIcon = isDown ? TrendingDown : TrendingUp;
  const isEmpty = historyData.length === 0 && !history.isPending;

  return (
    <div>
      {/* Carries the surface <h1>, which is also the shell's skip-link and route-change focus
       * target — without it a keyboard user landing here has nothing to focus. */}
      <PageHeader
        title={t("nav.netWorth")}
        subtitle={t("surface.subtitle.netWorth")}
      />

      <div className="flex flex-col gap-grid-gap">
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
            <Card tone="featured">
              <CardHeader>
                <div>
                  <p className="text-label text-ink-dim">
                    {t("wealth.v2.netWorth.today")}
                  </p>
                  {nw && (
                    <p
                      className="money mt-1 text-[44px] leading-[1.05] font-bold tracking-[-0.02em] text-ink"
                      data-testid="net-worth-total"
                    >
                      <Money
                        cents={nw.total_cents}
                        locale={i18n.language}
                        {...maskProps}
                      />
                    </p>
                  )}
                  {changeCaption && (
                    <p
                      className={`mt-2 flex items-center gap-1.5 text-label ${
                        isDown ? "text-over-ink" : "text-good-ink"
                      }`}
                      data-testid="net-worth-trend"
                    >
                      <ChangeIcon className="size-4 shrink-0" aria-hidden="true" />
                      {changeCaption}
                    </p>
                  )}
                </div>
                <CardAction>
                  <PillTabs
                    options={PERIODS}
                    labels={periodLabels}
                    value={period}
                    onChange={setPeriod}
                    data-testid="period-tabs"
                  />
                </CardAction>
              </CardHeader>
              <CardContent>
                <NetWorthTrendChart
                  data={historyData}
                  isLoading={history.isPending}
                />
              </CardContent>
            </Card>

            <div className="grid gap-grid-gap md:grid-cols-2 xl:grid-cols-3">
              {holdings.length > 0 && (
                <Card data-testid="net-worth-holdings">
                  <CardHeader>
                    <CardTitle icon={ChartNoAxesColumn}>
                      {t("wealth.v2.accounts.haveLabel")}
                    </CardTitle>
                    <CardAction className="self-center">
                      <span className="money text-h2 font-bold text-ink">
                        <Money
                          cents={holdingsTotal}
                          locale={i18n.language}
                          {...maskProps}
                        />
                      </span>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    {holdings.map((line) => (
                      <HoldingRow key={line.key} line={line} />
                    ))}
                  </CardContent>
                </Card>
              )}

              {debts.length > 0 && (
                <Card data-testid="net-worth-debts">
                  <CardHeader>
                    <CardTitle icon={CreditCard}>
                      {t("wealth.v2.assets.owe")}
                    </CardTitle>
                    <CardAction className="self-center">
                      <span className="money text-h2 font-bold text-ink">
                        <Money
                          cents={debtTotal}
                          locale={i18n.language}
                          sign="never"
                          {...maskProps}
                        />
                      </span>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    {debts.map((line) => (
                      <HoldingRow key={line.key} line={line} sign="never" />
                    ))}
                  </CardContent>
                </Card>
              )}

              {yearGainCents !== null && (
                <Card data-testid="net-worth-movement">
                  <CardHeader>
                    <CardTitle icon={TrendingUp}>
                      {t("wealth.v2.netWorth.whatMoved")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-caption text-ink-dim">
                          {t("wealth.v2.netWorth.youSaved")}
                        </span>
                        <span className="money text-label font-bold text-ink">
                          <Money
                            cents={savedCents}
                            locale={i18n.language}
                            sign="always"
                            {...maskProps}
                          />
                        </span>
                      </div>
                      <Meter
                        className="mt-2"
                        color="var(--chart-2)"
                        value={Math.abs(savedCents)}
                        max={movementScale}
                        label={t("wealth.v2.netWorth.youSaved")}
                      />
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-caption text-ink-dim">
                          {t("wealth.v2.netWorth.grew")}
                        </span>
                        <span className="money text-label font-bold text-ink">
                          <Money
                            cents={growthCents}
                            locale={i18n.language}
                            sign="always"
                            {...maskProps}
                          />
                        </span>
                      </div>
                      <Meter
                        className="mt-2"
                        color="var(--chart-4)"
                        value={Math.abs(growthCents)}
                        max={movementScale}
                        label={t("wealth.v2.netWorth.grew")}
                      />
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3.5">
                      <span className="text-label text-ink">
                        {t("wealth.v2.netWorth.totalChange")}
                      </span>
                      <span
                        className={`money text-label font-bold ${
                          yearGainCents < 0 ? "text-over-ink" : "text-good-ink"
                        }`}
                      >
                        <Money
                          cents={yearGainCents}
                          locale={i18n.language}
                          sign="always"
                          {...maskProps}
                        />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

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
