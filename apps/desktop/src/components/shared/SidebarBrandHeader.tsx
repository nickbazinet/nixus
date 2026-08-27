import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { NixusLogo, focusRing } from "@nixus/shared";

const RAIL_COLLAPSED_KEY = "rail-collapsed";

// The rail opens LABELLED. Icon-only-by-default asks the least tech-comfortable user to learn
// navigation by discovery; collapsing to save space is the user's choice, so it is a persisted
// preference rather than a default.
export function readCollapsedPreference(): boolean {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

// Paired with the read above so both ends of the preference name the key once. Storage can be
// unavailable, and losing a collapse preference is not worth surfacing.
export function persistCollapsedPreference(collapsed: boolean): void {
  try {
    localStorage.setItem(RAIL_COLLAPSED_KEY, String(collapsed));
  } catch {
    // localStorage unavailable
  }
}

// Exported from here because this header is what collapses the rail, and every other rail label
// follows the transition it defines. A call site that restated these classes would be free to drift
// out of step with the width animation the aside runs at the same duration.
export function railLabelClass(expanded: boolean) {
  return cn(
    "whitespace-nowrap transition-opacity duration-200",
    expanded ? "opacity-100" : "w-0 overflow-hidden opacity-0"
  );
}

/**
 * The rail's header: the brand lockup, the collapse control it doubles as, and the premium label.
 *
 * `collapsed` is a separate prop from `expanded` rather than derived from it, because they answer
 * different questions: `expanded` includes a transient hover or focus-within, while the accessible
 * name has to describe what the click will actually persist.
 */
export function SidebarBrandHeader({
  expanded,
  collapsed,
  onToggle,
}: {
  expanded: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  return (
    /* Rail mark — one of only three places the identity gradient is permitted. */
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex h-14 w-full min-h-target-min items-center px-3 text-left",
        focusRing
      )}
      aria-label={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
      aria-expanded={expanded}
    >
      <span className="flex min-w-0 items-end">
        <NixusLogo className="h-8 w-8 shrink-0" />
        <span
          className={cn(
            "-ml-0.5 mb-px bg-logo-gradient bg-clip-text text-h2 leading-none text-transparent",
            railLabelClass(expanded)
          )}
        >
          ixus
        </span>
      </span>
    </button>
  );
}
