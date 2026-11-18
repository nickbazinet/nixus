import { useTranslation } from "react-i18next";

import { BrandWordmark } from "./BrandWordmark";
import { marketingPrivacyUrl, marketingTermsUrl } from "@/lib/marketing";
import type { Locale } from "@/lib/i18n";

/**
 * A reduced version of `apps/web/src/components/SiteFooter.tsx`.
 *
 * Same surface, same hairline, same gutters, same link treatment and the same
 * copyright line — but one row rather than five columns. The marketing footer's
 * columns are a site map for an eleven-section landing page; reproducing them
 * on a one-page signed-in surface would be a map to somewhere else. What a
 * visitor here needs is the way back to the brand and the two legal documents
 * that govern the profile they are editing, in the locale they are reading.
 */
const LINK_CLASS =
  "mkt-tap inline-flex max-w-full items-center rounded-sm text-sm break-words text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

export function SiteFooter({ locale }: { readonly locale: Locale }) {
  const { t } = useTranslation();

  return (
    <footer role="contentinfo" className="border-t border-border bg-background">
      <div className="mkt-page-x mkt-container py-10 md:py-14">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <BrandWordmark locale={locale} size="sm" />

          <nav aria-label={t("footer.legalAria")}>
            <ul role="list" className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <li className="flex">
                <a
                  href={marketingTermsUrl(locale)}
                  data-testid="footer-terms"
                  className={LINK_CLASS}
                >
                  {t("footer.linkTerms")}
                </a>
              </li>
              <li className="flex">
                <a
                  href={marketingPrivacyUrl(locale)}
                  data-testid="footer-privacy"
                  className={LINK_CLASS}
                >
                  {t("footer.linkPrivacy")}
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
          <p>{t("footer.copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
