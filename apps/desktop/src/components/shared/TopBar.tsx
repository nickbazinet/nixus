import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { focusRing } from "@nixus/shared";
import { ProfileMenu } from "@/components/auth/ProfileMenu";
import { cn } from "@/lib/utils";

interface TopBarProps {
  onSearchClick?: () => void;
}

export function TopBar({ onSearchClick }: TopBarProps) {
  const { t } = useTranslation();

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-center bg-chrome px-page-x">
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

      {/* Pinned absolutely rather than laid out as a flex sibling: the search field is
       * `w-full max-w-[480px]` inside a `justify-center` row, so any second participant in that
       * distribution shifts or resizes it on every route. */}
      <div className="absolute inset-y-0 right-page-x flex items-center">
        <ProfileMenu />
      </div>
    </header>
  );
}
