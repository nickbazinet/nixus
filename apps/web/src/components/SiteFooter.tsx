import { useTranslation } from "react-i18next";
import { BuyMeACoffeeIcon, BUY_ME_A_COFFEE_URL, Separator } from "@nixus/shared";

const GITHUB_URL = "https://github.com/nickbazinet/nixus";
const CONTACT_EMAIL = "support@nixus.nicolasbazinet.net";

export function SiteFooter() {
  const { t } = useTranslation();
  return (
    <footer
      role="contentinfo"
      className="border-t border-border bg-background"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-8 md:px-8">
        <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground md:flex-row md:justify-between md:text-left">
          <div className="flex flex-col items-center gap-3 md:flex-row md:items-center md:gap-4">
            <nav
              aria-label={t("footer.aria")}
              className="flex flex-col items-center gap-3 md:flex-row md:items-center md:gap-4"
            >
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {t("footer.linkGithub")}
              </a>
              <Separator
                orientation="vertical"
                className="hidden h-4 md:block"
              />
              <a
                href={BUY_ME_A_COFFEE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("footer.linkBuyMeACoffee")}
                className="inline-flex rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <BuyMeACoffeeIcon className="size-4" />
              </a>
              <Separator
                orientation="vertical"
                className="hidden h-4 md:block"
              />
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {CONTACT_EMAIL}
              </a>
            </nav>
            <Separator
              orientation="vertical"
              className="hidden h-4 md:block"
            />
            <span>{t("footer.preAlphaLabel")}</span>
          </div>
          <p>{t("footer.copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
