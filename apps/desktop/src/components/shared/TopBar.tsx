import { useTranslation } from "react-i18next";
import { CircleUser, Search } from "lucide-react";

interface TopBarProps {
  onSearchClick?: () => void;
}

export function TopBar({ onSearchClick }: TopBarProps) {
  const { t } = useTranslation();

  return (
    <header className="flex items-center h-14 px-6 bg-sidebar">
      <div className="flex-1" />
      <button
        onClick={onSearchClick}
        className="flex items-center gap-2 w-full max-w-[480px] bg-sidebar-accent rounded-lg px-3.5 py-2 cursor-pointer hover:bg-sidebar-accent/80 transition-colors"
        aria-label={t("topbar.searchAriaLabel")}
        data-testid="topbar-search-trigger"
      >
        <Search size={16} className="text-sidebar-foreground/50 shrink-0" />
        <span className="text-sm text-sidebar-foreground/50 flex-1 text-left">
          {t("topbar.searchPlaceholder")}
        </span>
        <kbd className="text-[11px] text-sidebar-foreground/40 bg-sidebar rounded px-1.5 py-0.5 border border-sidebar-border">
          ⌘K
        </kbd>
      </button>
      <div className="flex-1 flex justify-end">
        <span className="text-sidebar-foreground/70" aria-hidden="true">
          <CircleUser size={24} />
        </span>
      </div>
    </header>
  );
}
