import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Eyebrow, focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";
import { MonthNavigator } from "@/components/budget/MonthNavigator";
import { usePeriod } from "@/hooks/usePeriod";
import { PERIOD_AWARE_DESTINATIONS, findDestination } from "@/lib/navigation";

/** The shell's skip link and its route-change focus move both target this id. */
export const SURFACE_HEADING_ID = "surface-heading";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /**
   * The kicker above the title. Derived from the route by default — the Finance destination the
   * surface belongs to ("SPENDING"), or its rail module ("CAR"). Pass a string to override it, or
   * `null` for none.
   */
  eyebrow?: string | null;
  /**
   * Whether the global month navigator renders beside the title. Defaults to whether the surface's
   * destination reads the period (Today, Spending, Insights). The period is rendered exactly once,
   * here, for every surface that reads it.
   */
  period?: boolean;
}

const MODULE_EYEBROWS: readonly { prefix: string; labelKey: string }[] = [
  { prefix: "/car", labelKey: "sidebar.car" },
  { prefix: "/ai", labelKey: "sidebar.ai" },
  { prefix: "/import", labelKey: "sidebar.finance" },
];

function useDerivedHeaderContext() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const destination = findDestination(pathname);

  if (destination) {
    return {
      // Today is the Finance landing surface, so its kicker names the module rather than itself.
      eyebrowKey: destination.to === "/" ? "sidebar.finance" : destination.labelKey,
      periodAware: PERIOD_AWARE_DESTINATIONS.some((to) => to === destination.to),
    };
  }

  const module = MODULE_EYEBROWS.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  return { eyebrowKey: module?.labelKey ?? null, periodAware: false };
}

function PeriodNavigator() {
  const { year, month, setPeriod } = usePeriod();
  return <MonthNavigator selectedYear={year} selectedMonth={month} onChange={setPeriod} />;
}

export function PageHeader({ title, subtitle, actions, eyebrow, period }: PageHeaderProps) {
  const { t } = useTranslation();
  const derived = useDerivedHeaderContext();

  const eyebrowText =
    eyebrow === undefined ? (derived.eyebrowKey ? t(derived.eyebrowKey) : null) : eyebrow;
  const showsPeriod = period ?? derived.periodAware;

  return (
    <div className="mb-section-gap flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrowText && <Eyebrow className="mb-2.5">{eyebrowText}</Eyebrow>}
        {/* tabIndex -1 makes the heading a programmatic focus target: the shell persists across
         * navigation, so without this a keyboard user who activates a nav item stays on the nav
         * and has to tab through the whole chrome to reach content. */}
        <h1
          id={SURFACE_HEADING_ID}
          data-surface-heading=""
          tabIndex={-1}
          className={cn("text-display text-ink", focusRing)}
        >
          {title}
        </h1>
        {subtitle && <p className="mt-2 max-w-3xl text-body text-ink-dim">{subtitle}</p>}
      </div>
      {(actions || showsPeriod) && (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {actions}
          {showsPeriod && <PeriodNavigator />}
        </div>
      )}
    </div>
  );
}
