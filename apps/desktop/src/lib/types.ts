export interface BudgetGroup {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface BudgetCategory {
  id: number;
  group_id: number;
  name: string;
  target_cents: number;
  sort_order: number;
  created_at: string;
}

export interface BudgetCategoryStatus {
  id: number;
  group_id: number;
  name: string;
  target_cents: number;
  spent_cents: number;
}

export interface Expense {
  id: number;
  merchant: string;
  amount_cents: number;
  budget_category_id: number;
  date: string;
  source: string;
  created_at: string;
}

export interface CreateExpenseInput {
  merchant: string;
  amount_cents: number;
  budget_category_id: number;
  date: string;
}

export interface UpdateExpenseInput {
  id: number;
  merchant: string;
  amount_cents: number;
  budget_category_id: number;
  date: string;
}

export interface Account {
  id: number;
  name: string;
  institution: string;
  account_type: string;
  currency: string;
  balance_cents: number;
  created_at: string;
  updated_at: string;
}

export interface CreateAccountInput {
  name: string;
  institution: string;
  account_type: string;
  currency: string;
}

export interface UpdateAccountBalanceInput {
  id: number;
  balance_cents: number;
}

export interface UpdateAccountInput {
  id: number;
  name: string;
  institution: string;
  account_type: string;
  currency: string;
}

export interface PassiveAsset {
  id: number;
  name: string;
  asset_type: string;
  value_cents: number;
  created_at: string;
  updated_at: string;
}

export interface CreateAssetInput {
  name: string;
  asset_type: string;
  value_cents: number;
}

export interface UpdateAssetInput {
  id: number;
  name: string;
  asset_type: string;
}

export interface UpdateAssetValueInput {
  id: number;
  value_cents: number;
}

export interface BudgetSummary {
  total_target_cents: number;
  total_spent_cents: number;
  remaining_cents: number;
  month: string;
}

export interface DashboardBudgetCategory {
  id: number;
  name: string;
  group_name: string;
  target_cents: number;
  spent_cents: number;
  percentage: number;
}

export interface NetWorthCurrent {
  total_cents: number;
  cash_cents: number;
  investments_cents: number;
  assets_cents: number;
}

export interface NetWorthSnapshotSummary {
  total_cents: number;
  snapshot_date: string;
}

export interface SpendingByCategory {
  category_id: number;
  category_name: string;
  spent_cents: number;
}

export interface NetWorthSnapshot {
  id: number;
  total_cents: number;
  snapshot_date: string;
  breakdown_json: string;
  created_at: string;
}

export interface NetWorthChange {
  absolute_change_cents: number;
  percentage_change: number;
  direction: string;
}

export interface NetWorthBreakdownCategory {
  name: string;
  cents: number;
  percentage: number;
  color: string;
}

export interface IncomeSource {
  id: number;
  name: string;
  income_type: string;
  created_at: string;
  updated_at: string;
}

export interface IncomeSourceWithLastEntry {
  id: number;
  name: string;
  income_type: string;
  last_amount_cents: number | null;
  last_month: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIncomeSourceInput {
  name: string;
  income_type: string;
}

export interface UpdateIncomeSourceInput {
  id: number;
  name: string;
  income_type: string;
}

export interface IncomeEntry {
  id: number;
  source_id: number;
  source_name: string;
  income_type: string;
  amount_cents: number;
  date: string;
  month: string;
  created_at: string;
  updated_at: string;
}

export interface CreateIncomeEntryInput {
  source_id: number;
  amount_cents: number;
  date: string;
}

export interface UpdateIncomeEntryInput {
  id: number;
  source_id: number;
  amount_cents: number;
  date: string;
}

export interface IncomeTotal {
  total_cents: number;
  month: string;
}

export interface MonthlySpendByCategory {
  month: string;
  category_id: number;
  category_name: string;
  spent_cents: number;
}

export interface MonthlySpendTotal {
  month: string;
  total_cents: number;
}

export interface SpendingTrendsData {
  by_category: MonthlySpendByCategory[];
  totals: MonthlySpendTotal[];
}

export interface YearlyCategorySpend {
  category_id: number;
  category_name: string;
  spent_cents: number;
}

export interface YearlySummaryData {
  year: number;
  is_current_year: boolean;
  total_spent_cents: number;
  total_income_cents: number;
  cash_flow_net_cents: number;
  net_worth_gain_cents: number | null;
  net_worth_gain_available: boolean;
  top_categories: YearlyCategorySpend[];
  monthly_totals: MonthlySpendTotal[];
  all_categories: YearlyCategorySpend[];
  available_years: number[];
}

export interface AccountBalanceByType {
  account_type: string;
  total_cents: number;
}

export interface AssetValueByType {
  asset_type: string;
  total_cents: number;
}

export interface ProjectionInput {
  account_balances: AccountBalanceByType[];
  asset_values: AssetValueByType[];
  avg_monthly_income_cents: number;
  avg_monthly_expense_cents: number;
  income_month_count: number;
  expense_month_count: number;
}

export interface RecurringExpenseTemplate {
  id: number;
  merchant: string;
  amount_cents: number;
  budget_category_id: number;
  day_of_month: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateRecurringExpenseTemplateInput {
  merchant: string;
  amount_cents: number;
  budget_category_id: number;
  day_of_month: number;
}

export interface UpdateRecurringExpenseTemplateInput {
  id: number;
  merchant: string;
  amount_cents: number;
  budget_category_id: number;
  day_of_month: number;
  is_active: boolean;
}

export interface ChatConversation {
  id: number;
  title: string | null;
  agent_id: string;
  created_at: string;
  updated_at: string;
}

export type AiProvider = "bedrock" | "openai";

export interface AiConfig {
  provider: AiProvider | null;
  configured: boolean;
  region: string;
}
