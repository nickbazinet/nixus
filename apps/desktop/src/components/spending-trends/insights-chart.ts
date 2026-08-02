/**
 * Chart primitives shared by the three Insights surfaces — Spending Trends, Year Summary,
 * Projection. Lives here rather than in a fourth directory so all three can import one answer.
 */

/**
 * The eight-step ramp, in rank order. Index 0 goes to the LARGEST series or segment, index 7 to the
 * smallest — never pinned to a category identity, so a category does not keep "its" colour when its
 * rank changes between periods.
 *
 * Rank ordering is half of what makes adjacency safe: the ramp alternates luminance (odd steps dark,
 * even steps light), so walking it in rank order puts a dark step next to a light one. The other
 * half is SEGMENT_DIVIDER below.
 */
export const CHART_RAMP = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

export const CHART_RAMP_LENGTH = CHART_RAMP.length;

/**
 * The 1px `--card` divider every stacked or allocation chart draws between segments. It is not
 * decoration: `--chart-3` and `--chart-7` sit at exactly 1.00:1 to each other in light mode, so
 * this is the only thing guaranteeing a perceivable boundary when they land side by side.
 */
export const SEGMENT_DIVIDER = "var(--card)";

/** Rank-ordered fill. Ranks past the eighth reuse the last step — the ramp never grows past eight. */
export function rampColor(rank: number): string {
  const index = Math.min(Math.max(rank, 0), CHART_RAMP_LENGTH - 1);
  return CHART_RAMP[index];
}

const LOCALE_TAGS: Record<string, string> = { en: "en-CA", fr: "fr-CA" };

/** i18next language -> the BCP 47 tag `Money` and `Intl` want. */
export function insightsLocale(language: string): string {
  return LOCALE_TAGS[language] ?? LOCALE_TAGS.en;
}

/** Axis ticks while values are hidden. `aria-hidden` on the plot, so this is visual only. */
const MASKED_TICK = "\u2022\u2022\u2022";

/** Below this the axis reads in whole dollars; at or above it, in locale-compact form. */
const COMPACT_THRESHOLD_CENTS = 1_000_000;

/**
 * ONE format for the whole axis, chosen once from the largest tick. A per-tick decision is what
 * produces `$0.0 / $850.0 / $1.7K / $2.6K` — four formats on one axis.
 */
export function makeAxisTickFormatter(
  maxCents: number,
  locale: string,
  masked: boolean,
): (cents: number) => string {
  if (masked) return () => MASKED_TICK;

  const compact = Math.abs(maxCents) >= COMPACT_THRESHOLD_CENTS;
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CAD",
    currencyDisplay: "narrowSymbol",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: 0,
  });

  return (cents: number) => format.format(Math.round(cents / 100));
}

/**
 * `Dec '25`, never `Dec 25` — the latter parses as a date. Takes a `YYYY-MM` key.
 * Returns the raw key unchanged if it is not one, so a malformed month never renders as `NaN`.
 */
export function formatMonthKey(monthKey: string, locale: string): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;
  return formatMonthTick(parsed.year, parsed.monthIndex, locale);
}

/** `Dec '25` from a year and a month index, which may overflow past 11 and roll the year forward. */
export function formatMonthTick(
  year: number,
  monthIndex: number,
  locale: string,
): string {
  const date = new Date(year, monthIndex, 1);
  const month = new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
  return `${month} \u2019${String(date.getFullYear()).slice(-2)}`;
}

/** The month name on its own — for the "this month isn't finished" sentence. */
export function formatMonthName(monthKey: string, locale: string): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;
  return new Intl.DateTimeFormat(locale, { month: "long" }).format(
    new Date(parsed.year, parsed.monthIndex, 1),
  );
}

export function parseMonthKey(
  monthKey: string,
): { year: number; monthIndex: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return { year, monthIndex };
}

/** `YYYY-MM` for the calendar month in progress. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Which of the three cost groups a surface is showing. The screen never says "fixed" or "variable"
 * — those are engineering words. See BILL_GROUP_LABEL_KEYS for what the user actually reads.
 */
export type CostGroup = "all" | "bills" | "changeable";

export const COST_GROUPS = ["all", "bills", "changeable"] as const;

export const COST_GROUP_LABEL_KEYS: Record<CostGroup, string> = {
  all: "insights.costGroupAll",
  bills: "insights.costGroupBills",
  changeable: "insights.costGroupChangeable",
};

/**
 * Names that read as a bill you cannot easily change. Matched as substrings on the CATEGORY name,
 * in both languages, because the Insights payloads carry no group and no fixed-cost flag — the
 * backend's own classification lives on `budget_groups.name`, which never reaches the frontend
 * here. That gap is why the surface states the basis in words rather than presenting the split as
 * something Nixus knows for certain.
 */
const BILL_NAME_PATTERNS = [
  // en
  "mortgage",
  "rent",
  "housing",
  "insurance",
  "utilit",
  "hydro",
  "electric",
  "heating",
  "water bill",
  "internet",
  "phone",
  "loan",
  "debt",
  "property tax",
  "condo",
  "daycare",
  "childcare",
  "tuition",
  // fr
  "hypoth",
  "loyer",
  "logement",
  "assurance",
  "\u00e9lectricit",
  "electricit",
  "chauffage",
  "t\u00e9l\u00e9phone",
  "telephone",
  "pr\u00eat",
  "pret",
  "dette",
  "imp\u00f4t",
  "impot",
  "taxe",
  "garderie",
  "scolarit",
] as const;

export function isBillCategory(categoryName: string): boolean {
  const lower = categoryName.toLocaleLowerCase();
  return BILL_NAME_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** Filters a category list to the selected cost group. `all` passes everything through. */
export function filterByCostGroup<T extends { category_name: string }>(
  rows: readonly T[],
  group: CostGroup,
): T[] {
  if (group === "all") return [...rows];
  const wantBill = group === "bills";
  return rows.filter((row) => isBillCategory(row.category_name) === wantBill);
}
