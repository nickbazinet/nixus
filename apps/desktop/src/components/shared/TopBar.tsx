import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { focusRing } from "@nixus/shared";
import { ProfileMenu } from "@/components/auth/ProfileMenu";
import { cn } from "@/lib/utils";

// The handler in __root.tsx accepts Cmd or Ctrl; show the one that matches the platform.
const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.userAgent);
const SEARCH_SHORTCUT = IS_MAC ? "⌘K" : "Ctrl+K";

interface TopBarProps {
  onSearchClick?: () => void;
}

export function TopBar({ onSearchClick }: TopBarProps) {
  const { t } = useTranslation();

  return (
    <header className="shrink-0 bg-chrome">
      <div className="relative mx-auto flex h-[76px] w-full max-w-[1280px] items-center justify-center px-page-x">
        <button
          type="button"
          onClick={onSearchClick}
          className={cn(
            "flex h-11 w-full max-w-[560px] min-h-target-min cursor-pointer items-center gap-3 rounded-full border border-line bg-card pr-2 pl-4 transition-colors hover:border-line-strong",
            focusRing
          )}
          aria-label={t("topbar.searchAriaLabel")}
          data-testid="topbar-search-trigger"
        >
          <Search
            className="icon-gradient size-[18px] shrink-0"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="flex-1 text-left text-body text-ink-dim">
            {t("topbar.searchPlaceholder")}
          </span>
          {/* Read as content, not a badge, so it sits at the 13px caption floor rather than micro. */}
          <kbd className="rounded-sm border border-line bg-page px-2 py-0.5 font-sans text-caption font-bold text-ink">
            {SEARCH_SHORTCUT}
          </kbd>
        </button>

        {/* Pinned absolutely rather than laid out as a flex sibling: the search field is centred in
         * a `justify-center` row, so any second participant in that distribution would shift or
         * resize it on every route. */}
        <div className="absolute inset-y-0 right-page-x flex items-center">
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
