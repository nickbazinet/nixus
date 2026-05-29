import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, NixusLogo } from "@nkbaz/shared";

import { DownloadCTA } from "@/features/download/DownloadCTA";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Marketing site header. Sticky at the top of every page; gains a solid
 * background + subtle border once the visitor scrolls past the hero.
 *
 * Composition (left → right):
 *   [ Logo mark + "Nixus" wordmark ] [ ThemeToggle ] [ LanguageToggle ] [ DownloadCTA ]
 *
 * Header is `h-20` (80px) so the larger logo (`size-9`) and the toggle row
 * sit comfortably without crowding the Download CTA.
 */
export function SiteHeader() {
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
        scrolled
          ? "border-b border-border bg-background/85 backdrop-blur"
          : "border-b border-transparent bg-background/0",
      )}
    >
      <div className="mx-auto flex h-20 max-w-[1280px] items-center justify-between px-6 md:px-8">
        <a
          href="/"
          aria-label={t("header.brandHome")}
          className="inline-flex items-end gap-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <NixusLogo className="size-9 shrink-0" />
          {/* "ixus" wordmark continues from the logo's "N". Gradient
              + bg-clip-text mirrors apps/desktop/src/components/shared/AppSidebar.tsx
              so the brand identity stays visually identical across surfaces. */}
          <span className="text-xl font-semibold whitespace-nowrap bg-gradient-to-r from-[#A78BFA] to-[#F472B6] bg-clip-text text-transparent leading-none -ml-0.5 mb-px">
            ixus
          </span>
        </a>

        <div className="flex items-center gap-2 md:gap-3">
          <ThemeToggle />
          <LanguageToggle />
          <DownloadCTA size="sm" />
        </div>
      </div>
    </header>
  );
}
