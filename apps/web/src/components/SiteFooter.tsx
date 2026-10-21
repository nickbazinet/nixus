import { useTranslation } from "react-i18next";
import { BuyMeACoffeeIcon, BUY_ME_A_COFFEE_URL, NixusLogo } from "@nixus/shared";
import { Facebook, Github, Instagram } from "lucide-react";

import { contactMailto } from "@/content/contact";
import { PRIVACY_PAGE_PATHS, TERMS_PAGE_PATHS } from "./LegalPage";
import { betaPagePath, homePath, localeFromLanguage } from "@/lib/localePaths";

const GITHUB_URL = "https://github.com/nickbazinet/nixus";
const INSTAGRAM_URL = "https://www.instagram.com/nixusapp/";
const FACEBOOK_URL = "https://www.facebook.com/people/Nixus/61594399344720/";

/**
 * Multi-column site footer.
 *
 * Replaces a single centred row of five destinations, which read as unfinished
 * on a page this long — a visitor who scrolled past eleven sections arrives
 * expecting a site map and finds a disclaimer. Columns also give the existing
 * destinations somewhere to belong, so adding one no longer means lengthening a
 * row that already wrapped awkwardly at 768px.
 *
 * Every destination keeps the 44px floor below 1024px, and the column headings
 * are real headings inside `<nav>` landmarks so the groups are navigable rather
 * than only visual.
 */
const LINK_CLASS =
  "mkt-tap inline-flex max-w-full items-center rounded-sm text-sm break-words text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";
const ICON_LINK_CLASS =
  "mkt-tap inline-flex items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

type FooterLink = {
  readonly href: string;
  readonly label: string;
  readonly external?: boolean;
};

type FooterColumn = {
  readonly id: "product" | "trust" | "community" | "legal";
  readonly links: readonly FooterLink[];
};

export function SiteFooter() {
  const { t, i18n } = useTranslation();
  const locale = localeFromLanguage(i18n.language);
  const home = homePath(locale);

  const columns: readonly FooterColumn[] = [
    {
      id: "product",
      links: [
        { href: `${home}#how-it-works`, label: t("nav.howItWorks") },
        { href: `${home}#how`, label: t("nav.product") },
        { href: `${home}#features`, label: t("nav.features") },
        { href: `${home}#tour`, label: t("footer.col.tourLink") },
      ],
    },
    {
      id: "trust",
      links: [
        { href: `${home}#privacy`, label: t("footer.col.privacyLink") },
        { href: `${home}#honest`, label: t("footer.col.honestLink") },
        { href: `${home}#faq`, label: t("nav.faq") },
      ],
    },
    {
      id: "community",
      links: [
        { href: betaPagePath(locale), label: t("footer.col.foundingLink") },
        { href: contactMailto(), label: t("footer.col.contactLink") },
      ],
    },
    {
      id: "legal",
      links: [
        { href: TERMS_PAGE_PATHS[locale], label: t("footer.linkTerms") },
        { href: PRIVACY_PAGE_PATHS[locale], label: t("footer.linkPrivacy") },
      ],
    },
  ];

  return (
    <footer role="contentinfo" className="border-t border-border bg-background">
      <div className="mkt-page-x mx-auto max-w-[1280px] py-10 md:py-14">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] lg:gap-8">
          <div>
            <a
              href={home}
              aria-label={t("header.brandHome")}
              className="mkt-tap inline-flex items-end rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <NixusLogo className="size-8 shrink-0" />
              <span className="-ml-0.5 mb-px bg-gradient-to-r from-[#A78BFA] to-[#F472B6] bg-clip-text text-lg leading-none font-semibold whitespace-nowrap text-transparent">
                ixus
              </span>
            </a>
            <p className="mt-4 max-w-[32ch] text-sm leading-relaxed text-muted-foreground">
              {t("footer.tagline")}
            </p>
            <span
              role="group"
              aria-label={t("footer.socialAria")}
              className="mt-5 flex items-center gap-3"
            >
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("footer.linkGithub")}
                className={ICON_LINK_CLASS}
              >
                <Github aria-hidden="true" className="size-4" />
              </a>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("footer.linkInstagram")}
                className={ICON_LINK_CLASS}
              >
                <Instagram aria-hidden="true" className="size-4" />
              </a>
              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("footer.linkFacebook")}
                className={ICON_LINK_CLASS}
              >
                <Facebook aria-hidden="true" className="size-4" />
              </a>
              <a
                href={BUY_ME_A_COFFEE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("footer.linkBuyMeACoffee")}
                className={ICON_LINK_CLASS}
              >
                <BuyMeACoffeeIcon className="size-4" />
              </a>
            </span>
          </div>

          {columns.map((column) => (
            <nav key={column.id} aria-labelledby={`footer-col-${column.id}`}>
              <h2
                id={`footer-col-${column.id}`}
                className="text-xs font-semibold tracking-wider text-foreground uppercase"
              >
                {t(`footer.col.${column.id}`)}
              </h2>
              <ul role="list" className="mt-4 flex flex-col gap-1">
                {column.links.map((link) => (
                  <li key={link.href} className="flex">
                    <a
                      href={link.href}
                      className={LINK_CLASS}
                      target={link.external === true ? "_blank" : undefined}
                      rel={
                        link.external === true
                          ? "noopener noreferrer"
                          : undefined
                      }
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
          <p>{t("footer.copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
