import { useTranslation } from "react-i18next";
import { Link, useRouterState } from "@tanstack/react-router";
import { Car, LayoutDashboard } from "lucide-react";
import { SegmentedNav, SegmentedNavItem, focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";
import { MonthNavigator } from "@/components/budget/MonthNavigator";
import { usePeriod } from "@/hooks/usePeriod";
import {
  DESTINATIONS,
  PERIOD_AWARE_DESTINATIONS,
  isDestinationActive,
} from "@/lib/navigation";
import { AGENTS } from "@/lib/agents";

const carNavItems = [
  { to: "/car", labelKey: "nav.carDashboard", icon: LayoutDashboard },
  { to: "/car/garage", labelKey: "nav.maintenanceGarage", icon: Car },
] as const;

// DESIGN.md {components.destination-active}: a 2px brand underline, four destinations, never more.
// The transparent border on the inactive state keeps items from shifting a pixel when activated.
function destinationClass(active: boolean) {
  return cn(
    "flex min-h-target-min items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-label no-underline transition-colors",
    active ? "border-brand text-brand-ink" : "border-transparent text-ink-dim hover:text-ink",
    focusRing
  );
}

function FinanceNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { year, month, setPeriod } = usePeriod();

  const active = DESTINATIONS.find((d) => isDestinationActive(d, pathname));
  const subSurfaces = active?.children ?? [];
  const showsPeriod = PERIOD_AWARE_DESTINATIONS.some((to) => to === active?.to);

  return (
    <div className="shrink-0">
      <nav
        aria-label={t("nav.financeNav")}
        className={cn(
          "flex items-center gap-1 bg-chrome px-page-x",
          subSurfaces.length === 0 && "border-b border-line"
        )}
      >
        {DESTINATIONS.map((destination) => (
          <Link
            key={destination.to}
            // Deep-link straight to the first sub-surface so the destination index redirect never
            // has to run, which would otherwise show a frame of the wrong surface.
            to={destination.children[0]?.to ?? destination.to}
            className={destinationClass(isDestinationActive(destination, pathname))}
          >
            {t(destination.labelKey)}
          </Link>
        ))}

        <span className="flex-1" />

        {/* The period is rendered exactly once, here, for every destination that reads it. */}
        {showsPeriod && (
          <MonthNavigator selectedYear={year} selectedMonth={month} onChange={setPeriod} />
        )}
      </nav>

      {subSurfaces.length > 0 && (
        <SegmentedNav aria-label={t(`${active?.labelKey ?? "nav.financeNav"}`)}>
          {subSurfaces.map((sub) => (
            <SegmentedNavItem
              key={sub.to}
              active={pathname === sub.to || pathname.startsWith(`${sub.to}/`)}
              render={<Link to={sub.to} />}
            >
              {t(sub.labelKey)}
            </SegmentedNavItem>
          ))}
        </SegmentedNav>
      )}
    </div>
  );
}

export function DestinationNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Car and AI each sit inside a single rail module with a handful of sub-surfaces, which is the
  // segmented sub-nav case. Finance is the only module with destinations.
  if (pathname.startsWith("/car")) {
    return (
      <SegmentedNav aria-label={t("nav.carNav")} className="shrink-0">
        {carNavItems.map((item) => (
          <SegmentedNavItem
            key={item.to}
            className="gap-2"
            active={
              item.to === "/car"
                ? pathname === "/car" || pathname === "/car/"
                : pathname === item.to || pathname.startsWith(`${item.to}/`)
            }
            render={<Link to={item.to} activeOptions={{ exact: item.to === "/car" }} />}
          >
            <item.icon className="size-4 shrink-0" aria-hidden="true" />
            {t(item.labelKey)}
          </SegmentedNavItem>
        ))}
      </SegmentedNav>
    );
  }

  // Settings owns its own section sub-nav, so it gets no destination strip. The explicit null is
  // load-bearing: the fallthrough is FinanceNav, which would paint Finance tabs over Settings.
  if (pathname.startsWith("/settings")) {
    return null;
  }

  if (pathname.startsWith("/ai")) {
    return (
      <SegmentedNav aria-label={t("nav.aiNav")} className="shrink-0">
        {AGENTS.map((agent) => (
          <SegmentedNavItem
            key={agent.id}
            className="gap-2"
            active={pathname === `/ai/${agent.id}`}
            render={<Link to="/ai/$agentId" params={{ agentId: agent.id }} />}
          >
            <agent.icon className="size-4 shrink-0" aria-hidden="true" />
            {t(agent.nameKey)}
          </SegmentedNavItem>
        ))}
      </SegmentedNav>
    );
  }

  return <FinanceNav />;
}
