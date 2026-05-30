import { useTranslation } from "react-i18next";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Wallet,
  DollarSign,
  Landmark,
  Gem,
  TrendingUp,
  BarChart3,
  LineChart,
  RefreshCw,
  CalendarDays,
  Bot,
  Inbox,
  Car,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { AGENTS } from "@/lib/agents";

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

const navGroups: NavItem[][] = [
  [{ to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard }],
  [
    { to: "/budget", labelKey: "nav.budget", icon: Wallet },
    { to: "/income", labelKey: "nav.income", icon: DollarSign },
    { to: "/recurring-expenses", labelKey: "nav.recurringExpenses", icon: RefreshCw },
  ],
  [
    { to: "/accounts", labelKey: "nav.accounts", icon: Landmark },
    { to: "/assets", labelKey: "nav.assets", icon: Gem },
    { to: "/net-worth", labelKey: "nav.netWorth", icon: TrendingUp },
  ],
  [
    { to: "/spending-trends", labelKey: "nav.trends", icon: BarChart3 },
    { to: "/year-summary", labelKey: "nav.yearSummary", icon: CalendarDays },
    { to: "/projection", labelKey: "nav.projection", icon: LineChart },
  ],
];

const carNavItems: NavItem[] = [
  { to: "/car", labelKey: "nav.maintenanceInbox", icon: Inbox },
  { to: "/car/garage", labelKey: "nav.maintenanceGarage", icon: Car },
];

const settingsNavItems: NavItem[] = [
  { to: "/settings/ai-provider", labelKey: "settings.aiProvider", icon: Bot },
];

export function InnerTabNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAiRoute = pathname.startsWith("/ai");
  const isCarRoute = pathname.startsWith("/car");
  const isSettingsRoute = pathname.startsWith("/settings");

  if (isCarRoute) {
    return (
      <nav aria-label={t("nav.carNav")} className="border-b border-border bg-background dark:bg-card px-6">
        <ul className="flex gap-1 -mb-px overflow-x-auto items-center">
          {carNavItems.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                activeOptions={{ exact: item.to === "/car" }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 text-sm transition-colors border-b-2 whitespace-nowrap",
                  (item.to === "/car"
                    ? pathname === "/car" || pathname === "/car/"
                    : pathname === item.to || pathname.startsWith(`${item.to}/`))
                    ? "text-primary font-medium border-primary"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                )}
              >
                <item.icon size={16} />
                {t(item.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  if (isSettingsRoute) {
    return (
      <nav aria-label={t("nav.settingsNav")} className="border-b border-border bg-background dark:bg-card px-6">
        <ul className="flex gap-1 -mb-px overflow-x-auto items-center">
          {settingsNavItems.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 text-sm transition-colors border-b-2 whitespace-nowrap",
                  pathname === item.to
                    ? "text-primary font-medium border-primary"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                )}
              >
                <item.icon size={16} />
                {t(item.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  if (isAiRoute) {
    return (
      <nav aria-label={t("nav.aiNav")} className="border-b border-border bg-background dark:bg-card px-6">
        <ul className="flex gap-1 -mb-px overflow-x-auto items-center">
          {AGENTS.map((agent) => {
            const isActive = pathname === `/ai/${agent.id}`;
            return (
              <li key={agent.id}>
                <Link
                  to="/ai/$agentId"
                  params={{ agentId: agent.id }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2.5 text-sm transition-colors border-b-2 whitespace-nowrap",
                    isActive
                      ? "text-primary font-medium border-primary"
                      : "text-muted-foreground hover:text-foreground border-transparent"
                  )}
                >
                  <agent.icon size={16} />
                  {t(agent.nameKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label={t("nav.financeNav")} className="border-b border-border bg-background dark:bg-card px-6">
      <ul className="flex gap-1 -mb-px overflow-x-auto items-center">
        {navGroups.map((group, groupIndex) => (
          <li key={groupIndex} className="contents">
            {groupIndex > 0 && (
              <span className="w-px h-5 bg-border mx-1 shrink-0" aria-hidden="true" />
            )}
            {group.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent whitespace-nowrap"
                )}
                activeProps={{
                  className: cn(
                    "flex items-center gap-2 px-3 py-2.5 text-sm text-primary font-medium border-b-2 border-primary whitespace-nowrap"
                  ),
                }}
              >
                <item.icon size={16} />
                {t(item.labelKey)}
              </Link>
            ))}
          </li>
        ))}
      </ul>
    </nav>
  );
}
