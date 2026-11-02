import { useTranslation } from "react-i18next";
import { formatMoney } from "@nixus/shared";
import { useBudgetStatus } from "@/hooks/useBudget";
import { useMaintenance } from "@/hooks/useMaintenance";
import { useAccounts } from "@/hooks/useAccounts";
import { useLatestExpense } from "@/hooks/useExpenses";
import { useFinancialHealthSummary } from "@/hooks/useFinancialHealth";
import { useRecentNetWorthSnapshots } from "@/hooks/useNetWorth";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { currencyLocale } from "@/lib/formatCurrency";
import {
  flattenInboxItems,
  formatNextDueLine,
  formatVehicleDisplayName,
  getMaintenanceStatusLabelKey,
  getMaintenanceTaskLabel,
} from "@/lib/maintenanceUtils";

/**
 * Home's pre-built half: what needs the user's attention and what to do next, computed locally
 * from data the app already holds. Nothing here calls an AI provider — opening Home never spends a
 * hosted request (FR-8) — and nothing here leaves the device.
 */

/** A balance the user has not touched in this long is probably no longer true. */
const STALE_BALANCE_DAYS = 30;
/** A tracker with no spending logged for this long has usually stopped being fed, not stopped spending. */
const QUIET_SPENDING_DAYS = 21;
/** A category this far into its target is worth a look before it goes over. */
const NEAR_TARGET_RATIO = 0.9;

const DAY_MS = 86_400_000;

/** Every surface Home links into, as literals so the router can type-check each link. */
export type HomeRoute =
  | "/spending/budget"
  | "/car/garage"
  | "/car"
  | "/wealth/accounts"
  | "/wealth/where-to-put-your-money"
  | "/import";

export interface AttentionItem {
  id: string;
  status: "over" | "caution";
  name: string;
  detail: string;
  to: HomeRoute;
}

export interface Recommendation {
  id: string;
  title: string;
  body: string;
  ctaLabel: string;
  /** A route, or `composer` to open the Home composer in place. */
  to: HomeRoute | "composer";
}

export function currentMonth(now: Date = new Date()) {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function daysSince(timestamp: string, now: number): number {
  const parsed = Date.parse(timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T"));
  return Number.isNaN(parsed) ? 0 : Math.floor((now - parsed) / DAY_MS);
}

export function useHomeAttention() {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const { year, month } = currentMonth();
  const budget = useBudgetStatus(year, month);
  const vehicles = useMaintenance();
  const accounts = useAccounts();
  const latest = useLatestExpense();
  const now = Date.now();
  const money = (cents: number) =>
    hidden ? maskProps.maskedLabel : formatMoney({ cents, locale: currencyLocale(i18n.language) });

  const over: AttentionItem[] = [];
  const near: AttentionItem[] = [];
  for (const category of budget.data ?? []) {
    if (category.is_deleted || category.target_cents <= 0) continue;
    if (category.spent_cents > category.target_cents) {
      over.push({
        id: `budget-${category.id}`,
        status: "over",
        name: category.name,
        detail: t("home.attention.overBudget", {
          amount: money(category.spent_cents - category.target_cents),
        }),
        to: "/spending/budget",
      });
    } else if (category.spent_cents >= category.target_cents * NEAR_TARGET_RATIO) {
      near.push({
        id: `budget-${category.id}`,
        status: "caution",
        name: category.name,
        detail: t("home.attention.nearBudget", {
          amount: money(category.target_cents - category.spent_cents),
        }),
        to: "/spending/budget",
      });
    }
  }

  const car: AttentionItem[] = flattenInboxItems(vehicles.data ?? [], t)
    .filter(({ task }) => task.status === "overdue" || task.status === "due")
    .map(({ vehicle, task }) => ({
      id: `task-${task.id}`,
      status: task.status === "overdue" ? "over" : "caution",
      name: `${formatVehicleDisplayName(vehicle)} · ${getMaintenanceTaskLabel(task, t)}`,
      detail: formatNextDueLine(task, t) || t(getMaintenanceStatusLabelKey(task.status)),
      to: "/car/garage",
    }));

  const upkeep: AttentionItem[] = [];
  const stale = (accounts.data ?? []).filter(
    (account) => daysSince(account.updated_at, now) >= STALE_BALANCE_DAYS
  );
  if (stale.length > 0) {
    upkeep.push({
      id: "stale-balances",
      status: "caution",
      name: t("home.attention.staleBalances", { count: stale.length }),
      detail: stale.map((account) => account.name).join(", "),
      to: "/wealth/accounts",
    });
  }
  if (latest.data && daysSince(latest.data.date, now) >= QUIET_SPENDING_DAYS) {
    upkeep.push({
      id: "quiet-spending",
      status: "caution",
      name: t("home.attention.quietSpending", { days: daysSince(latest.data.date, now) }),
      detail: t("home.attention.quietSpendingDetail"),
      to: "/import",
    });
  }

  // Worst first: anything already over, then anything about to be, then upkeep the app can't do alone.
  const carOverdue = car.filter((item) => item.status === "over");
  const carDue = car.filter((item) => item.status === "caution");
  return {
    items: [...over, ...carOverdue, ...near, ...carDue, ...upkeep],
    isLoading: budget.isLoading || vehicles.isLoading || accounts.isLoading || latest.isLoading,
  };
}

export function useHomeRecommendations({ canBuild, widgetCount }: { canBuild: boolean; widgetCount: number }) {
  const { t } = useTranslation();
  const { year, month } = currentMonth();
  const health = useFinancialHealthSummary();
  const budget = useBudgetStatus(year, month);
  const snapshots = useRecentNetWorthSnapshots(12);
  const vehicles = useMaintenance();

  const recommendations: Recommendation[] = [];

  const step = health.data?.data_sufficient ? health.data.waterfall?.action_line_key : undefined;
  if (step) {
    const key = `financialHealth.card.action.${step}`;
    recommendations.push({
      id: "next-step",
      title: t(key) === key ? step : t(key),
      body: t("home.recommend.nextStepBody"),
      ctaLabel: t("financialHealth.card.seeThePlan"),
      to: "/wealth/where-to-put-your-money",
    });
  }

  if (canBuild && widgetCount === 0) {
    recommendations.push({
      id: "first-widget",
      title: t("home.recommend.firstWidgetTitle"),
      body: t("home.recommend.firstWidgetBody"),
      ctaLabel: t("home.recommend.firstWidgetCta"),
      to: "composer",
    });
  }

  const untargeted = (budget.data ?? []).filter(
    (category) => !category.is_deleted && category.target_cents <= 0 && category.spent_cents > 0
  ).length;
  if (untargeted > 0) {
    recommendations.push({
      id: "targets",
      title: t("home.recommend.targetsTitle", { count: untargeted }),
      body: t("home.recommend.targetsBody"),
      ctaLabel: t("home.recommend.targetsCta"),
      to: "/spending/budget",
    });
  }

  if (snapshots.isSuccess && (snapshots.data ?? []).length < 2) {
    recommendations.push({
      id: "net-worth",
      title: t("home.recommend.netWorthTitle"),
      body: t("home.recommend.netWorthBody"),
      ctaLabel: t("home.recommend.netWorthCta"),
      to: "/wealth/accounts",
    });
  }

  if (vehicles.isSuccess && (vehicles.data ?? []).length === 0) {
    recommendations.push({
      id: "car",
      title: t("home.recommend.carTitle"),
      body: t("home.recommend.carBody"),
      ctaLabel: t("home.recommend.carCta"),
      to: "/car",
    });
  }

  return { recommendations, isLoading: health.isLoading || budget.isLoading };
}
