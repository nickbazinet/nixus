import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@nixus/shared";

import type { AccountView } from "@/actions/gate";
import { BrandWordmark } from "./BrandWordmark";
import { headerIdentity } from "@/lib/identity";
import type { Locale } from "@/lib/i18n";
import {
  marketingDownloadUrl,
  marketingFeaturesUrl,
  marketingPricingUrl,
} from "@/lib/marketing";
import { destinationPath, profileDestination } from "@/server/destinations";

const NAV_LINK_CLASS =
  "mkt-tap inline-flex min-h-target-min items-center rounded-md px-2.5 py-1.5 text-sm font-medium text-ink outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The account app's header: the brand, the marketing site's three section
 * links, the signed-in account's pill and the way out.
 *
 * Every page this shell renders is behind a session, so the sign-out control is
 * unconditional. The pill reads the account page's loader data when it is the
 * current route; on any other page (the Stripe-return page) it is simply absent.
 */
export function SiteHeader({ locale }: { readonly locale: Locale }) {
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const account = useRouterState({
    select: (state) => {
      for (const match of state.matches) {
        const data = match.loaderData as { account?: AccountView } | undefined;
        if (data?.account) return data.account;
      }
      return null;
    },
  });
  const identity = account === null ? null : headerIdentity(account);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        setScrolled(window.scrollY > 8);
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
        "sticky top-0 z-50 w-full border-b motion-safe:transition-[background-color,border-color] motion-safe:duration-200",
        scrolled ? "border-line bg-page/90 backdrop-blur" : "border-transparent bg-page",
      )}
    >
      <div className="mkt-page-x account-container flex h-16 items-center justify-between gap-2 lg:h-[4.5rem]">
        <BrandWordmark locale={locale} />

        <div className="flex items-center gap-1 sm:gap-2">
          <nav aria-label={t("header.navAria")} className="hidden md:block">
            <ul role="list" className="flex items-center gap-1">
              <li>
                <a href={marketingFeaturesUrl(locale)} className={NAV_LINK_CLASS}>
                  {t("header.features")}
                </a>
              </li>
              <li>
                <a href={marketingPricingUrl(locale)} className={NAV_LINK_CLASS}>
                  {t("header.pricing")}
                </a>
              </li>
              <li>
                <a href={marketingDownloadUrl(locale)} className={NAV_LINK_CLASS}>
                  {t("header.download")}
                </a>
              </li>
            </ul>
          </nav>

          {identity === null ? null : (
            <a
              href={`${destinationPath(profileDestination(locale))}#personal`}
              data-testid="header-account"
              className="mkt-tap inline-flex min-h-target-min max-w-40 items-center gap-2 rounded-full bg-brand-soft p-1 text-sm sm:ml-1 sm:pr-3.5 font-semibold text-brand-ink outline-none hover:brightness-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {identity.avatarSrc === null ? (
                <span
                  aria-hidden="true"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-logo-gradient text-xs font-bold text-white"
                >
                  {identity.initials}
                </span>
              ) : (
                <img
                  src={identity.avatarSrc}
                  alt=""
                  width={28}
                  height={28}
                  className="size-7 shrink-0 rounded-full object-cover"
                />
              )}
              {/* Initials alone below 640px: the French sign-out label and a
                  name do not both fit a 320px bar beside the brand. */}
              <span className="sr-only truncate sm:not-sr-only">{identity.name}</span>
            </a>
          )}

          {/* A form POST, so the browser sends `Origin` and the route can verify
              it. A link would be a GET, which no state change may be. */}
          <form method="post" action="/auth/signout">
            <button
              type="submit"
              data-testid="sign-out"
              className="mkt-tap inline-flex min-h-target-min items-center justify-center rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-ink outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("profile.signOut")}
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
