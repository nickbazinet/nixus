import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { getVersion } from "@tauri-apps/api/app";
import {
  Wallet,
  Download,
  FolderUp,
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
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { BuyMeACoffeeIcon, BUY_ME_A_COFFEE_URL, NixusLogo } from "@nixus/shared";

const themeOrder = ["light", "dark", "system"] as const;
const themeIcons = { light: Sun, dark: Moon, system: Monitor } as const;
const themeLabelKeys = { light: "sidebar.light", dark: "sidebar.dark", system: "sidebar.system" } as const;

export function AppSidebar() {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [version, setVersion] = useState("");
  const { hidden, toggleHidden } = useValuesHidden();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const asideRef = useRef<HTMLElement>(null);

  const expanded = hovered || pinned;

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // Expand on focus-within for keyboard accessibility, collapse on blur-out
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const onFocusIn = () => setPinned(true);
    const onFocusOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node)) setPinned(false);
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
  const isSettingsSection = pathname.startsWith("/settings");
  const isFinanceSection = !isAiSection && !isSettingsSection;

  const cycleTheme = () => {
    const idx = themeOrder.indexOf(theme as (typeof themeOrder)[number]);
    setTheme(themeOrder[(idx + 1) % themeOrder.length]);
  };

  const cycleLanguage = () => {
    i18n.changeLanguage(i18n.language === "en" ? "fr" : "en");
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
          "shrink-0 h-screen sticky top-0 flex flex-col bg-sidebar transition-[width] duration-200 z-30 [&::-webkit-scrollbar]:hidden",
          expanded ? "w-48" : "w-14"
        )}
      >
        {/* Logo — tap to toggle on touch devices */}
        <button
          onClick={() => setPinned((p) => !p)}
          className="flex items-center h-14 px-3 w-full text-left"
          aria-label={expanded ? t("sidebar.collapseSidebar") : t("sidebar.expandSidebar")}
          aria-expanded={expanded}
        >
          <div className="flex items-end gap-0 min-w-0">
            <NixusLogo className="w-8 h-8 shrink-0" />
            <span
              className={cn(
                "text-lg font-semibold whitespace-nowrap transition-opacity duration-200 bg-gradient-to-r from-[#A78BFA] to-[#F472B6] bg-clip-text text-transparent leading-none -ml-0.5 mb-px",
                expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
              )}
            >
              ixus
            </span>
          </div>
        </button>

        {/* Module nav */}
        <nav aria-label={t("sidebar.moduleNav")} className="flex-1 mt-2">
          <ul className="space-y-1">
            <li>
              <Link
                to="/"
                className={cn(
                  "flex items-center text-sm font-medium transition-colors",
                  expanded ? "gap-3 px-3 py-2.5" : "justify-center px-3 py-2.5",
                  isFinanceSection
                    ? "text-sidebar-primary border-r-[3px] border-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
                )}
                title={expanded ? undefined : t("sidebar.finance")}
                aria-label={t("sidebar.finance")}
              >
                <Wallet size={20} />
                <span
                  className={cn(
                    "transition-opacity duration-200",
                    expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
                  )}
                >
                  {t("sidebar.finance")}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/ai"
                className={cn(
                  "flex items-center text-sm font-medium transition-colors",
                  expanded ? "gap-3 px-3 py-2.5" : "justify-center px-3 py-2.5",
                  isAiSection
                    ? "text-sidebar-primary border-r-[3px] border-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
                )}
                title={expanded ? undefined : t("sidebar.ai")}
                aria-label={t("sidebar.ai")}
              >
                <Bot size={20} />
                <span
                  className={cn(
                    "transition-opacity duration-200",
                    expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
                  )}
                >
                  {t("sidebar.ai")}
                </span>
              </Link>
            </li>
          </ul>
        </nav>

        {/* Utility actions */}
        <div className={cn("border-t border-sidebar-border py-3", expanded ? "px-3" : "px-2")}>
          <SidebarButton
            onClick={toggleHidden}
            icon={hidden ? EyeOff : Eye}
            label={hidden ? t("sidebar.showValues") : t("sidebar.hideValues")}
            expanded={expanded}
            testId="toggle-values-button"
          />
          <SidebarButton
            onClick={async () => {
              try {
                const result = await invoke<{ path: string } | null>("export_backup");
                if (result) toast.success(t("sidebar.backupSaved", { path: result.path }));
              } catch {
                toast.error(t("sidebar.backupFailed"));
              }
            }}
            icon={Download}
            label={t("sidebar.backup")}
            expanded={expanded}
            testId="backup-button"
          />
          <SidebarButton
            onClick={async () => {
              try {
                const restored = await invoke<boolean>("import_backup");
                if (restored) {
                  toast.success(t("sidebar.restoreSuccess"));
                  window.location.reload();
                }
              } catch (err: unknown) {
                const error = err as { message?: string };
                if (error?.message?.includes("Invalid backup file")) {
                  toast.error(t("sidebar.invalidBackup"));
                } else {
                  toast.error(t("sidebar.restoreFailed"));
                }
              }
            }}
            icon={FolderUp}
            label={t("sidebar.restore")}
            expanded={expanded}
            testId="restore-button"
          />
          <SidebarButton
            onClick={cycleTheme}
            icon={ThemeIcon}
            label={t(themeLabelKeys[currentTheme])}
            expanded={expanded}
            testId="theme-toggle"
          />
          <SidebarButton
            onClick={cycleLanguage}
            icon={Globe}
            label={i18n.language === "en" ? t("sidebar.french") : t("sidebar.english")}
            expanded={expanded}
            testId="language-toggle"
          />
          <SidebarLink
            to="/settings"
            activeOptions={{ exact: false }}
            icon={Settings}
            label={t("sidebar.settings")}
            expanded={expanded}
            testId="settings-link"
          />
          <SidebarExternalButton
            onClick={() => openUrl(BUY_ME_A_COFFEE_URL)}
            icon={BuyMeACoffeeIcon}
            label={t("sidebar.buyMeACoffee")}
            expanded={expanded}
            testId="buy-me-a-coffee-link"
          />
          <span
            className={cn(
              "block text-[10px] text-sidebar-foreground/40 pt-2 px-2 transition-opacity duration-200",
              expanded && version ? "opacity-100" : "opacity-0 h-0 overflow-hidden"
            )}
          >
            v{version}
          </span>
        </div>
    </aside>
  );
}

