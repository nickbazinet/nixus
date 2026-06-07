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
  liabilities_cents: number;
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

export type WaterfallStep =
  | "build_emergency_fund"
  | "pay_high_interest_debt"
  | "contribute_registered_accounts"
  | "invest_surplus";

export type EmergencyFundStatus = "underfunded" | "approaching" | "funded";

export interface EmergencyFundSummary {
  coverage_months: number | null;
  target_months: number;
  progress_ratio: number;
  status: EmergencyFundStatus;
}

export interface SavingsSummary {
  savings_rate_percent: number | null;
  avg_monthly_surplus_cents: number | null;
}

export interface WaterfallSummary {
  current_step: WaterfallStep;
  action_line_key: string;
}

export interface ReasoningParams {
  coverage_months: number | null;
  target_months: number;
  credit_card_debt_cents: number;
  avg_monthly_surplus_cents: number;
  liquid_savings_cents: number;
  avg_monthly_expenses_cents: number;
}

export interface WaterfallDetail {
  current_step: WaterfallStep;
  completed_steps: WaterfallStep[];
  reasoning_key: string;
  reasoning_params: ReasoningParams;
}

export interface FinancialHealthFigures {
  liquid_savings_cents: number;
  avg_monthly_expenses_cents: number;
  avg_monthly_income_cents: number;
  credit_card_debt_cents: number;
  expense_month_count: number;
  income_month_count: number;
}

export interface DiscretionaryCategory {
  category_id: number;
  category_name: string;
  group_name: string;
  avg_monthly_spend_cents: number;
}

export interface MonthlySurplusPoint {
  month: string;
  income_cents: number;
  expense_cents: number;
  surplus_cents: number;
}

export interface FinancialHealthSummary {
  data_sufficient: boolean;
  emergency_fund: EmergencyFundSummary | null;
  savings: SavingsSummary | null;
  waterfall: WaterfallSummary | null;
}

export interface FinancialHealthDetail {
  data_sufficient: boolean;
  emergency_fund: EmergencyFundSummary | null;
  savings: SavingsSummary | null;
  figures: FinancialHealthFigures;
  waterfall: WaterfallDetail;
  top_discretionary_categories: DiscretionaryCategory[];
  monthly_surplus_trend: MonthlySurplusPoint[];
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

export interface VehicleCatalogStatus {
  available: boolean;
  cached_at?: string;
  stale: boolean;
}

export interface VehicleMake {
  name: string;
}

export interface VehicleModel {
  name: string;
}

export interface Vehicle {
  id: number;
  nickname: string;
  make: string | null;
  model: string | null;
  year: number | null;
  odometer_km: number;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceTaskBaseline {
  task_type_key: string;
  interval_km: number;
  interval_months: number;
}

export interface CreateMaintenanceTaskInput {
  task_type_key: string;
  interval_km: number;
  interval_months: number;
}

export interface CreateVehicleInput {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  odometer_km: number;
  use_default_template?: boolean;
  custom_tasks?: CreateMaintenanceTaskInput[];
}

export interface UpdateVehicleInput {
  id: number;
  make?: string | null;
  model?: string | null;
  year?: number | null;
}

export type MaintenanceTaskStatus = "ok" | "upcoming" | "due" | "overdue";

export interface MaintenanceTaskWithStatus {
  id: number;
  vehicle_id: number;
  task_type_key: string;
  interval_km: number;
  interval_months: number;
  default_interval_km: number;
  default_interval_months: number;
  last_service_date: string | null;
  last_service_odometer_km: number | null;
  custom_task_name?: string | null;
  created_at: string;
  updated_at: string;
  status: MaintenanceTaskStatus;
  km_remaining: number | null;
  days_remaining: number | null;
  next_due_date: string | null;
  next_due_odometer_km: number | null;
}

export interface AddMaintenanceTaskInput {
  vehicle_id: number;
  task_type_key?: string | null;
  custom_task_name?: string | null;
  interval_km?: number | null;
  interval_months?: number | null;
}

export interface VehicleWithTasks {
  vehicle: Vehicle;
  tasks: MaintenanceTaskWithStatus[];
}

export interface MaintenanceServiceLog {
  id: number;
  vehicle_id: number;
  task_id: number | null;
  custom_service_name?: string | null;
  service_date: string;
  odometer_km: number;
  notes: string | null;
  created_at: string;
}

export interface MaintenanceServiceLogEntry {
  id: number;
  vehicle_id: number;
  task_id: number | null;
  task_type_key?: string | null;
  custom_service_name?: string | null;
  service_date: string;
  odometer_km: number;
  notes: string | null;
  created_at: string;
}

export interface LogMaintenanceServiceInput {
  task_id: number;
  service_date: string;
  odometer_km: number;
  notes?: string | null;
}

export interface LogCustomServiceInput {
  vehicle_id: number;
  custom_service_name: string;
  service_date: string;
  odometer_km: number;
  notes?: string | null;
}

export interface LogCustomServiceResult {
  log: MaintenanceServiceLog;
  odometer_updated: boolean;
  previous_odometer_km?: number;
  new_odometer_km?: number;
}

export interface LogServiceResult {
  log: MaintenanceServiceLog;
  task: MaintenanceTaskWithStatus;
  odometer_updated: boolean;
  previous_odometer_km?: number;
  new_odometer_km?: number;
}

export interface MostUrgentTask {
  task_type_key: string;
  status: MaintenanceTaskStatus;
  days_remaining?: number;
  km_remaining?: number;
}

export interface VehicleAlertRow {
  vehicle_id: number;
  nickname: string;
  alert_count: number;
  most_urgent_task: MostUrgentTask;
}

export interface MaintenanceAlertSummary {
  total_alerts: number;
  total_vehicles: number;
  vehicles_with_alerts: number;
  worst_status: MaintenanceTaskStatus;
  vehicles: VehicleAlertRow[];
}

export type AiProvider = "bedrock" | "openai";

export interface AiConfig {
  provider: AiProvider | null;
  configured: boolean;
  region: string;
}
