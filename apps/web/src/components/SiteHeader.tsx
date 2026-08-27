import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "@tanstack/react-router";
import { cn, NixusLogo } from "@nixus/shared";

import { DownloadCTA } from "@/features/download/DownloadCTA";
import { betaPagePath, localeFromLanguage } from "@/lib/localePaths";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Marketing site header. Sticky at the top of every page; gains a solid
 * background + subtle border once the visitor scrolls past the hero.
 *
 * Composition (left → right):
 *   phone/tablet: [ Logo mark + "Nixus" wordmark ] [ Beta ] [ Theme ] [ Lang ]
 *   desktop:      … plus [ DownloadCTA ]
 *
 * Per DESIGN.md "Marketing site — responsive tier": the header is 56px on a
 * phone, 64px from 640px, and the shipped 80px from 1024px. The download CTA
 * is `hidden` below 1024px rather than conditionally rendered, so the
 * prerendered HTML keeps its no-JS download links and hydration sees the same
 * tree at every viewport. It has to leave the phone bar because it is a
 * multi-line block — on a mobile UA it renders the whole send-to-computer
 * affordance, which overflowed an 80px bar and painted over page content.
 * The hero is the single full conversion affordance on a phone.
 */
export function SiteHeader() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const locale = localeFromLanguage(i18n.language);
  const betaHref = betaPagePath(locale);
  const onBetaPage =
    pathname === "/beta" || pathname === "/fr/beta";

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
        scrolled
          ? "border-b border-border bg-background/85 backdrop-blur"
          : "border-b border-transparent bg-background/0",
      )}
    >
      <div className="mkt-page-x mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-2 sm:h-16 lg:h-20">
        <a
          href="/"
          aria-label={t("header.brandHome")}
          className="mkt-tap inline-flex shrink-0 items-end gap-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <NixusLogo className="size-8 shrink-0 sm:size-9" />
          {/* "ixus" wordmark continues from the logo's "N". Gradient
              + bg-clip-text mirrors apps/desktop/src/components/shared/AppSidebar.tsx
              so the brand identity stays visually identical across surfaces. */}
          <span className="text-lg font-semibold whitespace-nowrap bg-gradient-to-r from-[#A78BFA] to-[#F472B6] bg-clip-text text-transparent leading-none -ml-0.5 mb-px sm:text-xl">
            ixus
          </span>
        </a>

        <div className="flex items-center gap-0.5 sm:gap-2 md:gap-3">
          <a
            href={betaHref}
            data-testid="header-beta-link"
            aria-current={onBetaPage ? "page" : undefined}
            className={cn(
              "mkt-tap inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              onBetaPage
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("header.beta")}
          </a>
          <ThemeToggle />
          <LanguageToggle />
          <div className="hidden lg:block">
            <DownloadCTA size="sm" />
          </div>
        </div>
      </div>
    </header>
  );
}
