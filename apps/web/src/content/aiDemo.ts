/**
 * Demo data for `<AIDemo />` — the "before" statement lines and the "after"
 * categorized rows.
 *
 * Merchant strings are literal because they are brand names; the category
 * label is a translation-key segment (`aiDemo.category.<key>`).
 *
 * Order is intentional and shared between both columns, so the eye can pair
 * "before" and "after" rows visually without scanning back and forth.
 */

export type StatementLine = {
  /** Uppercase "raw" descriptor, the way a bank export actually arrives. */
  merchant: string;
  amount: number;
};

export type CategorizedRow = {
  merchant: string;
  amount: number;
  categoryKey:
    | "groceries"
    | "diningOut"
    | "gas"
    | "subscriptions"
    | "investing";
  /**
   * Tailwind palette utilities rather than theme tokens: these are category
   * signal colors, so they must look the same on every brand re-skin.
   */
  badgeClass: string;
};

export const statementLines: readonly StatementLine[] = [
  { merchant: "COSTCO WHOLESALE #482", amount: 184.32 },
  { merchant: "TIM HORTONS #1273", amount: 6.45 },
  { merchant: "PETRO-CANADA 0214", amount: 72.1 },
  { merchant: "NETFLIX.COM", amount: 18.99 },
  { merchant: "WEALTHSIMPLE INVEST", amount: 50.0 },
] as const;

export const categorizedRows: readonly CategorizedRow[] = [
  {
    merchant: "Costco",
    amount: 184.32,
    categoryKey: "groceries",
    badgeClass: "bg-emerald-100 text-emerald-800",
  },
  {
    merchant: "Tim Hortons",
    amount: 6.45,
    categoryKey: "diningOut",
    badgeClass: "bg-amber-100 text-amber-800",
  },
  {
    merchant: "Petro-Canada",
    amount: 72.1,
    categoryKey: "gas",
    badgeClass: "bg-indigo-100 text-indigo-800",
  },
  {
    merchant: "Netflix",
    amount: 18.99,
    categoryKey: "subscriptions",
    badgeClass: "bg-purple-100 text-purple-800",
  },
  {
    merchant: "Wealthsimple",
    amount: 50.0,
    categoryKey: "investing",
    badgeClass: "bg-purple-100 text-purple-800",
  },
] as const;
