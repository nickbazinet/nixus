import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  Car,
  ChevronRight,
  Gauge,
  Landmark,
  Receipt,
  Upload,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Card, Meter, Money, Skeleton, buttonVariants, formatMoney } from "@nixus/shared";
import { NetWorthSparkline } from "@/components/dashboard/NetWorthSparkline";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { useBudgetSummary } from "@/hooks/useDashboard";
import { useIncomeTotal } from "@/hooks/useIncome";
import { useMaintenance } from "@/hooks/useMaintenance";
import { useCurrentNetWorth, useRecentNetWorthSnapshots } from "@/hooks/useNetWorth";
import { currentMonth } from "@/hooks/useHomeOverview";
import { currencyLocale } from "@/lib/formatCurrency";
import { summarizeMaintenanceFleet } from "@/lib/maintenanceUtils";

type GlanceRoute = "/wealth/net-worth" | "/spending/budget" | "/spending/income" | "/car";

/**
 * One module tile: what it is, its one number, one line of context, and where it opens. The whole
 * card is the link (DESIGN.md, interactive card), so each tile is a single target.
 */
const GLANCE_ACCENT = {
  indigo: "border-l-[3px] border-l-chart-1",
  purple: "border-l-[3px] border-l-chart-3",
  pink: "border-l-[3px] border-l-chart-4",
  cyan: "border-l-[3px] border-l-chart-5",
} as const;

function GlanceTile({
  accent,
  icon: Icon,
  label,
  to,
  openLabel,
  loading,
  children,
  testId,
}: {
  accent: keyof typeof GLANCE_ACCENT;
  icon: LucideIcon;
  label: string;
  to: GlanceRoute;
  openLabel: string;
  loading: boolean;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Card
      size="sm"
      interactive
      render={<Link to={to} />}
      className={`group px-card-pad ${GLANCE_ACCENT[accent]}`}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-caption text-ink-dim">
        <span
          aria-hidden="true"
          className="grid size-7 place-items-center rounded-md bg-track text-ink-dim"
        >
          <Icon className="size-4" />
        </span>
        {label}
      </div>
      <div className="flex min-h-[88px] flex-col gap-2">{loading ? <Skeleton rows={2} /> : children}</div>
      <span className="flex items-center gap-1 text-caption text-brand-ink">
        {openLabel}
        <ChevronRight
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </Card>
  );
}

