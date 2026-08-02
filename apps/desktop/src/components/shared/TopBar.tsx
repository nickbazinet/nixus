import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";

interface TopBarProps {
  onSearchClick?: () => void;
}

export function TopBar({ onSearchClick }: TopBarProps) {
  const { t } = useTranslation();

  // No account avatar: this is one user, one machine, no login, and a person-shaped glyph in the
  // chrome implies an account the product does not have.
  return (
    <header className="flex h-14 shrink-0 items-center justify-center bg-chrome px-page-x">
      <button
        type="button"
        onClick={onSearchClick}
        className={cn(
          "flex w-full max-w-[480px] min-h-target-min cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-card px-3 py-1.5 transition-colors hover:bg-hover",
          focusRing
        )}
        aria-label={t("topbar.searchAriaLabel")}
        data-testid="topbar-search-trigger"
      >
        <Search className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
        <span className="flex-1 text-left text-body text-ink-faint">
          {t("topbar.searchPlaceholder")}
        </span>
        {/* Read as content, not a badge, so it sits at the 13px caption floor rather than micro. */}
        <kbd className="rounded-sm border border-line bg-track px-1.5 py-0.5 text-caption text-ink-faint">
          ⌘K
        </kbd>
      </button>
    </header>
  );
}
