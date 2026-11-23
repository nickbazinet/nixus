import type {
  Account,
  RecurringExpenseTemplate,
  RecurringIncomeTemplate,
  RecurringTransferTemplate,
} from "@/lib/types";
import { nextOccurrence } from "./recurringSchedule";

// One table renders all three kinds, so every row carries its origin rather than the caller
// keeping three parallel lists in sync.
export type RecurringRow =
  | { kind: "expense"; template: RecurringExpenseTemplate }
  | { kind: "income"; template: RecurringIncomeTemplate }
  | { kind: "transfer"; template: RecurringTransferTemplate };

export const ROW_TEST_IDS: Record<RecurringRow["kind"], string> = {
  expense: "recurring-template-row",
  income: "recurring-income-row",
  transfer: "recurring-transfer-row",
};

export const BADGES = {
  expense: { variant: "neutral", labelKey: "recurring.typeExpense" },
  income: { variant: "good", labelKey: "recurring.typeIncome" },
  transfer: { variant: "brand", labelKey: "recurring.typeTransfer" },
} as const;

export const INCOME_TYPE_KEYS: Record<string, string> = {
  employment: "income.typeEmployment",
  freelance: "income.typeFreelance",
  investment: "income.typeInvestment",
  other: "income.typeOther",
};

export function rowName(row: RecurringRow, accountNames: Map<number, string>): string {
  switch (row.kind) {
    case "expense":
      return row.template.merchant;
    case "income":
      return row.template.source_name;
    case "transfer":
      return `${accountNames.get(row.template.from_account_id) ?? "—"} → ${
        accountNames.get(row.template.to_account_id) ?? "—"
      }`;
  }
}

export function rowKey(row: RecurringRow): string {
  return `${row.kind}-${row.template.id}`;
}

export function buildRecurringRows(
  expenseTemplates: readonly RecurringExpenseTemplate[],
  incomeTemplates: readonly RecurringIncomeTemplate[],
  transferTemplates: readonly RecurringTransferTemplate[]
): RecurringRow[] {
  return [
    ...expenseTemplates.map((template): RecurringRow => ({ kind: "expense", template })),
    ...incomeTemplates.map((template): RecurringRow => ({ kind: "income", template })),
    ...transferTemplates.map((template): RecurringRow => ({ kind: "transfer", template })),
  ];
}

export interface UpcomingRow {
  row: RecurringRow;
  date: Date;
}

/**
 * The next few payments that will actually happen, soonest first. Paused templates are left out —
 * a paused bill is kept on record but nothing is due from it.
 */
export function upcomingRecurringRows(
  rows: readonly RecurringRow[],
  limit: number,
  from: Date = new Date()
): UpcomingRow[] {
  return rows
    .filter((row) => row.template.is_active)
    .map((row) => ({ row, date: nextOccurrence(row.template, from) }))
    .filter((entry): entry is UpcomingRow => entry.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, limit);
}

/** Names the accounts a transfer row needs, keyed by id. */
export function accountNameMap(accounts: readonly Account[]): Map<number, string> {
  return new Map(accounts.map((account) => [account.id, account.name]));
}
