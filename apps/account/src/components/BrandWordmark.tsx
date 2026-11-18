import { useTranslation } from "react-i18next";
import { cn, NixusLogo } from "@nixus/shared";

import { marketingHomeUrl } from "@/lib/marketing";
import type { Locale } from "@/lib/i18n";

/**
 * The brand lockup: the shared `NixusLogo` mark with the gradient "ixus"
 * wordmark continuing from its "N".
 *
 * Recreated here rather than imported, because a cross-app import from
 * `apps/web` is not allowed — the markup and the class strings are copied
 * verbatim from `apps/web/src/components/SiteHeader.tsx` and `SiteFooter.tsx`
 * so the two surfaces cannot drift. `NixusLogo` itself is the shared canonical
 * asset and is never forked.
 *
 * It links to the marketing site, which is what replaces the old
 * "Back to nixusapp.com" footer link: the logo is the way out of this app.
 */
export function BrandWordmark({
  locale,
  size = "md",
}: {
  readonly locale: Locale;
  readonly size?: "md" | "sm";
}) {
  const { t } = useTranslation();

  return (
    <a
      href={marketingHomeUrl(locale)}
      aria-label={t("brand.home")}
      data-testid="brand-home"
      className="mkt-tap inline-flex shrink-0 items-end gap-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <NixusLogo className={cn("size-8 shrink-0", size === "md" && "sm:size-9")} />
      <span
        className={cn(
          "-ml-0.5 mb-px bg-gradient-to-r from-[#9978ED] to-[#DE50A4] bg-clip-text text-lg leading-none font-semibold whitespace-nowrap text-transparent",
          size === "md" && "sm:text-xl",
        )}
      >
        ixus
      </span>
    </a>
  );
}
