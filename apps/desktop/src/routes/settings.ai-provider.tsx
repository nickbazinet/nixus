import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SegmentedNav, SegmentedNavItem } from "@nixus/shared";
import { PageHeader } from "../components/shared/PageHeader";
import { GeneralSettings } from "../components/settings/GeneralSettings";
import { ReadingStatementsSettings } from "../components/settings/ReadingStatementsSettings";
import { YourDataSettings } from "../components/settings/YourDataSettings";
import { AboutSettings } from "../components/settings/AboutSettings";

const SECTIONS = ["general", "reading", "data", "about"] as const;
type SettingsSectionId = (typeof SECTIONS)[number];

function isSectionId(value: unknown): value is SettingsSectionId {
  return SECTIONS.some((section) => section === value);
}

// The four sub-surfaces are search-param destinations on this one route rather than four route
// files: `routeTree.gen.ts` is generated and cannot be hand-extended here. They are still real
// router links with real URLs and working back/forward, which is what SegmentedNav requires.
export const Route = createFileRoute("/settings/ai-provider")({
  component: SettingsPage,
  validateSearch: (
    search: Record<string, unknown>
  ): { section?: SettingsSectionId } =>
    isSectionId(search.section) ? { section: search.section } : {},
});

const NAV_ITEMS: { id: SettingsSectionId; labelKey: string }[] = [
  { id: "general", labelKey: "settings.navGeneral" },
  { id: "reading", labelKey: "settings.navReadingStatements" },
  { id: "data", labelKey: "settings.navYourData" },
  { id: "about", labelKey: "settings.navAbout" },
];

function SettingsPage() {
  const { t } = useTranslation();
  const { section } = Route.useSearch();
  const active: SettingsSectionId = section ?? "general";

  return (
    <div>
      <PageHeader title={t("settings.title")} />

      <SegmentedNav
        aria-label={t("settings.subNavLabel")}
        className="-mx-page-x mb-section-gap px-0"
        data-testid="settings-sub-nav"
      >
        {NAV_ITEMS.map((item) => (
          <SegmentedNavItem
            key={item.id}
            active={item.id === active}
            render={
              <Link
                to="/settings/ai-provider"
                search={{ section: item.id }}
                data-testid={`settings-nav-${item.id}`}
              />
            }
          >
            {t(item.labelKey)}
          </SegmentedNavItem>
        ))}
      </SegmentedNav>

      <div className="mx-auto max-w-2xl">
        {active === "general" && <GeneralSettings />}
        {active === "reading" && <ReadingStatementsSettings />}
        {active === "data" && <YourDataSettings />}
        {active === "about" && <AboutSettings />}
      </div>
    </div>
  );
}
