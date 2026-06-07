import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const SECTIONS = [
  {
    id: "net-worth",
    to: "/net-worth" as const,
    labelKey: "nav.netWorth",
    isActive: (pathname: string) =>
      pathname === "/net-worth" || pathname === "/net-worth/",
  },
  {
    id: "financial-health",
    to: "/net-worth/financial-health" as const,
    labelKey: "netWorth.section.financialHealth",
    isActive: (pathname: string) =>
      pathname.startsWith("/net-worth/financial-health"),
  },
] as const;

export function NetWorthSectionNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 mb-6"
      aria-label={t("netWorth.section.navLabel")}
      data-testid="net-worth-section-nav"
    >
      {SECTIONS.map((section) => {
        const active = section.isActive(pathname);
        return (
          <Link
            key={section.id}
            to={section.to}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={`section-nav-${section.id}`}
            aria-current={active ? "page" : undefined}
          >
            {t(section.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
