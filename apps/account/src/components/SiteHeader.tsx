import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@nixus/shared";

import { BrandWordmark } from "./BrandWordmark";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import type { Locale } from "@/lib/i18n";

/**
 * The account app's header, recreated from
 * `apps/web/src/components/SiteHeader.tsx` so the two origins read as one site.
 *
 * Same geometry (56px phone / 64px from 640px / 80px from 1024px), same
 * brand-tinted glass bar at both scroll states, same gutters and container
 * measure, same identity-gradient hairline along the bottom. What differs is
 * the right cluster: this app has no download CTA and no section nav — it has
 * the two toggles and the one control a signed-in visitor needs.
 *
 * Every page this shell renders is behind a session (`/` and `/profile` both
 * 302 to sign-in when there is none), so the sign-out control is unconditional.
 */
export function SiteHeader({ locale }: { readonly locale: Locale }) {
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        setScrolled(window.scrollY > 80);
        raf = 0;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header
      role="banner"
      className={cn(
        "sticky top-0 z-50 w-full motion-safe:transition-[background-color,backdrop-filter,border-color] motion-safe:duration-200",
        scrolled ? "bg-accent/80 backdrop-blur" : "bg-accent/45 backdrop-blur-sm",
      )}
    >
      <div className="mkt-page-x mkt-container flex h-14 items-center justify-between gap-2 sm:h-16 lg:h-20">
        <BrandWordmark locale={locale} />

        <div className="flex items-center gap-0.5 sm:gap-2 md:gap-3">
          <ThemeToggle />
          <LanguageToggle />
          {/* A form POST, so the browser sends `Origin` and the route can verify
              it. A link would be a GET, which no state change may be. */}
          <form method="post" action="/auth/signout">
            <button
              type="submit"
              data-testid="sign-out"
              className="mkt-tap inline-flex min-h-target-min min-w-target-min items-center justify-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-2.5"
            >
              {/* Icon-only below `sm`, the same trade the marketing header makes
                  for its sign-in link: the French label does not fit a 320px bar
                  beside both toggles. The visible label returns at 640px. */}
              <LogOut aria-hidden="true" className="size-5 sm:size-4" />
              <span className="sr-only sm:not-sr-only">{t("profile.signOut")}</span>
            </button>
          </form>
        </div>
      </div>
      {/* After the bar, not before it: the rule is absolutely positioned, so its
          source order is free. */}
      <span
        aria-hidden="true"
        data-testid="header-rule"
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-[#5E78ED] via-[#9978ED] to-[#DE50A4] motion-safe:transition-opacity motion-safe:duration-200",
          scrolled ? "opacity-100" : "opacity-40",
        )}
      />
    </header>
  );
}