function Figure({ cents, tone }: { cents: number; tone?: "good" | "over" }) {
  const { i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  return (
    <span
      className={
        tone === "over" ? "text-stat text-over-ink" : tone === "good" ? "text-stat text-good-ink" : "text-stat text-ink"
      }
    >
      <Money cents={cents} locale={currencyLocale(i18n.language)} {...maskProps} />
    </span>
  );
}

/** Home's "stack overview": every module's state in one row, each a door into that module. */
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
  const change =
    history.length >= 2 ? history[history.length - 1].total_cents - history[0].total_cents : null;

  const spent = budget.data?.total_spent_cents ?? 0;
  const target = budget.data?.total_target_cents ?? 0;
  const incomeCents = income.data?.total_cents ?? 0;
  const net = incomeCents - spent;
  const fleet = summarizeMaintenanceFleet(vehicles.data ?? [], t);

  return (
    <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-4" data-testid="home-glance">
      <GlanceTile
        accent="indigo"
        icon={Landmark}
        label={t("home.glance.netWorth")}
        to="/wealth/net-worth"
        openLabel={t("home.glance.openNetWorth")}
        loading={netWorth.isLoading}
        testId="home-glance-net-worth"
      >
        <Figure cents={netWorth.data?.total_cents ?? 0} />
        {change === null ? (
          <span className="text-caption text-ink-dim">{t("home.glance.netWorthNoTrend")}</span>
        ) : (
          <>
            <span className="text-caption text-ink-dim">
              {t("home.glance.netWorthChange", { change: money(change, "always") })}
            </span>
            <NetWorthSparkline snapshots={history} />
          </>
        )}
      </GlanceTile>

      <GlanceTile
        accent="purple"
        icon={Wallet}
        label={t("home.glance.spending")}
        to="/spending/budget"
        openLabel={t("home.glance.openBudget")}
        loading={budget.isLoading}
        testId="home-glance-spending"
      >
        <Figure cents={spent} tone={target > 0 && spent > target ? "over" : undefined} />
        {target > 0 ? (
          <>
            <Meter
              value={Math.min(100, (spent / target) * 100)}
              label={t("home.glance.spendingMeter")}
              valueText={t("home.glance.spendingOf", { target: money(target) })}
            />
            <span className="text-caption text-ink-dim">
              {spent > target
                ? t("home.glance.spendingOver", { amount: money(spent - target) })
                : t("home.glance.spendingLeft", { amount: money(target - spent), target: money(target) })}
            </span>
          </>
        ) : (
          <span className="text-caption text-ink-dim">{t("home.glance.spendingNoBudget")}</span>
        )}
      </GlanceTile>

      <GlanceTile
        accent="pink"
        icon={Gauge}
        label={t("home.glance.cashFlow")}
        to="/spending/income"
        openLabel={t("home.glance.openIncome")}
        loading={budget.isLoading || income.isLoading}
        testId="home-glance-cash-flow"
      >
        <Figure cents={net} tone={net < 0 ? "over" : net > 0 ? "good" : undefined} />
        <span className="text-caption text-ink-dim">
          {t("home.glance.cashFlowInOut", { income: money(incomeCents), spent: money(spent) })}
        </span>
      </GlanceTile>

      <GlanceTile
        accent="cyan"
        icon={Car}
        label={t("home.glance.car")}
        to="/car"
        openLabel={t("home.glance.openCar")}
        loading={vehicles.isLoading}
        testId="home-glance-car"
      >
        {fleet.vehicleCount === 0 ? (
          <>
            <span className="text-stat text-ink">{t("home.glance.carNone")}</span>
            <span className="text-caption text-ink-dim">{t("home.glance.carNoneBody")}</span>
          </>
        ) : (
          <>
            <span className={fleet.needsAttentionCount > 0 ? "text-stat text-caution-ink" : "text-stat text-ink"}>
              {fleet.needsAttentionCount > 0
                ? t("home.glance.carAttention", { count: fleet.needsAttentionCount })
                : t("home.glance.carOnTrack")}
            </span>
            <span className="text-caption text-ink-dim">
              {t("home.glance.carVehicles", { count: fleet.vehicleCount })}
            </span>
          </>
        )}
      </GlanceTile>
    </div>
  );
}

const QUICK_ACTIONS = [
  { to: "/import", icon: Upload, labelKey: "home.quick.import" },
  { to: "/spending/transactions", icon: Receipt, labelKey: "home.quick.expense" },
  { to: "/car/garage", icon: Wrench, labelKey: "home.quick.service" },
] as const;

// Real links styled as buttons: these navigate, so they must announce as links.
const QUICK_ACTION_CLASS = buttonVariants({ variant: "outline", size: "sm" });

/** The upkeep the app exists to make quick — one click from the first screen. */
export function QuickActions() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("home.quick.label")} className="mb-section-gap flex flex-wrap gap-2" data-testid="home-quick-actions">
      {QUICK_ACTIONS.map(({ to, icon: Icon, labelKey }) => (
        <Link key={to} to={to} className={QUICK_ACTION_CLASS}>
          <Icon aria-hidden="true" />
          {t(labelKey)}
        </Link>
      ))}
      <Link to="/ai/$agentId" params={{ agentId: "budget-helper" }} className={QUICK_ACTION_CLASS}>
        <Bot aria-hidden="true" />
        {t("home.quick.chat")}
      </Link>
    </nav>
  );
}
