import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { getVersion } from "@tauri-apps/api/app";
import {
  Wallet,
  Car,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Monitor,
  Globe,
  SlidersHorizontal,
  Sparkles,
  House,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import { usePremiumEntitlement } from "@/hooks/useAuth";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { SyncStatusIndicator } from "@/components/sync/SyncStatusIndicator";
import {
  BuyMeACoffeeIcon,
  BUY_ME_A_COFFEE_URL,
  focusRing,
} from "@nixus/shared";
import {
  persistCollapsedPreference,
  railLabelClass,
  readCollapsedPreference,
  SidebarBrandHeader,
} from "./SidebarBrandHeader";

const themeOrder = ["light", "dark", "system"] as const;
const themeIcons = { light: Sun, dark: Moon, system: Monitor } as const;
const themeLabelKeys = { light: "sidebar.light", dark: "sidebar.dark", system: "sidebar.system" } as const;

// Module items are full pills: the active module sits in a soft brand capsule, per the charte.
// Icons are gradient line icons (`icon-gradient`) in every state; the capsule and the label colour
// carry "active", never the icon alone.
function railItemClass(expanded: boolean, active: boolean, size: "module" | "utility" = "utility") {
  return cn(
    "relative flex w-full min-h-target-min items-center rounded-full font-semibold no-underline transition-colors [&_svg]:icon-gradient",
    size === "module" ? "h-11 text-[15px]" : "h-10 text-[14.5px]",
    // Collapsed drops the gap too: the label is zero-width but still a flex item, and a gap beside
    // it would nudge the icon off the rail's centre line.
    expanded ? "gap-3 px-4" : "justify-center gap-0 px-2",
    active
      ? "bg-rail-on text-rail-on-ink"
      : "text-rail-ink hover:bg-hover hover:text-ink",
    focusRing
  );
}

export function AppSidebar() {
  // Paying cloud subscribers are not shown the donation prompt.
  const isPremium = usePremiumEntitlement();
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const [version, setVersion] = useState("");
  const [languageNotice, setLanguageNotice] = useState("");
  const { hidden, toggleHidden } = useValuesHidden();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const asideRef = useRef<HTMLElement>(null);

  const expanded = !collapsed || hovered || focusWithin;

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    persistCollapsedPreference(collapsed);
  }, [collapsed]);

  // A screen reader that keeps an English voice on French content is unusable for the whole
  // session, so the document language follows i18next immediately rather than on reload.
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  // Expand on focus-within for keyboard accessibility, collapse on blur-out
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const onFocusIn = () => setFocusWithin(true);
    const onFocusOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node)) setFocusWithin(false);
    };
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAiSection = pathname.startsWith("/ai");
  const isCarSection = pathname.startsWith("/car");
  const isSettingsSection = pathname.startsWith("/settings");
  const isHomeSection = pathname === "/home" || pathname.startsWith("/home/");
  const isFinanceSection =
    !isAiSection && !isCarSection && !isSettingsSection && !isHomeSection;

  const cycleTheme = () => {
    const idx = themeOrder.indexOf(theme as (typeof themeOrder)[number]);
    setTheme(themeOrder[(idx + 1) % themeOrder.length]);
  };

  const cycleLanguage = async () => {
    await i18n.changeLanguage(i18n.language === "en" ? "fr" : "en");
    // Resolved through `i18n.t` rather than the captured `t` so the announcement itself is in the
    // language just switched to.
    setLanguageNotice(i18n.t("shell.languageChanged"));
  };

  const currentTheme = (theme ?? "system") as keyof typeof themeIcons;
  const ThemeIcon = themeIcons[currentTheme] ?? Monitor;

  return (
    <aside
      ref={asideRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ scrollbarWidth: "none" }}
      className={cn(
        "z-30 flex h-full shrink-0 flex-col overflow-y-auto border-r border-rail-line bg-rail transition-[width] duration-200 [&::-webkit-scrollbar]:hidden",
        expanded ? "w-rail-w-expanded" : "w-rail-w"
      )}
    >
      <span role="status" aria-live="polite" className="sr-only">
        {languageNotice}
      </span>

      <SidebarBrandHeader expanded={expanded} />

      {/* Module nav */}
      <nav aria-label={t("sidebar.moduleNav")} className="mt-3 flex-1 px-3">
        <ul className="space-y-1.5">
          <li>
            <Link
              to="/home"
              className={railItemClass(expanded, isHomeSection, "module")}
              aria-label={t("sidebar.home")}
              data-testid="rail-home"
            >
              <House className="size-5 shrink-0" strokeWidth={1.75} />
              <span className={railLabelClass(expanded)}>{t("sidebar.home")}</span>
            </Link>
          </li>
          <li>
            <Link
              to="/"
              className={railItemClass(expanded, isFinanceSection, "module")}
              aria-label={t("sidebar.finance")}
            >
              <Wallet className="size-5 shrink-0" strokeWidth={1.75} />
              <span className={railLabelClass(expanded)}>{t("sidebar.finance")}</span>
            </Link>
          </li>
          <li>
            <Link
              to="/car"
              className={railItemClass(expanded, isCarSection, "module")}
              aria-label={t("sidebar.car")}
            >
              <Car className="size-5 shrink-0" strokeWidth={1.75} />
              <span className={railLabelClass(expanded)}>{t("sidebar.car")}</span>
            </Link>
          </li>
          <li>
            <Link
              to="/ai"
              className={railItemClass(expanded, isAiSection, "module")}
              aria-label={t("sidebar.ai")}
            >
              <Sparkles className="size-5 shrink-0" strokeWidth={1.75} />
              <span className={railLabelClass(expanded)}>{t("sidebar.ai")}</span>
            </Link>
          </li>
        </ul>
      </nav>

      {/* Utility actions */}
      <div className="space-y-1 px-3 pt-3 pb-4">
        <RailButton
          onClick={toggleHidden}
          icon={hidden ? EyeOff : Eye}
          label={hidden ? t("sidebar.showValues") : t("sidebar.hideValues")}
          expanded={expanded}
          testId="toggle-values-button"
        />
        <RailButton
          onClick={cycleTheme}
          icon={ThemeIcon}
          label={t(themeLabelKeys[currentTheme])}
          expanded={expanded}
          testId="theme-toggle"
        />
        <RailButton
          onClick={cycleLanguage}
          icon={Globe}
          label={i18n.language === "en" ? t("sidebar.french") : t("sidebar.english")}
          expanded={expanded}
          testId="language-toggle"
        />
        <Link
          to="/settings"
          activeOptions={{ exact: false }}
          className={railItemClass(expanded, isSettingsSection)}
          aria-label={t("sidebar.settings")}
          data-testid="settings-link"
        >
          <SlidersHorizontal className="size-[18px] shrink-0" strokeWidth={1.75} />
          <span className={railLabelClass(expanded)}>{t("sidebar.settings")}</span>
        </Link>
        {!isPremium && (
          <RailButton
            onClick={() => openUrl(BUY_ME_A_COFFEE_URL)}
            icon={BuyMeACoffeeIcon}
            label={t("sidebar.buyMeACoffee")}
            expanded={expanded}
            testId="buy-me-a-coffee-link"
          />
        )}
        {/* The rail owns its item recipe, so the indicator is handed the class rather than
          * importing it back out of this file. */}
        <SyncStatusIndicator
          expanded={expanded}
          itemClassName={railItemClass(expanded, false)}
        />
        <RailButton
          onClick={() => setCollapsed((c) => !c)}
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
          expanded={expanded}
          testId="collapse-sidebar-button"
          ariaExpanded={!collapsed}
        />
        <span
          className={cn(
            "block px-4 pt-3 text-caption text-ink-faint transition-opacity duration-200",
            expanded && version ? "opacity-100" : "h-0 overflow-hidden opacity-0"
          )}
        >
          v{version}
        </span>
      </div>
    </aside>
  );
}

function RailButton({
  onClick,
  icon: Icon,
  label,
  expanded,
  testId,
  ariaExpanded,
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  expanded: boolean;
  testId?: string;
  ariaExpanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={railItemClass(expanded, false)}
      data-testid={testId}
      aria-label={label}
      aria-expanded={ariaExpanded}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
      <span className={railLabelClass(expanded)}>{label}</span>
    </button>
  );
}
