import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { IconChip, rampStop } from "@/components/IconChip";

import { trustClaims } from "@/content/trust";

const GITHUB_URL = "https://github.com/nickbazinet/nixus";

/**
 * The trust band directly under the hero.
 *
 * Deliberately not a card grid: a visitor is still scrolling at this point, so
 * the band is a single hairline-bordered row that reads in one pass. The claims
 * are facts rather than marketing lines, and the open-source one links out so it
 * can be checked on the spot — a trust claim a visitor cannot verify is just a
 * slogan.
 *
 * The section is named by `aria-label`, not by a visually-hidden heading. An
 * `sr-only` heading is clipped by construction (`w-px` + `overflow-hidden`), so
 * it registers as a real clipped heading in the responsive suite's
 * `clippedHeadings` check — a permanent false positive in a guard that exists to
 * catch actual text truncation.
 */
export function TrustStrip() {
  const { t } = useTranslation();

  return (
    <section
      data-testid="trust-strip"
      aria-label={t("trust.heading")}
      className="mkt-band-tint mkt-section-y mkt-overlap-clear border-y border-border"
    >
      <div className="mkt-page-x mkt-container">
        <ul
          role="list"
          className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4"
        >
          {trustClaims.map((claim, index) => {
            const Icon = claim.icon;
            const isOpenSource = claim.id === "openSource";
            return (
              <li
                key={claim.id}
                data-testid="trust-claim"
                data-reveal-item=""
                style={{ "--reveal-i": index } as CSSProperties}
                className="flex gap-3"
              >
                <IconChip icon={Icon} stop={rampStop(index)} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {t(`trust.${claim.id}.title`)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(`trust.${claim.id}.body`)}
                  </p>
                  {isOpenSource ? (
                    <a
                      href={GITHUB_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="trust-github-link"
                      className="mkt-tap mt-1 inline-flex text-sm font-medium text-brand-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {t("trust.openSource.link")}
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
