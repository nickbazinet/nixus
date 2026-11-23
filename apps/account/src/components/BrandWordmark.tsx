import { useTranslation } from "react-i18next";

import logoUrl from "@/assets/nixus-logo.webp";
import { marketingHomeUrl } from "@/lib/marketing";
import type { Locale } from "@/lib/i18n";

/**
 * The brand lockup: the Nixus mark beside the "Nixus" name.
 *
 * It links to the marketing site: the logo is the way out of this app. The mark
 * is a raster (the source artwork is one), served at 4x its displayed size.
 */
export function BrandWordmark({ locale }: { readonly locale: Locale }) {
  const { t } = useTranslation();

  return (
    <a
      href={marketingHomeUrl(locale)}
      aria-label={t("brand.home")}
      data-testid="brand-home"
      className="mkt-tap inline-flex shrink-0 items-center gap-1.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <img src={logoUrl} alt="" width={32} height={32} className="size-8 shrink-0" />
      <span className="font-display text-lg leading-none font-bold whitespace-nowrap text-ink">
        Nixus
      </span>
    </a>
  );
}
