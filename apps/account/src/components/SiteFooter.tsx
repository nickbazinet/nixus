import { useTranslation } from "react-i18next";

import { marketingPrivacyUrl, marketingTermsUrl } from "@/lib/marketing";
import type { Locale } from "@/lib/i18n";

const LINK_CLASS =
  "mkt-tap inline-flex items-center rounded-sm text-sm text-white/75 underline-offset-4 outline-none hover:text-white hover:underline focus-visible:ring-3 focus-visible:ring-white/50";

/**
 * One dark row: the brand line, then the two legal documents that govern the
 * profile being edited, in the locale being read.
 */
export function SiteFooter({ locale }: { readonly locale: Locale }) {
  const { t } = useTranslation();

  return (
    <footer role="contentinfo" className="mt-16 bg-[#0E0E22] text-white">
      <div className="mkt-page-x account-container flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-white/75">{t("footer.tagline")}</p>

        <nav aria-label={t("footer.legalAria")}>
          <ul role="list" className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <li className="flex">
              <a href={marketingPrivacyUrl(locale)} data-testid="footer-privacy" className={LINK_CLASS}>
                {t("footer.linkPrivacy")}
              </a>
            </li>
            <li className="flex">
              <a href={marketingTermsUrl(locale)} data-testid="footer-terms" className={LINK_CLASS}>
                {t("footer.linkTerms")}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
