/**
 * The shape of every translatable string on the site.
 *
 * This is the whole i18n mechanism. There is no runtime i18n library: each
 * language is one plain object checked against `SiteCopy` at compile time, so
 * adding a string to English and forgetting French is a type error rather than
 * a page that silently falls back to the wrong language. The structural parity
 * test in `content/copy.test.ts` covers what a type cannot — array lengths and
 * accidental leftovers.
 *
 * Copy only. Icons, layout, visuals and anything with a Stripe `lookup_key` in
 * it stay in code, and are matched to the arrays below by position.
 */

import type { PageId } from "@/lib/routes";

/** A heading carrying one gradient-accented span: `lead` + `accent` + `tail`. */
export interface AccentHeading {
  readonly lead: string;
  readonly accent: string;
  readonly tail: string;
}

/** A card, a step or a feature: one short title and one line of body. */
export interface TitledBody {
  readonly title: string;
  readonly body: string;
}

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

/* ------------------------------------------------------------------ shell */

export interface ShellCopy {
  readonly skipToMain: string;
  /** The strip above the header, on the home page of each language only. */
  readonly announcement: { readonly text: string; readonly cta: string };
  readonly header: {
    readonly homeAria: string;
    readonly navAria: string;
    readonly nav: {
      readonly features: string;
      readonly pricing: string;
      readonly mission: string;
      readonly privacy: string;
      readonly foundingUsers: string;
    };
    readonly logIn: string;
    readonly getStarted: string;
    readonly openMenu: string;
    readonly closeMenu: string;
  };
  readonly language: {
    /** `aria-label` of the switcher itself. */
    readonly label: string;
    /** Short visible labels. */
    readonly short: { readonly en: string; readonly fr: string };
    /** Each language's own name, used for the accessible label and `title`. */
    readonly name: { readonly en: string; readonly fr: string };
    /** `aria-label` on the inactive option — `{language}` is a `name` above. */
    readonly switchTo: string;
  };
  readonly footer: {
    readonly tagline: string;
    readonly columns: {
      readonly product: string;
      readonly company: string;
      readonly follow: string;
      readonly legal: string;
    };
    readonly links: {
      readonly features: string;
      readonly pricing: string;
      readonly download: string;
      readonly mission: string;
      readonly foundingUsers: string;
      readonly github: string;
      readonly instagram: string;
      readonly facebook: string;
      readonly privacy: string;
      readonly privacyPolicy: string;
      readonly terms: string;
    };
  };
}

/* ------------------------------------------------------------------- meta */

export interface PageMeta {
  readonly title: string;
  readonly description: string;
}

export interface MetaCopy {
  readonly pages: Record<PageId, PageMeta>;
  /** `og:image:alt`. Describes the share card, not the page. */
  readonly ogImageAlt: string;
  /** The `WebSite` node's `description` in the JSON-LD graph. */
  readonly siteDescription: string;
}

/* ---------------------------------------------------------------- visuals */

/**
 * Labels inside the decorative product mock-ups.
 *
 * They are `aria-hidden` illustrations, so the amounts and percentages are demo
 * values written out per language rather than formatted at runtime — there is no
 * number behind them to format.
 */
export interface VisualsCopy {
  readonly hero: {
    readonly spendingLabel: string;
    readonly spendingDelta: string;
    readonly spendingAmount: string;
    readonly breakdown: string;
    readonly slices: readonly { readonly label: string; readonly share: string }[];
    readonly reminderTitle: string;
    readonly reminderBody: string;
  };
  readonly tourVideoLabel: string;
  readonly importCategories: readonly string[];
  readonly registeredAccounts: readonly {
    readonly label: string;
    readonly amount: string;
  }[];
}

/* ------------------------------------------------------------------- home */

export interface HomeCopy {
  readonly hero: {
    readonly kicker: string;
    readonly heading: AccentHeading;
    readonly lead: string;
    readonly ctaDownload: string;
    readonly ctaFeatures: string;
    readonly platforms: string;
    readonly trialLead: string;
    readonly trialLink: string;
  };
  readonly minus: {
    /** `<h2>` split across a two-column grid: "Minus" | "the admin". */
    readonly heading: { readonly first: string; readonly rest: string; readonly accent: string };
    readonly subtracted: readonly string[];
    readonly pitchHeading: string;
    readonly pitchBody: string;
    readonly missionLink: string;
  };
  readonly features: {
    readonly kicker: string;
    readonly heading: string;
    readonly body: string;
    readonly trialNote: string;
    readonly highlights: readonly TitledBody[];
    readonly link: string;
  };
  readonly how: {
    readonly kicker: string;
    readonly heading: string;
    readonly steps: readonly TitledBody[];
  };
  readonly mission: {
    readonly kicker: string;
    readonly heading: string;
    readonly body: string;
    readonly cta: string;
  };
  readonly pricing: {
    readonly kicker: string;
    readonly headingLines: readonly string[];
    /** Appended after the plan's own trial badge: ", then the monthly price." */
    readonly trialThen: string;
    readonly compareLink: string;
  };
  readonly founding: {
    readonly kicker: string;
    readonly heading: string;
    readonly body: string;
    readonly cta: string;
  };
  readonly closing: {
    readonly kicker: string;
    readonly heading: AccentHeading;
    readonly subtractTitle: string;
    readonly subtractItems: readonly string[];
    readonly addTitle: string;
    readonly addItems: readonly string[];
    readonly footnote: string;
    readonly trialFootnote: string;
    readonly cta: string;
  };
}

