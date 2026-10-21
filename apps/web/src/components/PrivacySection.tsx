import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Check, HardDrive, Sparkles, RefreshCw } from "lucide-react";

import { SectionIntro } from "@/components/SectionIntro";
import { IconChip } from "@/components/IconChip";
import { PRIVACY_PAGE_PATHS } from "./LegalPage";
import { localeFromLanguage } from "@/lib/localePaths";

/**
 * The local-first section.
 *
 * "Local-first, no bank passwords" was previously a hero eyebrow and a feature
 * card — a claim with no substance behind it, on the single topic this audience
 * is most sceptical about. This section is the substance: what stays on the
 * machine, and the two things that can ever leave it, each named and each stated
 * as opt-in with its actual destination.
 *
 * Volunteering the exceptions is the point. A privacy section that only lists
 * guarantees invites the reader to go hunting for the catch; one that states the
 * catch first is the reason to believe the rest, and it matches the honesty the
 * rest of the page already trades on.
 */

const EXCEPTION_ICONS = { ai: Sparkles, sync: RefreshCw } as const;
const EXCEPTION_IDS = ["ai", "sync"] as const;
const STAYS_IDS = ["records", "credentials", "offline"] as const;

export function PrivacySection() {
  const { t, i18n } = useTranslation();
  const privacyHref = PRIVACY_PAGE_PATHS[localeFromLanguage(i18n.language)];

  return (
    <section
      id="privacy"
      data-testid="privacy-section"
      aria-labelledby="privacy-heading"
      className="mkt-band-tint mkt-wash mkt-wash-violet mkt-section-y border-y border-border"
    >
      <div className="mkt-page-x mkt-container">
        <SectionIntro
          id="privacy-heading"
          eyebrow={t("privacy.eyebrow")}
          heading={t("privacy.heading")}
          lead={t("privacy.subhead")}
          align="center"
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">
          <div data-reveal-item=""
            className="mkt-card mkt-panel mkt-tint-brand self-start border p-6 lg:col-span-2 lg:p-8">
            <div className="flex items-center gap-3">
              <IconChip icon={HardDrive} stop={1} />
              <h3 className="text-base font-semibold text-foreground">
                {t("privacy.stays.heading")}
              </h3>
            </div>
            <ul role="list" className="mt-5 flex flex-col gap-4">
              {STAYS_IDS.map((id) => (
                <li key={id} className="flex gap-3">
                  <Check
                    aria-hidden="true"
                    className="mt-[3px] size-4 shrink-0 text-good"
                  />
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {t(`privacy.stays.items.${id}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-3">
            <ul role="list" className="flex flex-col gap-4">
              {EXCEPTION_IDS.map((id, index) => {
                const Icon = EXCEPTION_ICONS[id];
                return (
                  <li
                    key={id}
                    data-testid="privacy-exception"
                    data-reveal-item=""
                    style={{ "--reveal-i": index + 1 } as CSSProperties}
                    className="mkt-card mkt-panel border border-border bg-card p-5 sm:p-6"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <IconChip icon={Icon} stop={id === "ai" ? 3 : 4} size="sm" />
                      <h3 className="text-base font-semibold text-foreground">
                        {t(`privacy.exceptions.items.${id}.title`)}
                      </h3>
                      <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-xs font-semibold tracking-wider text-brand-ink uppercase">
                        {t("privacy.exceptions.optInBadge")}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {t(`privacy.exceptions.items.${id}.body`)}
                    </p>
                  </li>
                );
              })}
            </ul>
            <a
              href={privacyHref}
              data-testid="privacy-policy-link"
              className="mkt-tap mt-5 inline-flex items-center text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("privacy.policyLink")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