function SidebarExternalButton({
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
      className={cn(
        "flex items-center text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors w-full rounded py-1.5",
        expanded ? "gap-2 px-2" : "justify-center px-1"
      )}
      title={expanded ? undefined : label}
      data-testid={testId}
      aria-label={label}
    >
      <Icon className="size-4" />
      <span
        className={cn(
          "transition-opacity duration-200 whitespace-nowrap",
          expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
        )}
      >
        {label}
      </span>
    </button>
  );
}

function SidebarButton({
  onClick,
  icon: Icon,
  label,
  expanded,
  testId,
}: {
  onClick: () => void;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  expanded: boolean;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors w-full rounded py-1.5",
        expanded ? "gap-2 px-2" : "justify-center px-1"
      )}
      title={expanded ? undefined : label}
      data-testid={testId}
      aria-label={label}
    >
      <Icon size={16} />
      <span
        className={cn(
          "transition-opacity duration-200 whitespace-nowrap",
          expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
        )}
      >
        {label}
      </span>
    </button>
  );
}

function SidebarLink({
  to,
  icon: Icon,
  label,
  expanded,
  testId,
  activeOptions,
}: {
  to: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  expanded: boolean;
  testId?: string;
  activeOptions?: { exact?: boolean };
}) {
  return (
    <Link
      to={to}
      activeOptions={activeOptions}
      className={cn(
        "flex items-center text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors w-full rounded py-1.5",
        expanded ? "gap-2 px-2" : "justify-center px-1"
      )}
      activeProps={{
        className: cn(
          "flex items-center text-xs text-sidebar-foreground transition-colors w-full rounded py-1.5",
          expanded ? "gap-2 px-2" : "justify-center px-1"
        ),
      }}
      title={expanded ? undefined : label}
      data-testid={testId}
      aria-label={label}
    >
      <Icon size={16} />
      <span
        className={cn(
          "transition-opacity duration-200 whitespace-nowrap",
          expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
        )}
      >
        {label}
      </span>
    </Link>
  );
}