/* --------------------------------------------------------------- features */

export interface FeatureRow {
  readonly heading: string;
  readonly body: string;
  readonly points: readonly string[];
}

export interface FeaturesCopy {
  readonly kicker: string;
  readonly heading: { readonly first: string; readonly accent: string; readonly tail: string };
  readonly lead: string;
  readonly subtractTitle: string;
  readonly subtractItems: readonly string[];
  readonly addTitle: string;
  readonly addItems: readonly string[];
  readonly ctaDownload: string;
  readonly ctaPricing: string;
  readonly rows: readonly FeatureRow[];
  readonly toolbox: {
    readonly kicker: string;
    readonly heading: string;
    readonly body: string;
    readonly items: readonly TitledBody[];
    readonly privacyLink: string;
  };
  readonly why: {
    readonly kicker: string;
    readonly heading: string;
    readonly lead: string;
    readonly cards: readonly TitledBody[];
  };
  readonly closing: {
    readonly heading: string;
    readonly body: string;
    readonly cta: string;
  };
}

/* ---------------------------------------------------------------- pricing */

export type PlanId = "free" | "classic" | "advance";

/** Everything about a plan that is words rather than a Stripe fact. */
export interface PlanCopy {
  readonly name: string;
  readonly shortName: string;
  readonly tagline: string;
  /** The home page's one-liner for the same plan. */
  readonly teaser: string;
  readonly features: readonly string[];
  readonly badge?: string;
}

/** The free-trial offer as the site words it. The Price keys live in code. */
export interface PlanTrialCopy {
  readonly badge: string;
  readonly cta: string;
  /** `{price}` is replaced with the resolved display price, e.g. "19,99 $/mois". */
  readonly microcopy: string;
  readonly secondaryCta: string;
}

export interface CompareRowCopy {
  readonly label: string;
  /** One line on what the capability does. */
  readonly hint?: string;
  /** Per-plan inclusion, or a per-plan text value where a tick is too blunt. */
  readonly values: Readonly<Record<PlanId, boolean | string>>;
}

export interface CompareGroupCopy {
  readonly rows: readonly CompareRowCopy[];
}

export interface PricingCopy {
  readonly kicker: string;
  readonly heading: { readonly first: string; readonly accent: string; readonly tail: string };
  readonly lead: string;
  readonly taxNote: string;
  readonly plans: Record<PlanId, PlanCopy>;
  readonly trial: PlanTrialCopy;
  /** CTA on a plan with no trial. `{plan}` is that plan's `shortName`. */
  readonly choosePlan: string;
  /** CTA on the free plan, which is a download rather than a checkout. */
  readonly downloadCta: string;
  readonly compare: {
    readonly heading: string;
    readonly lead: string;
    readonly caption: string;
    readonly featureColumn: string;
    readonly included: string;
    readonly notIncluded: string;
    readonly groups: readonly CompareGroupCopy[];
  };
  readonly founding: {
    readonly kicker: string;
    readonly heading: string;
    readonly body: string;
    readonly cta: string;
  };
  readonly faqHeading: string;
  readonly faq: readonly FaqItem[];
}

/* ---------------------------------------------------------------- mission */

export interface MissionCopy {
  readonly kicker: string;
  readonly heading: AccentHeading;
  readonly lead: string;
  readonly goals: {
    readonly kicker: string;
    readonly heading: string;
    readonly items: readonly TitledBody[];
  };
  readonly founder: {
    readonly photoAlt: string;
    readonly name: string;
    readonly role: string;
    readonly kicker: string;
    readonly heading: string;
    readonly paragraphs: readonly string[];
  };
  readonly promises: {
    readonly kicker: string;
    readonly heading: string;
    readonly items: readonly TitledBody[];
    readonly worksTitle: string;
    readonly worksItems: readonly string[];
    readonly isntTitle: string;
    readonly isntItems: readonly string[];
  };
  readonly closing: {
    readonly heading: string;
    readonly body: string;
    readonly cta: string;
  };
}

