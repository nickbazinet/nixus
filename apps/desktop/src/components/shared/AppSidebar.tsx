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
  Settings,
  Bot,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
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

function railItemClass(expanded: boolean, active: boolean) {
  return cn(
    "relative flex w-full min-h-target-min items-center rounded-md text-label no-underline transition-colors",
    expanded ? "gap-3 px-3 py-2" : "justify-center px-2 py-2",
    active
      ? "bg-rail-on text-rail-on-ink"
      : "text-rail-ink hover:bg-hover hover:text-ink",
    focusRing
  );
}

/** 3px brand marker on the active module, per DESIGN.md {components.rail-item-active}. */
function ActiveMarker() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 right-0 w-[3px] rounded-l-full bg-brand"
    />
  );
}

export function AppSidebar() {
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
  const isFinanceSection = !isAiSection && !isCarSection && !isSettingsSection;

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
        "z-30 flex h-full shrink-0 flex-col bg-rail transition-[width] duration-200 [&::-webkit-scrollbar]:hidden",
        expanded ? "w-rail-w-expanded" : "w-rail-w"
      )}
    >
      <span role="status" aria-live="polite" className="sr-only">
        {languageNotice}
      </span>

      <SidebarBrandHeader
        expanded={expanded}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />

      {/* Module nav */}
      <nav aria-label={t("sidebar.moduleNav")} className="mt-2 flex-1 px-2">
        <ul className="space-y-1">
          <li>
            <Link
              to="/"
              className={railItemClass(expanded, isFinanceSection)}
              aria-label={t("sidebar.finance")}
            >
              <Wallet className="size-5 shrink-0" />
              <span className={railLabelClass(expanded)}>{t("sidebar.finance")}</span>
              {isFinanceSection && <ActiveMarker />}
            </Link>
          </li>
          <li>
            <Link
              to="/car"
              className={railItemClass(expanded, isCarSection)}
              aria-label={t("sidebar.car")}
            >
              <Car className="size-5 shrink-0" />
              <span className={railLabelClass(expanded)}>{t("sidebar.car")}</span>
              {isCarSection && <ActiveMarker />}
            </Link>
          </li>
          <li>
            <Link
              to="/ai"
              className={railItemClass(expanded, isAiSection)}
              aria-label={t("sidebar.ai")}
            >
              <Bot className="size-5 shrink-0" />
              <span className={railLabelClass(expanded)}>{t("sidebar.ai")}</span>
              {isAiSection && <ActiveMarker />}
            </Link>
          </li>
        </ul>
      </nav>

      {/* Utility actions */}
      <div className="space-y-1 border-t border-rail-line px-2 py-3">
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
          <Settings className="size-4 shrink-0" />
          <span className={railLabelClass(expanded)}>{t("sidebar.settings")}</span>
          {isSettingsSection && <ActiveMarker />}
        </Link>
        <RailButton
          onClick={() => openUrl(BUY_ME_A_COFFEE_URL)}
          icon={BuyMeACoffeeIcon}
          label={t("sidebar.buyMeACoffee")}
          expanded={expanded}
          testId="buy-me-a-coffee-link"
        />
        <span
          className={cn(
            "block px-3 pt-2 text-caption text-ink-faint transition-opacity duration-200",
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
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  expanded: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={railItemClass(expanded, false)}
      data-testid={testId}
      aria-label={label}
    >
      <Icon className="size-4 shrink-0" />
      <span className={railLabelClass(expanded)}>{label}</span>
    </button>
  );
}
