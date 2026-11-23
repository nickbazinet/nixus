/**
 * Plans, the comparison table and the pricing FAQ.
 *
 * The amounts here are the baked fallback the prerendered HTML ships with. On
 * the client the live catalog (`GET /v1/billing/plans`) overrides them per
 * field, matched by `lookup_key` (AD-6). Nothing here is a Stripe `price_id`.
 */

export type PlanId = "free" | "classic" | "advance";

export interface Plan {
  readonly id: PlanId;
  readonly name: string;
  readonly shortName: string;
  readonly tagline: string;
  /** Home-page one-liner. */
  readonly teaser: string;
  /** `null` for a plan with no Stripe Price. */
  readonly lookupKey: string | null;
  readonly bakedAmountCents: number;
  readonly bakedCurrency: string;
  readonly monthly: boolean;
  readonly badge?: string;
  readonly features: readonly string[];
  readonly highlighted: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Nixus Free",
    shortName: "Free",
    tagline: "Your own profile, on your computer. No account needed.",
    teaser: "Your own profile, on your computer. No account needed.",
    lookupKey: null,
    bakedAmountCents: 0,
    bakedCurrency: "CAD",
    monthly: false,
    features: [
      "Budgets and net worth history",
      "TFSA, RRSP and FHSA tracking",
      "Next actions and Garage",
    ],
    highlighted: false,
  },
  {
    id: "classic",
    name: "NixusCloud Classic",
    shortName: "Classic",
    tagline: "Your money, across your whole household.",
    teaser: "Household net worth, in one view.",
    lookupKey: "classic_monthly_cad",
    bakedAmountCents: 999,
    bakedCurrency: "CAD",
    monthly: true,
    features: ["Everything in Free", "Household net worth"],
    highlighted: false,
  },
  {
    id: "advance",
    name: "NixusCloud Advance",
    shortName: "Advance",
    tagline: "Classic, plus AI guidance and dashboards you can shape.",
    teaser: "Adds AI integration and custom dashboards.",
    lookupKey: "advance_monthly_cad",
    bakedAmountCents: 1999,
    bakedCurrency: "CAD",
    monthly: true,
    badge: "AI included",
    features: [
      "Everything in Classic",
      "AI statement import and categories",
      "AI assistants",
      "Custom dashboards",
    ],
    highlighted: true,
  },
];

export interface CompareRow {
  readonly label: string;
  /** One line on what the capability does. */
  readonly hint?: string;
  /** Either a per-plan inclusion or a per-plan text value. */
  readonly values: Readonly<Record<PlanId, boolean | string>>;
}

export interface CompareGroup {
    readonly rows: readonly CompareRow[];
}

const ALL = { free: true, classic: true, advance: true } as const;
const CLOUD = { free: false, classic: true, advance: true } as const;
const ADVANCE = { free: false, classic: false, advance: true } as const;

export const COMPARE_GROUPS: readonly CompareGroup[] = [
  {
    rows: [
      {
        label: "Budgets and cash flow",
        hint: "Monthly budgets, expenses and income, and where you stand.",
        values: ALL,
      },
      {
        label: "Accounts and assets in CAD and USD",
        hint: "Banks, cards, investments and real estate.",
        values: ALL,
      },
      {
        label: "Net worth history",
        hint: "Watch it grow over time, from 1M to all time.",
        values: ALL,
      },
      {
        label: "TFSA, RRSP and FHSA tracking",
        hint: "Balances and contribution room next to everything else.",
        values: ALL,
      },
      {
        label: "Savings goals",
        hint: "Plan and fund what you are saving for.",
        values: ALL,
      },
      {
        label: "Insights, forecasts and retirement planning",
        hint: "Spending trends, a year in review and net worth projections.",
        values: ALL,
      },
      {
        label: "Next actions",
        hint: "A short, prioritized list each time you open the app.",
        values: ALL,
      },
      {
        label: "Garage with service alerts",
        hint: "Multiple vehicles, service history and due-date alerts.",
        values: ALL,
      },
    ],
  },
  {
    rows: [
      {
        label: "Cloud backup and sync",
        hint: "Free keeps everything on your computer only. Cloud keeps a safe copy and syncs your devices, so a lost or broken computer does not mean lost records.",
        values: CLOUD,
      },
      {
        label: "Household net worth",
        hint: "One view of what your household owns and owes.",
        values: CLOUD,
      },
    ],
  },
  {
    rows: [
      {
        label: "AI statement import and categories",
        hint: "Drop in a PDF or screenshot and every transaction is read and sorted.",
        values: ADVANCE,
      },
      {
        label: "AI assistant for your money",
        hint: "Ask in plain language where your money went and get answers from your own numbers.",
        values: ADVANCE,
      },
      {
        label: "AI assistant for your car",
        hint: "Ask about service schedules and history.",
        values: ADVANCE,
      },
      {
        label: "Custom dashboards",
        hint: "Build the overview you want, with the numbers you care about.",
        values: ADVANCE,
      },
    ],
  },
  {
    rows: [
      {
        label: "No bank logins or bank connection",
        hint: "You choose which statements to import, on every plan.",
        values: ALL,
      },
      {
        label: "Account required",
        values: { free: "No", classic: "Yes", advance: "Yes" },
      },
    ],
  },
];

export const PRICING_FAQ: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "Do I need an account?",
    answer:
      "Not for Nixus Free. You create a profile on your own computer and that is it. An account is only needed for NixusCloud, because household views and AI run through it.",
  },
  {
    question: "Is Nixus on my computer really free?",
    answer:
      "Yes. Budgets, cash flow, net worth history, registered accounts, savings goals, next actions and Garage all work on your computer at no cost, with no trial and no time limit.",
  },
  {
    question: "Do I need to connect my bank?",
    answer:
      "No. Nixus never asks for your bank login. You import a credit card statement as a PDF or a screenshot, and you choose which ones.",
  },
  {
    question: "Can I cancel NixusCloud and keep my data?",
    answer:
      "Yes. Your records live on your computer, so cancelling only turns off the cloud features tied to your plan. It never deletes what is on your machine.",
  },
  {
    question: "What happens if the alpha stops being updated?",
    answer:
      "Your data is a file on your own computer and the code is open source, so the app keeps working with what you have, and anyone can read or build the code.",
  },
  {
    question: "Is this financial advice?",
    answer:
      "No. Nixus is a tool for tracking and organizing your money. Its suggestions are educational, not tax, legal or investment advice, and you decide what to do.",
  },
];
