import { useTranslation } from "react-i18next";

import { homePath } from "@/lib/localePaths";
import type { Locale } from "@/lib/site";

export const TERMS_PAGE_PATHS = {
  en: "/terms",
  fr: "/fr/terms",
} as const;

export const PRIVACY_PAGE_PATHS = {
  en: "/privacy",
  fr: "/fr/privacy",
} as const;

const CONTACT_EMAIL = "support@nixus.nicolasbazinet.net";

/** A heading plus one or more paragraphs. Rendered in order. */
export interface LegalSection {
  readonly headingKey: string;
  readonly bodyKeys: readonly string[];
}

/**
 * Terms and Privacy share one renderer because AD-13 makes them a single
 * disclosure gate: divergent layouts invite one document to drift out of sync
 * with the other while both still look intentional.
 */
export function LegalPage({
  locale,
  headingKey,
  introKey,
  sections,
  contactHeadingKey,
  contactBodyKey,
}: {
  locale: Locale;
  headingKey: string;
  introKey: string;
  sections: readonly LegalSection[];
  contactHeadingKey: string;
  contactBodyKey: string;
}) {
  const { t } = useTranslation();

  return (
    <article className="mx-auto max-w-[70ch] px-6 py-16 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
        {t(headingKey)}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">{t("legal.lastUpdated")}</p>
      <p className="mt-6 text-base leading-relaxed text-foreground">{t(introKey)}</p>

      {sections.map((section) => (
        <section key={section.headingKey} className="mt-10">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {t(section.headingKey)}
          </h2>
          {section.bodyKeys.map((bodyKey) => (
            <p
              key={bodyKey}
              className="mt-4 text-base leading-relaxed text-muted-foreground"
            >
              {t(bodyKey)}
            </p>
          ))}
        </section>
      ))}

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {t(contactHeadingKey)}
        </h2>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {t(contactBodyKey)}{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>

      <p className="mt-12">
        <a
          href={homePath(locale)}
          className="rounded-sm text-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t("legal.backHome")}
        </a>
      </p>
    </article>
  );
}

/** Section order is the disclosure order AD-13 requires; keep them together. */
export const TERMS_SECTIONS: readonly LegalSection[] = [
  { headingKey: "termsPage.acceptance.heading", bodyKeys: ["termsPage.acceptance.body"] },
  {
    headingKey: "termsPage.aiFeatures.heading",
    bodyKeys: [
      "termsPage.aiFeatures.body",
      "termsPage.aiFeatures.byo",
      "termsPage.aiFeatures.hosted",
      // AD-9: hosted wins over a configured BYO provider and there is no toggle.
      // Users must be told which path their prompt actually takes.
      "termsPage.aiFeatures.precedence",
    ],
  },
  { headingKey: "termsPage.quota.heading", bodyKeys: ["termsPage.quota.body"] },
  { headingKey: "termsPage.accounts.heading", bodyKeys: ["termsPage.accounts.body"] },
  { headingKey: "termsPage.noAdvice.heading", bodyKeys: ["termsPage.noAdvice.body"] },
  { headingKey: "termsPage.yourData.heading", bodyKeys: ["termsPage.yourData.body"] },
  { headingKey: "termsPage.warranty.heading", bodyKeys: ["termsPage.warranty.body"] },
  { headingKey: "termsPage.changes.heading", bodyKeys: ["termsPage.changes.body"] },
];

export const PRIVACY_SECTIONS: readonly LegalSection[] = [
  { headingKey: "privacyPage.local.heading", bodyKeys: ["privacyPage.local.body"] },
  { headingKey: "privacyPage.aiLeaves.heading", bodyKeys: ["privacyPage.aiLeaves.body"] },
  { headingKey: "privacyPage.byo.heading", bodyKeys: ["privacyPage.byo.body"] },
  {
    headingKey: "privacyPage.hosted.heading",
    bodyKeys: [
      "privacyPage.hosted.body",
      "privacyPage.hosted.precedence",
      "privacyPage.hosted.notRetained",
      "privacyPage.hosted.retained",
    ],
  },
  {
    headingKey: "privacyPage.limits.heading",
    bodyKeys: ["privacyPage.limits.aws", "privacyPage.limits.processingRegion"],
  },
  { headingKey: "privacyPage.quota.heading", bodyKeys: ["privacyPage.quota.body"] },
  { headingKey: "privacyPage.noSale.heading", bodyKeys: ["privacyPage.noSale.body"] },
  { headingKey: "privacyPage.analytics.heading", bodyKeys: ["privacyPage.analytics.body"] },
];

export function TermsPage({ locale }: { locale: Locale }) {
  return (
    <LegalPage
      locale={locale}
      headingKey="termsPage.heading"
      introKey="termsPage.intro"
      sections={TERMS_SECTIONS}
      contactHeadingKey="termsPage.contact.heading"
      contactBodyKey="termsPage.contact.body"
    />
  );
}

export function PrivacyPage({ locale }: { locale: Locale }) {
  return (
    <LegalPage
      locale={locale}
      headingKey="privacyPage.heading"
      introKey="privacyPage.intro"
      sections={PRIVACY_SECTIONS}
      contactHeadingKey="privacyPage.contact.heading"
      contactBodyKey="privacyPage.contact.body"
    />
  );
}
