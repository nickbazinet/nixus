import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";

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
      className="w-full border-b border-caution/25 bg-caution-bg text-caution-ink"
    >
      <div className="mkt-page-x mx-auto flex max-w-[1280px] items-center gap-2 py-2 text-sm sm:gap-3">
        <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
        {/* The link sits inside the sentence rather than beside it as a third
            flex item: as a sibling it reserved ~130px of the row, squeezing the
            message into 4-6 lines on a phone and making the banner 190-250px
            tall. Inline, it keeps the sentence's line box — which DESIGN.md's
            touch-target rule exempts for exactly this case. */}
        <p className="min-w-0 flex-1">
          {t("preAlpha.banner.message")}{" "}
          <a
            href={learnMoreHref}
            className="rounded-sm px-0.5 py-1 font-medium underline underline-offset-4 outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t("preAlpha.banner.learnMore")}
            {/* "Learn more" alone is on Lighthouse's generic-link-text blocklist
                and tells a screen-reader user nothing in a link list. The suffix
                is out of flow (`sr-only`), so the visible copy is untouched
                while the link's *text* — which is what the audit and crawlers
                read, not `aria-label` — becomes descriptive. Carrying it as
                content rather than an `aria-label` keeps one source of truth for
                the accessible name and satisfies WCAG 2.5.3 by construction. */}
            <span className="sr-only">
              {` ${t("preAlpha.banner.learnMoreContext")}`}
            </span>
          </a>
        </p>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("preAlpha.banner.dismissAria")}
          className="mkt-tap -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-caution/15 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
