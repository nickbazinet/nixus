/**
 * Plans, the comparison table and the pricing FAQ.
 *
 * The amounts here are the baked fallback the prerendered HTML ships with. On
 * the client the live catalog (`GET /v1/billing/plans`) overrides them per
 * field, matched by `lookup_key` (AD-6). Nothing here is a Stripe `price_id`.
 */

export type PlanId = "free" | "classic" | "advance";

/**
 * A plan's free trial, as the marketing site refers to it.
 *
 * `lookupKey` is a Stripe Price `lookup_key` and nothing else (AD-6): the trial
 * is a second Price on the Advance Product, so it is linked to exactly like any
 * other plan and carries no `price_id` and no amount here.
 *
 * `microcopy` carries `{price}` rather than an amount, because the amount after
 * the trial is the Advance price and that is resolved from the live catalog with
 * the baked value below as the fallback. Writing it out here would be a second
 * place a price change has to reach.
 */
export interface PlanTrial {
  readonly lookupKey: string;
  readonly days: number;
  readonly badge: string;
  readonly cta: string;
  /** `{price}` is replaced with the resolved display price, e.g. "$19.99/month". */
  readonly microcopy: string;
  readonly secondaryCta: string;
}

export const ADVANCE_TRIAL: PlanTrial = {
  lookupKey: "advance_trial",
  days: 7,
  badge: "7 days free",
  cta: "Start 7-day free trial",
  microcopy:
    "7 days free, then {price}. A card is required. Cancel anytime before the trial ends and you won't be charged.",
  secondaryCta: "Or subscribe now, without a trial",
};

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
  /** Present only where a trial Price is published for the plan. */
  readonly trial?: PlanTrial;
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
    trial: ADVANCE_TRIAL,
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
      {
        label: "Free trial",
        hint: "Advance monthly starts with 7 days free. A card is required, and it continues as a paid monthly plan unless you cancel before the trial ends.",
        values: { free: "Not needed", classic: "No", advance: "7 days" },
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
      "Yes. Budgets, cash flow, net worth history, registered accounts, savings goals, next actions and Garage all work on your computer at no cost, with no time limit and no card. It is not a trial that runs out. The 7-day free trial is a separate thing: it lets you try the paid NixusCloud Advance features before you pay for them.",
  },
  {
    question: "How does the free trial work?",
    answer:
      "NixusCloud Advance monthly starts with 7 days free. You sign in, enter a card on Stripe's secure page, and get every Advance feature straight away — AI statement import, the AI assistants, custom dashboards and the household view. The trial applies to Advance monthly only, not to the yearly price and not to Classic.",
  },
  {
    question: "Will I be charged during the trial?",
    answer:
      "No. A card is required when you start, because the trial turns into a paid subscription on its own, but nothing is charged for the first 7 days. Stripe may briefly verify the card, which some banks show as a temporary hold and never as a charge.",
  },
  {
    question: "What happens when the trial ends?",
    answer:
      "On day 8 your subscription continues automatically as paid NixusCloud Advance monthly, at the price shown above, and your card is charged then. It renews each month until you cancel. Stripe emails you before the trial ends so the charge is never a surprise.",
  },
  {
    question: "Can I cancel during the trial?",
    answer:
      "Yes, at any point before it ends, and you will not be charged. Go to account.nixusapp.com, open Manage plan, and cancel in Stripe's billing portal. You keep Advance until the day the trial was due to end, then the account goes back to the free plan. Nothing on your computer is lost either way: your records live in a file on your own machine.",
  },
  {
    question: "Can I use the free trial more than once?",
    answer:
      "The trial is meant as one per person, and Nixus may decline a repeat trial. If you have had Advance before, you can still subscribe at the regular price at any time.",
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
    question: "Who do I pay, and are taxes included?",
    answer:
      "Stripe sells NixusCloud and is the seller of record, so you pay on Stripe's secure pages and Nixus never sees or stores your card. Prices are listed in Canadian dollars with tax included, and outside Canada checkout shows the price in your own currency. You can cancel, update your card and switch plans from your account, and refunds go through Stripe.",
  },
  {
    question: "Is this financial advice?",
    answer:
      "No. Nixus is a tool for tracking and organizing your money. Its suggestions are educational, not tax, legal or investment advice, and you decide what to do.",
  },
];
