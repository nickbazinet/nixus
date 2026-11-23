import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";

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

/** The rail's header: the brand lockup. Collapsing is done by the toggle at the rail's bottom. */
export function SidebarBrandHeader({ expanded }: { expanded: boolean }) {
  return (
    /* Rail mark — the charte's glossy N, the same artwork nixusapp.com uses, with the wordmark. */
    <div
      className={cn(
        "flex h-[76px] w-full shrink-0 items-center",
        expanded ? "px-6" : "justify-center px-0"
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <BrandMark />
        <span
          className={cn(
            "font-display text-[22px] leading-none font-bold tracking-[-0.02em] text-ink",
            railLabelClass(expanded)
          )}
        >
          Nixus
        </span>
      </span>
    </div>
  );
}
