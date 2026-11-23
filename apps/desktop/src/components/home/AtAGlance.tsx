import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  Car,
  Landmark,
  Receipt,
  TrendingUp,
  Upload,
  Wallet,
  Wrench,
} from "lucide-react";
import { Meter, Money, formatMoney } from "@nixus/shared";
import { MetricTile } from "@/components/shared/MetricTile";
import { NetWorthSparkline } from "@/components/dashboard/NetWorthSparkline";
import { daysLeftInMonth, monthName } from "@/components/dashboard/monthPace";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { useBudgetSummary } from "@/hooks/useDashboard";
import { useIncomeTotal } from "@/hooks/useIncome";
import { useMaintenance } from "@/hooks/useMaintenance";
import { useCurrentNetWorth, useRecentNetWorthSnapshots } from "@/hooks/useNetWorth";
import { currentMonth } from "@/hooks/useHomeOverview";
import { currencyLocale } from "@/lib/formatCurrency";
import { summarizeMaintenanceFleet } from "@/lib/maintenanceUtils";
import { cn } from "@/lib/utils";

/** Home's "stack overview": every module's state in one tile, each a door into that module. */
export function AtAGlance() {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const locale = currencyLocale(i18n.language);
  const money = (cents: number, sign?: "always") =>
    hidden ? maskProps.maskedLabel : formatMoney({ cents, locale, sign });
  const { year, month } = currentMonth();

  const netWorth = useCurrentNetWorth();
  const snapshots = useRecentNetWorthSnapshots(12);
  const budget = useBudgetSummary(year, month);
  const income = useIncomeTotal(year, month);
  const vehicles = useMaintenance();

  const history = snapshots.data ?? [];

  const spent = budget.data?.total_spent_cents ?? 0;
  const target = budget.data?.total_target_cents ?? 0;
  const remaining = target - spent;
  const incomeCents = income.data?.total_cents ?? 0;
  const net = incomeCents - spent;
  const fleet = summarizeMaintenanceFleet(vehicles.data ?? [], t);

  const daysLeft = daysLeftInMonth(year, month);
  const label = monthName(year, month, i18n.language);

  const figure = (cents: number, sign?: "always") => (
    <Money cents={cents} locale={locale} sign={sign} {...maskProps} />
  );

  return (
    <div
      className="grid grid-cols-1 gap-grid-gap @2xl:grid-cols-2 @5xl:grid-cols-4"
      data-testid="home-glance"
    >
      <MetricTile
        icon={Landmark}
        label={t("home.glance.netWorth")}
        value={figure(netWorth.data?.total_cents ?? 0)}
        caption={
          history.length < 2 ? t("home.glance.netWorthNoTrend") : undefined
        }
        footer={history.length >= 2 ? <NetWorthSparkline snapshots={history} /> : undefined}
        href="/wealth/net-worth"
        linkLabel={`${t("home.glance.netWorth")}, ${money(netWorth.data?.total_cents ?? 0)}`}
        isLoading={netWorth.isLoading}
        data-testid="home-glance-net-worth"
      />

      <MetricTile
        icon={Wallet}
        label={t("home.glance.spending")}
        value={figure(spent)}
        caption={
          target > 0 ? t("home.v2.budgetedOf", { target: money(target) }) : t("home.glance.spendingNoBudget")
        }
        footer={
          target > 0 ? (
            <div className="flex flex-col gap-2">
              <Meter
                value={Math.min(100, (spent / target) * 100)}
                label={t("home.glance.spendingMeter")}
                valueText={t("home.glance.spendingOf", { target: money(target) })}
                color={spent > target ? "var(--over)" : undefined}
              />
              <span
                className={cn("text-caption", spent > target ? "text-over-ink" : "text-ink-dim")}
              >
                {spent > target
                  ? t("home.glance.spendingOver", { amount: money(spent - target) })
                  : t("dashboard.categoryLeft", { amount: money(remaining) })}
                {daysLeft !== null && daysLeft > 0 && (
                  <span className="text-ink-dim">
                    {" \u00b7 "}
                    {t("home.v2.daysLeft", { count: daysLeft, month: label })}
                  </span>
                )}
              </span>
            </div>
          ) : undefined
        }
        href="/spending/budget"
        linkLabel={`${t("home.glance.spending")}, ${money(spent)}`}
        isLoading={budget.isLoading}
        data-testid="home-glance-spending"
      />

      <MetricTile
        icon={TrendingUp}
        label={t("dashboard.moneyIn")}
        value={figure(incomeCents)}
        caption={
          <>
            {t("home.v2.netCashFlow")}{" "}
            <span className={net < 0 ? "text-over-ink" : "text-good-ink"}>
              {money(net, "always")}
            </span>
          </>
        }
        footer={
          incomeCents > 0 ? (
            <Meter
              value={Math.min(100, (spent / incomeCents) * 100)}
              label={t("dashboard.cashFlowMeterLabel")}
              valueText={t("home.glance.cashFlowInOut", {
                income: money(incomeCents),
                spent: money(spent),
              })}
              color="var(--chart-2)"
            />
          ) : undefined
        }
        href="/spending/income"
        linkLabel={`${t("dashboard.moneyIn")}, ${money(incomeCents)}`}
        isLoading={budget.isLoading || income.isLoading}
        data-testid="home-glance-cash-flow"
      />

      <MetricTile
        icon={Car}
        label={t("home.glance.car")}
        value={
          fleet.vehicleCount === 0
            ? t("home.glance.carNone")
            : fleet.needsAttentionCount > 0
              ? t("home.glance.carAttention", { count: fleet.needsAttentionCount })
              : t("home.glance.carOnTrack")
        }
        caption={
          fleet.vehicleCount === 0
            ? t("home.glance.carNoneBody")
            : t("home.glance.carVehicles", { count: fleet.vehicleCount })
        }
        href="/car"
        linkLabel={t("home.glance.openCar")}
        isLoading={vehicles.isLoading}
        data-testid="home-glance-car"
      />
    </div>
  );
}

const QUICK_ACTIONS = [
  { to: "/import", icon: Upload, labelKey: "home.quick.import" },
  { to: "/spending/transactions", icon: Receipt, labelKey: "home.quick.expense" },
  { to: "/car/garage", icon: Wrench, labelKey: "home.quick.service" },
] as const;

/** A white pill with a gradient line icon — the charte's chip, raised off the glass panel. */
const QUICK_ACTION_CLASS = cn(
  "inline-flex min-h-target-min items-center gap-2 rounded-full border border-transparent bg-card px-3.5 py-2",
  "text-label text-ink no-underline transition-colors hover:border-brand/40",
  "[&_svg]:size-4 [&_svg]:shrink-0"
);

/** The upkeep the app exists to make quick — one click from the first screen. */
export function QuickActions() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("home.quick.label")}
      className="flex flex-wrap gap-2.5"
      data-testid="home-quick-actions"
    >
      {QUICK_ACTIONS.map(({ to, icon: Icon, labelKey }) => (
        <Link key={to} to={to} className={QUICK_ACTION_CLASS}>
          <Icon className="icon-gradient" strokeWidth={1.75} aria-hidden="true" />
          {t(labelKey)}
        </Link>
      ))}
      <Link
        to="/ai/$agentId"
        params={{ agentId: "budget-helper" }}
        className={QUICK_ACTION_CLASS}
      >
        <Bot className="icon-gradient" strokeWidth={1.75} aria-hidden="true" />
        {t("home.quick.chat")}
      </Link>
    </nav>
  );
}
