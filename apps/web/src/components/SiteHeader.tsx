import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "@tanstack/react-router";
import { cn, NixusLogo } from "@nixus/shared";

import { DownloadCTA } from "@/features/download/DownloadCTA";
import { betaPagePath, homePath, localeFromLanguage } from "@/lib/localePaths";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Marketing site header. Sticky at the top of every page; gains a solid
 * background + subtle border once the visitor scrolls past the hero.
 *
 * Composition (left → right):
 *   phone/tablet: [ Logo mark + "Nixus" wordmark ] [ Founding ] [ Theme ] [ Lang ]
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
/**
 * Section destinations, desktop tier only.
 *
 * Anchors rather than routes: the homepage is now long enough that a visitor who
 * lands mid-consideration needs a way to jump, and a mature marketing site is
 * expected to offer one. They are `lg:`-gated because DESIGN.md's responsive
 * tier fixes phone chrome at brand + Founding + the two toggles and nothing
 * else — four more destinations do not fit a 56px bar, and the page's own
 * section order is the phone's navigation.
 *
 * Href is built per-locale rather than hardcoded to `/#id` so a visitor on
 * `/fr/` jumping to a section does not get silently switched to English.
 */
const SECTION_LINKS = [
  { id: "how-it-works", labelKey: "nav.howItWorks" },
  { id: "how", labelKey: "nav.product" },
  { id: "features", labelKey: "nav.features" },
  { id: "privacy", labelKey: "nav.privacy" },
  { id: "faq", labelKey: "nav.faq" },
] as const;

export function SiteHeader() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const locale = localeFromLanguage(i18n.language);
  const betaHref = betaPagePath(locale);
  const onBetaPage =
    pathname === "/beta" || pathname === "/fr/beta";
  const sectionBase = homePath(locale);

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
        // A brand-tinted glass bar at BOTH states, not just when scrolled. At
        // rest it used to be fully transparent over the hero's paper, so the bar
        // and the first section were the same colour and the chrome had no edge.
        scrolled
          ? "bg-accent/80 backdrop-blur"
          : "bg-accent/45 backdrop-blur-sm",
      )}
    >
      <div className="mkt-page-x mkt-container flex h-14 items-center justify-between gap-2 sm:h-16 lg:h-20">
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

        <nav
          aria-label={t("nav.sectionsAria")}
          data-testid="header-sections"
          className="hidden lg:flex lg:items-center lg:gap-1"
        >
          {SECTION_LINKS.map((link) => (
            <a
              key={link.id}
              href={`${sectionBase}#${link.id}`}
              className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t(link.labelKey)}
            </a>
          ))}
        </nav>

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
      {/* After the bar, not before it: the layout specs measure the bar as
          `header.firstElementChild`, and the rule is absolutely positioned so its
          source order is free. */}
      <span
        aria-hidden="true"
        data-testid="header-rule"
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-[#818CF8] via-[#A78BFA] to-[#F472B6] motion-safe:transition-opacity motion-safe:duration-200",
          scrolled ? "opacity-100" : "opacity-40",
        )}
      />
    </header>
  );
}
