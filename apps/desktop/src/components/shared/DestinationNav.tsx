import { useTranslation } from "react-i18next";
import { Link, useRouterState } from "@tanstack/react-router";
import { Car, LayoutDashboard } from "lucide-react";
import { SegmentedNav, SegmentedNavItem, focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";
import { DESTINATIONS, isDestinationActive } from "@/lib/navigation";
import { useAgents } from "@/lib/agents";

const carNavItems = [
  { to: "/car", labelKey: "nav.carDashboard", icon: LayoutDashboard },
  { to: "/car/garage", labelKey: "nav.maintenanceGarage", icon: Car },
] as const;

// Four destinations, never more, as underlined tabs on a hairline rule: the active one is set in ink
// and carries the brand-gradient bar. The bar is a pseudo-element overlapping the rule by 1px, so
// activating a destination never shifts the row. Sub-surfaces sit beneath as soft pills.
function destinationClass(active: boolean) {
  return cn(
    "relative -mb-px flex min-h-target-min items-center whitespace-nowrap px-5 pt-2 pb-3.5 font-display text-[17px] font-semibold no-underline transition-colors",
    "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full",
    active ? "text-ink after:bg-button-gradient" : "text-ink-dim hover:text-ink",
    focusRing
  );
}

function FinanceNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const active = DESTINATIONS.find((d) => isDestinationActive(d, pathname));
  const subSurfaces = active?.children ?? [];

  return (
    <div className="mb-section-gap flex shrink-0 flex-col gap-4">
      <nav
        aria-label={t("nav.financeNav")}
        // `overflow-y-hidden` because the tabs' -1px overlap of the rule would otherwise count as
        // vertical overflow and paint a stray scrollbar thumb at the strip's right edge.
        className="flex items-end gap-2 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {DESTINATIONS.map((destination) => {
          const isActive = isDestinationActive(destination, pathname);
          return (
            <Link
              key={destination.to}
              // Deep-link straight to the first sub-surface so the destination index redirect never
              // has to run, which would otherwise show a frame of the wrong surface.
              to={destination.children[0]?.to ?? destination.to}
              // Router-derived `activeProps` cannot express this: the link points at the first
              // sub-surface, so it would read as inactive on every sibling sub-surface while the
              // underline says otherwise. Without it the active destination is sighted-only.
              aria-current={isActive ? "page" : undefined}
              className={destinationClass(isActive)}
            >
              {t(destination.labelKey)}
            </Link>
          );
        })}
      </nav>

      {subSurfaces.length > 0 && (
        <SegmentedNav
          variant="pills"
          aria-label={t(`${active?.labelKey ?? "nav.financeNav"}`)}
        >
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
  const { agents } = useAgents();

  // Car and AI each sit inside a single rail module with a handful of sub-surfaces, which is the
  // segmented sub-nav case. Finance is the only module with destinations.
  if (pathname.startsWith("/car")) {
    return (
      <SegmentedNav aria-label={t("nav.carNav")} className="mb-section-gap shrink-0">
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
            <item.icon className="icon-gradient size-4 shrink-0" aria-hidden="true" />
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

  // Home is its own rail module with no sub-surfaces; the same fallthrough rule applies.
  if (pathname === "/home" || pathname.startsWith("/home/")) {
    return null;
  }

  // The onboarding wizard and the account profile are not Finance surfaces: Finance pills above
  // them would claim a destination the user is not in.
  if (pathname.startsWith("/onboarding") || pathname.startsWith("/profile")) {
    return null;
  }

  if (pathname.startsWith("/ai")) {
    return (
      <SegmentedNav aria-label={t("nav.aiNav")} className="mb-section-gap shrink-0">
        {agents.map((agent) => (
          <SegmentedNavItem
            key={agent.id}
            className="gap-2"
            active={pathname === `/ai/${agent.id}`}
            render={<Link to="/ai/$agentId" params={{ agentId: agent.id }} />}
          >
            <agent.icon className="icon-gradient size-4 shrink-0" aria-hidden="true" />
            {t(agent.nameKey)}
          </SegmentedNavItem>
        ))}
      </SegmentedNav>
    );
  }

  return <FinanceNav />;
}
