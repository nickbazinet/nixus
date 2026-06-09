import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";

import { cn } from "@nixus/shared";

import { betaPagePath, localeFromLanguage } from "@/lib/localePaths";

const STORAGE_KEY = "nixus.preAlphaDismissed";

/**
 * Pre-alpha disclosure bar — hydration-safe: a pre-hydration script in
 * `__root.tsx` sets `data-pre-alpha-dismissed="1"` on `<html>` for returning
 * dismissed visitors, and a CSS rule hides this element via that attribute
 * before React mounts (no flash, no SSR mismatch).
 */
export function PreAlphaBanner() {
  const { t, i18n } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  // Link to the dedicated beta page — locale-aware for EN/FR outreach.
  const learnMoreHref = betaPagePath(localeFromLanguage(i18n.language));

  function handleDismiss() {
    // Move focus out of the soon-to-unmount banner so keyboard users don't
    // lose their place in the tab order when the close button vanishes.
    const main = document.getElementById("main-content");
    main?.focus({ preventScroll: true });
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
      document.documentElement.setAttribute("data-pre-alpha-dismissed", "1");
    } catch {
      // Privacy mode / storage disabled — session-only dismissal is enough.
    }
  }

  if (dismissed) return null;

  return (
    <div
      data-pre-alpha-banner
      data-testid="pre-alpha-banner"
      role="region"
      aria-label={t("preAlpha.banner.ariaLabel")}
      className={cn(
        "w-full border-b border-amber-200/60 bg-amber-50 text-amber-900",
        "dark:border-amber-800/40 dark:bg-amber-900/30 dark:text-amber-100",
      )}
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 text-sm md:px-8">
        <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
        <p className="flex-1 min-w-0">{t("preAlpha.banner.message")}</p>
        <a
          href={learnMoreHref}
          className="rounded-sm font-medium underline underline-offset-4 outline-none hover:text-amber-950 focus-visible:ring-3 focus-visible:ring-amber-600/40 dark:hover:text-amber-50"
        >
          {t("preAlpha.banner.learnMore")}
        </a>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("preAlpha.banner.dismissAria")}
          className="-mr-1 ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-amber-100/60 focus-visible:ring-3 focus-visible:ring-amber-600/40 dark:hover:bg-amber-800/40"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
