import { useTranslation } from "react-i18next";
import { BuyMeACoffeeIcon, BUY_ME_A_COFFEE_URL, Separator } from "@nixus/shared";

import { PRIVACY_PAGE_PATHS, TERMS_PAGE_PATHS } from "./LegalPage";
import { localeFromLanguage } from "@/lib/localePaths";

const GITHUB_URL = "https://github.com/nickbazinet/nixus";
const CONTACT_EMAIL = "support@nixus.nicolasbazinet.net";

// Every footer destination is a 44px touch target below 1024px, so the stacked
// layout needs no extra gap — the targets themselves supply the rhythm. The
// single-row layout starts at `lg`, not `md`: at 768px five destinations plus
// the pre-alpha label and the copyright do not fit on one line, and the longer
// French copyright pushed the row 4px past the viewport.
const LINK_CLASS =
  "mkt-tap inline-flex max-w-full items-center justify-center rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

export function SiteFooter() {
  const { t, i18n } = useTranslation();
  const locale = localeFromLanguage(i18n.language);

  return (
    <footer
      role="contentinfo"
      className="border-t border-border bg-background"
    >
      <div className="mkt-page-x mx-auto max-w-[1280px] py-6 md:py-8">
        <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground lg:flex-row lg:flex-wrap lg:justify-between lg:gap-3 lg:text-left">
          <div className="flex min-w-0 max-w-full flex-col items-center gap-0 lg:flex-row lg:items-center lg:gap-4">
            <nav
              aria-label={t("footer.aria")}
              className="flex min-w-0 max-w-full flex-col items-center gap-0 lg:flex-row lg:items-center lg:gap-4"
            >
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                {t("footer.linkGithub")}
              </a>
              <Separator
                orientation="vertical"
                className="hidden h-4 lg:block"
              />
              <a href={TERMS_PAGE_PATHS[locale]} className={LINK_CLASS}>
                {t("footer.linkTerms")}
              </a>
              <Separator
                orientation="vertical"
                className="hidden h-4 lg:block"
              />
              <a href={PRIVACY_PAGE_PATHS[locale]} className={LINK_CLASS}>
                {t("footer.linkPrivacy")}
              </a>
              <Separator
                orientation="vertical"
                className="hidden h-4 lg:block"
              />
              <a
                href={BUY_ME_A_COFFEE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("footer.linkBuyMeACoffee")}
                className="mkt-tap inline-flex items-center justify-center rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <BuyMeACoffeeIcon className="size-4" />
              </a>
              <Separator
                orientation="vertical"
                className="hidden h-4 lg:block"
              />
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className={`${LINK_CLASS} break-all`}
              >
                {CONTACT_EMAIL}
              </a>
            </nav>
            <Separator
              orientation="vertical"
              className="hidden h-4 lg:block"
            />
            <span className="mt-2 lg:mt-0">{t("footer.preAlphaLabel")}</span>
          </div>
          <p className="mt-2 min-w-0 lg:mt-0">{t("footer.copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
