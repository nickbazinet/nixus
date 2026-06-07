use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetGroup {
    pub id: i64,
    pub name: String,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetCategory {
    pub id: i64,
    pub group_id: i64,
    pub name: String,
    pub target_cents: i64,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBudgetGroup {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBudgetCategory {
    pub group_id: i64,
    pub name: String,
    pub target_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetCategoryStatus {
    pub id: i64,
    pub group_id: i64,
    pub name: String,
    pub target_cents: i64,
    pub spent_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Expense {
    pub id: i64,
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub date: String,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateExpenseInput {
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateExpenseInput {
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub institution: String,
    pub account_type: String,
    pub currency: String,
    pub balance_cents: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateAccountInput {
    pub name: String,
    pub institution: String,
    pub account_type: String,
    pub currency: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateAccountInput {
    pub name: String,
    pub institution: String,
    pub account_type: String,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassiveAsset {
    pub id: i64,
    pub name: String,
    pub asset_type: String,
    pub value_cents: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateAssetInput {
    pub name: String,
    pub asset_type: String,
    pub value_cents: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateAssetInput {
    pub name: String,
    pub asset_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetSummary {
    pub total_target_cents: i64,
    pub total_spent_cents: i64,
    pub remaining_cents: i64,
    pub month: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardBudgetCategory {
    pub id: i64,
    pub name: String,
    pub group_name: String,
    pub target_cents: i64,
    pub spent_cents: i64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetWorthCurrent {
    pub total_cents: i64,
    pub cash_cents: i64,
    pub investments_cents: i64,
    pub assets_cents: i64,
    pub liabilities_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetWorthSnapshotSummary {
    pub total_cents: i64,
    pub snapshot_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpendingByCategory {
    pub category_id: i64,
    pub category_name: String,
    pub spent_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetWorthSnapshot {
    pub id: i64,
    pub total_cents: i64,
    pub snapshot_date: String,
    pub breakdown_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetWorthBreakdown {
    pub cash_cents: i64,
    pub crypto_cents: i64,
    pub housing_cents: i64,
    pub tfsa_cents: i64,
    pub rrsp_cents: i64,
    pub fhsa_cents: i64,
    pub non_registered_cents: i64,
    pub business_cents: i64,
    pub vehicles_cents: i64,
    pub other_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetWorthChange {
    pub absolute_change_cents: i64,
    pub percentage_change: f64,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeSource {
    pub id: i64,
    pub name: String,
    pub income_type: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateIncomeSourceInput {
    pub name: String,
    pub income_type: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateIncomeSourceInput {
    pub name: String,
    pub income_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeEntry {
    pub id: i64,
    pub source_id: i64,
    pub source_name: String,
    pub income_type: String,
    pub amount_cents: i64,
    pub date: String,
    pub month: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateIncomeEntryInput {
    pub source_id: i64,
    pub amount_cents: i64,
    pub date: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateIncomeEntryInput {
    pub source_id: i64,
    pub amount_cents: i64,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeTotal {
    pub total_cents: i64,
    pub month: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeSourceWithLastEntry {
    pub id: i64,
    pub name: String,
    pub income_type: String,
    pub last_amount_cents: Option<i64>,
    pub last_month: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlySpendByCategory {
    pub month: String,
    pub category_id: i64,
    pub category_name: String,
    pub spent_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlySpendTotal {
    pub month: String,
    pub total_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpendingTrendsData {
    pub by_category: Vec<MonthlySpendByCategory>,
    pub totals: Vec<MonthlySpendTotal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YearlyCategorySpend {
    pub category_id: i64,
    pub category_name: String,
    pub spent_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YearlySummaryData {
    pub year: i32,
    pub is_current_year: bool,
    pub total_spent_cents: i64,
    pub total_income_cents: i64,
    pub cash_flow_net_cents: i64,
    pub net_worth_gain_cents: Option<i64>,
    pub net_worth_gain_available: bool,
    pub top_categories: Vec<YearlyCategorySpend>,
    pub monthly_totals: Vec<MonthlySpendTotal>,
    pub all_categories: Vec<YearlyCategorySpend>,
    pub available_years: Vec<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountBalanceByType {
    pub account_type: String,
    pub total_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetValueByType {
    pub asset_type: String,
    pub total_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerchantHint {
    pub merchant: String,
    pub budget_category_id: i64,
    pub confidence_score: f64,
    pub usage_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurringExpenseTemplate {
    pub id: i64,
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub day_of_month: i32,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRecurringExpenseTemplateInput {
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub day_of_month: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRecurringExpenseTemplateInput {
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub day_of_month: i32,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiscretionaryCategory {
    pub category_id: i64,
    pub category_name: String,
    pub group_name: String,
    pub avg_monthly_spend_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EmergencyFundStatus {
    Underfunded,
    Approaching,
    Funded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EmergencyFundSummary {
    pub coverage_months: Option<f64>,
    pub target_months: i64,
    pub progress_ratio: f64,
    pub status: EmergencyFundStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SavingsSummary {
    pub savings_rate_percent: Option<f64>,
    pub avg_monthly_surplus_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WaterfallSummary {
    pub current_step: crate::financial_health::evaluator::WaterfallStep,
    pub action_line_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WaterfallDetail {
    pub current_step: crate::financial_health::evaluator::WaterfallStep,
    pub completed_steps: Vec<crate::financial_health::evaluator::WaterfallStep>,
    pub reasoning_key: String,
    pub reasoning_params: crate::financial_health::evaluator::ReasoningParams,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FinancialHealthFigures {
    pub liquid_savings_cents: i64,
    pub avg_monthly_expenses_cents: i64,
    pub avg_monthly_income_cents: i64,
    pub credit_card_debt_cents: i64,
    pub expense_month_count: i64,
    pub income_month_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MonthlySurplusPoint {
    pub month: String,
    pub income_cents: i64,
    pub expense_cents: i64,
    pub surplus_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FinancialHealthSummary {
    pub data_sufficient: bool,
    pub emergency_fund: Option<EmergencyFundSummary>,
    pub savings: Option<SavingsSummary>,
    pub waterfall: Option<WaterfallSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FinancialHealthDetail {
    pub data_sufficient: bool,
    pub emergency_fund: Option<EmergencyFundSummary>,
    pub savings: Option<SavingsSummary>,
    pub figures: FinancialHealthFigures,
    pub waterfall: WaterfallDetail,
    pub top_discretionary_categories: Vec<DiscretionaryCategory>,
    pub monthly_surplus_trend: Vec<MonthlySurplusPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectionInput {
    pub account_balances: Vec<AccountBalanceByType>,
    pub asset_values: Vec<AssetValueByType>,
    pub avg_monthly_income_cents: i64,
    pub avg_monthly_expense_cents: i64,
    pub income_month_count: i64,
    pub expense_month_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vehicle {
    pub id: i64,
    pub nickname: String,
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<i32>,
    pub odometer_km: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceTask {
    pub id: i64,
    pub vehicle_id: i64,
    pub task_type_key: String,
    pub interval_km: i64,
    pub interval_months: i64,
    pub last_service_date: Option<String>,
    pub last_service_odometer_km: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_task_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceTaskWithStatus {
    pub id: i64,
    pub vehicle_id: i64,
    pub task_type_key: String,
    pub interval_km: i64,
    pub interval_months: i64,
    pub last_service_date: Option<String>,
    pub last_service_odometer_km: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub status: crate::maintenance::evaluator::TaskStatus,
    pub km_remaining: Option<i64>,
    pub days_remaining: Option<i64>,
    pub next_due_date: Option<String>,
    pub next_due_odometer_km: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_task_name: Option<String>,
    pub default_interval_km: i64,
    pub default_interval_months: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleWithTasks {
    pub vehicle: Vehicle,
    pub tasks: Vec<MaintenanceTaskWithStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceTaskBaseline {
    pub task_type_key: String,
    pub interval_km: i64,
    pub interval_months: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AddMaintenanceTaskInput {
    pub vehicle_id: i64,
    #[serde(default)]
    pub task_type_key: Option<String>,
    #[serde(default)]
    pub custom_task_name: Option<String>,
    pub interval_km: Option<i64>,
    pub interval_months: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMaintenanceTaskInput {
    pub task_type_key: String,
    pub interval_km: i64,
    pub interval_months: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateVehicleInput {
    pub odometer_km: i64,
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<i32>,
    #[serde(default = "default_use_default_template")]
    pub use_default_template: bool,
    pub custom_tasks: Option<Vec<CreateMaintenanceTaskInput>>,
}

fn default_use_default_template() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateVehicleInput {
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceServiceLog {
    pub id: i64,
    pub vehicle_id: i64,
    pub task_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_service_name: Option<String>,
    pub service_date: String,
    pub odometer_km: i64,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceServiceLogEntry {
    pub id: i64,
    pub vehicle_id: i64,
    pub task_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_type_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_service_name: Option<String>,
    pub service_date: String,
    pub odometer_km: i64,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LogMaintenanceServiceInput {
    pub task_id: i64,
    pub service_date: String,
    pub odometer_km: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LogCustomServiceInput {
    pub vehicle_id: i64,
    pub custom_service_name: String,
    pub service_date: String,
    pub odometer_km: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogCustomServiceResult {
    pub log: MaintenanceServiceLog,
    pub odometer_updated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_odometer_km: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_odometer_km: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogServiceResult {
    pub log: MaintenanceServiceLog,
    pub task: MaintenanceTaskWithStatus,
    pub odometer_updated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_odometer_km: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_odometer_km: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MostUrgentTask {
    pub task_type_key: String,
    pub status: crate::maintenance::evaluator::TaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days_remaining: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub km_remaining: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleAlertRow {
    pub vehicle_id: i64,
    pub nickname: String,
    pub alert_count: i64,
    pub most_urgent_task: MostUrgentTask,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceAlertSummary {
    pub total_alerts: i64,
    pub total_vehicles: i64,
    pub vehicles_with_alerts: i64,
    pub worst_status: crate::maintenance::evaluator::TaskStatus,
    pub vehicles: Vec<VehicleAlertRow>,
}