/* ---------------------------------------------------------------- privacy */

export interface PrivacyLayer {
  readonly badge: string;
  readonly title: string;
  /** The bold opening line of the card. */
  readonly lead: string;
  readonly body: string;
  readonly points: readonly string[];
}

export interface PrivacyFlow {
  readonly situation: string;
  /** Second line under the situation, where there is one. */
  readonly situationNote?: string;
  readonly sent: string;
  readonly control: string;
}

export interface PrivacyCopy {
  readonly kicker: string;
  readonly heading: AccentHeading;
  readonly lead: string;
  readonly layers: {
    readonly kicker: string;
    readonly heading: string;
    readonly lead: string;
    readonly items: readonly PrivacyLayer[];
  };
  readonly flows: {
    readonly heading: string;
    readonly columnSituation: string;
    readonly columnSent: string;
    readonly columnControl: string;
    readonly rows: readonly PrivacyFlow[];
    readonly policyNoteLead: string;
    readonly policyNoteLink: string;
  };
  readonly noLogins: { readonly kicker: string; readonly heading: string; readonly body: string };
  readonly openSource: {
    readonly kicker: string;
    readonly heading: string;
    readonly body: string;
    readonly link: string;
  };
  readonly closing: { readonly heading: string; readonly cta: string };
}

/* --------------------------------------------------------- founding users */

export interface FoundingUsersCopy {
  readonly kicker: string;
  readonly heading: AccentHeading;
  readonly noteTitle: string;
  readonly noteBody: string;
  readonly lead: string;
  readonly cta: string;
  readonly benefits: {
    readonly kicker: string;
    readonly heading: string;
    readonly items: readonly TitledBody[];
  };
  readonly ask: {
    readonly kicker: string;
    readonly heading: string;
    readonly body: string;
    readonly items: readonly string[];
  };
  readonly how: {
    readonly kicker: string;
    readonly heading: string;
    readonly steps: readonly TitledBody[];
  };
  readonly apply: {
    readonly kicker: string;
    readonly heading: string;
    readonly body: string;
  };
  readonly form: {
    readonly nameLabel: string;
    readonly emailLabel: string;
    readonly emailPlaceholder: string;
    readonly todayLabel: string;
    readonly todayOptions: readonly string[];
    readonly noBrainerLabel: string;
    readonly submit: string;
    readonly privacyNote: string;
    /** Shown after the mail app is handed the answers. `{email}` is the mailbox. */
    readonly sentNote: string;
    /** Subject line of the generated email. `{name}` is the applicant. */
    readonly mailSubject: string;
    readonly mailSubjectNoName: string;
    readonly mailNameLabel: string;
    readonly mailEmailLabel: string;
    readonly mailTodayLabel: string;
    readonly mailNoBrainerLabel: string;
  };
}

/* --------------------------------------------------------------- download */

export interface DownloadCopy {
  readonly kicker: string;
  readonly heading: AccentHeading;
  readonly lead: string;
  readonly platforms: readonly { readonly name: string; readonly label: string }[];
  readonly firstRun: {
    readonly kicker: string;
    readonly heading: string;
    readonly items: readonly string[];
  };
  readonly more: {
    readonly kicker: string;
    readonly heading: string;
    readonly body: string;
    readonly trialNote: string;
    readonly plansLink: string;
    readonly accountLink: string;
  };
}

/* -------------------------------------------------------------- not found */

export interface NotFoundCopy {
  readonly heading: string;
  readonly body: string;
  readonly cta: string;
}

/* ------------------------------------------------------------------ legal */

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface LegalDocument {
  readonly heading: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
  readonly contactHeading: string;
  readonly contactBody: string;
}

export interface LegalCopy {
  readonly lastUpdated: string;
  readonly backHome: string;
  readonly terms: LegalDocument;
  readonly privacyPolicy: LegalDocument;
}

/* ------------------------------------------------------------------- root */

export interface SiteCopy {
  readonly shell: ShellCopy;
  readonly meta: MetaCopy;
  readonly visuals: VisualsCopy;
  readonly home: HomeCopy;
  readonly features: FeaturesCopy;
  readonly pricing: PricingCopy;
  readonly mission: MissionCopy;
  readonly privacy: PrivacyCopy;
  readonly foundingUsers: FoundingUsersCopy;
  readonly download: DownloadCopy;
  readonly notFound: NotFoundCopy;
  readonly legal: LegalCopy;
}
