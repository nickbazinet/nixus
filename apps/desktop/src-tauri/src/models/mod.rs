use serde::{Deserialize, Serialize};
use std::borrow::Cow;

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
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemBudgetTemplate {
    pub format_version: i32,
    pub id: Option<Cow<'static, str>>,
    pub name: Cow<'static, str>,
    pub description: Option<Cow<'static, str>>,
    // Cow (not String/Vec) so SYSTEM_TEMPLATES can be a `pub const` while the
    // same type still deserializes owned data from an imported JSON file.
    pub groups: Cow<'static, [TemplateGroupDef]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateGroupDef {
    pub name: Cow<'static, str>,
    pub categories: Cow<'static, [TemplateCategoryDef]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateCategoryDef {
    pub name: Cow<'static, str>,
    pub target_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyBudgetTemplateResult {
    pub groups_created: i32,
    pub categories_created: i32,
    pub skipped_groups: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemBudgetTemplateSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

/// A user's edit to one authored target, addressed by name because a compiled
/// template has no row ids to reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateTargetOverride {
    pub group_name: String,
    pub category_name: String,
    pub target_cents: i64,
}

/// Owned projection of [`SystemBudgetTemplate`] for the IPC boundary. Separate
/// from `SystemBudgetTemplateSummary` because a preview screen needs the targets
/// the list response deliberately omits.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemBudgetTemplateDetail {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub groups: Vec<TemplateGroupDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateGroupDetail {
    pub name: String,
    pub categories: Vec<TemplateCategoryDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateCategoryDetail {
    pub name: String,
    pub target_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Expense {
    pub id: i64,
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub account_id: Option<i64>,
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
    pub account_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateExpenseInput {
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub date: String,
    pub account_id: Option<i64>,
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
    pub account_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIncomeEntryInput {
    pub source_id: i64,
    pub amount_cents: i64,
    pub date: String,
    pub account_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateIncomeEntryInput {
    pub source_id: i64,
    pub amount_cents: i64,
    pub date: String,
    pub account_id: Option<i64>,
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
pub struct CategoryCompareRow {
    pub category_id: i64,
    pub category_name: String,
    pub avg_cents: i64,
    pub target_cents: Option<i64>,
    pub delta_pct: Option<i32>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpendingTrendsData {
    pub by_category: Vec<MonthlySpendByCategory>,
    pub totals: Vec<MonthlySpendTotal>,
    pub category_compare: Vec<CategoryCompareRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendsInsightRequest {
    pub months: i32,
    pub window_label: String,
    pub locale: String,
    pub categories: Vec<CategoryCompareRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendsInsightResponse {
    pub headline: String,
    pub body: String,
    pub tone: String,
    pub window_label: String,
}

// The advisory prompt's entire numeric vocabulary. Every field is a figure something else already
// computed — the pace command for the rates, `get_budget_status` for the categories the command
// attaches separately — so the model has nothing left to derive and no reason to invent.
// `actual_monthly_cents` and `months_to_target` are nullable for the same reason as in `ProjectPace`:
// absent is not zero, and "you save $0/mo" is a claim the data does not support.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAdviceRequest {
    pub project_name: String,
    pub remaining_cents: i64,
    pub required_monthly_cents: i64,
    pub actual_monthly_cents: Option<i64>,
    pub months_to_target: Option<i64>,
    pub locale: String,
}

// Read-only text plus the machine tone enum, echoing back the project it describes so a late
// response cannot be painted onto a different row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAdviceResponse {
    pub headline: String,
    pub body: String,
    pub tone: String,
    pub project_name: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurringIncomeTemplate {
    pub id: i64,
    pub source_id: i64,
    pub source_name: String,
    pub income_type: String,
    pub amount_cents: i64,
    pub day_of_month: i32,
    pub account_id: Option<i64>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRecurringIncomeTemplateInput {
    pub source_id: i64,
    pub amount_cents: i64,
    pub day_of_month: i32,
    pub account_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRecurringIncomeTemplateInput {
    pub source_id: i64,
    pub amount_cents: i64,
    pub day_of_month: i32,
    pub account_id: Option<i64>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitoSession {
    pub access_token: String,
    pub id_token: String,
    pub refresh_token: String,
    // WHY: Unix epoch seconds as i64, not the project's ISO-8601 String date convention. This
    // value is compared against `now` to decide whether to refresh (Story 26.5), so it must be
    // numeric arithmetic input rather than a user-facing date.
    pub expires_at: i64,
}

// Variants stay PascalCase on purpose: Story 27.1's TypeScript union discriminates on the
// literals "LoggedOut" | "LoggedIn" | "SessionExpired", so `rename_all` must NOT be applied.
// `name` intentionally has no `skip_serializing_if`: the wire shape is `name: string | null`.
// WHY: constructed by get_auth_session in Story 26.5. Remove the allow then.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum AuthState {
    LoggedOut,
    LoggedIn { email: String, name: Option<String> },
    SessionExpired,
}

// WHY the in-document `cognito_sub`: it is the integrity guard that makes a
// filename/content mismatch read as "no profile" rather than leak another
// account's data. Serde-default casing on purpose — `rename_all = "camelCase"`
// on `catalog.rs::VehicleCatalogStatus` is a local exception, not the convention.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub schema_version: u32,
    pub cognito_sub: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_date: Option<String>,
    pub income_bracket: Option<String>,
    pub income_bracket_currency: Option<String>,
    pub country_code: Option<String>,
    pub subdivision_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// WHY no `skip_serializing_if`: an unset field must serialize as `null` so `""`
// and `null` never both mean "unset".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserProfileInput {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_date: Option<String>,
    pub income_bracket: Option<String>,
    pub income_bracket_currency: Option<String>,
    pub country_code: Option<String>,
    pub subdivision_code: Option<String>,
}

// `eligible_from_year` is returned rather than only the total because the UI
// interpolates it into the caption, and `known_through_year` is returned so
// support can tell "withheld because past the table bound" from "withheld
// because ineligible" without reading the binary. There is deliberately no
// remaining-room field: Nixus tracks balances, not contributions, so remaining
// room is not computable from available data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TfsaAccumulatedLimit {
    pub total_cents: i64,
    pub eligible_from_year: i32,
    pub known_through_year: i32,
}

// The IPC shape of a country: `subdivisions` is deliberately absent so
// `get_countries` never ships 5,000 rows to populate a 250-row select.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Country {
    pub code: String,
    pub name_en: String,
    pub name_fr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subdivision {
    pub code: String,
    pub name_en: String,
    pub name_fr: Option<String>,
}

// The file shape of a country, which nests its subdivisions so a lookup by
// country code is an index hit rather than a filter over a flat list.
// `#[serde(default)]` is what lets the dataset omit the key entirely for the
// countries that have none. The dataset's `_source*` / `_generated_by` metadata
// keys are deliberately unmodelled: serde ignores unknown fields, and an unread
// struct field is a dead-code warning.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CountryEntry {
    pub code: String,
    pub name_en: String,
    pub name_fr: Option<String>,
    #[serde(default)]
    pub subdivisions: Vec<Subdivision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Iso3166Dataset {
    pub countries: Vec<CountryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub target_cents: i64,
    pub target_date: Option<String>,
    pub priority: i32,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub target_cents: i64,
    pub target_date: Option<String>,
    pub priority: Option<i32>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateProjectInput {
    pub name: String,
    pub target_cents: i64,
    pub target_date: Option<String>,
    pub priority: Option<i32>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContribution {
    pub id: i64,
    pub project_id: i64,
    pub account_id: i64,
    pub amount_cents: i64,
    pub source: String,
    pub date: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateProjectContributionInput {
    pub project_id: i64,
    pub account_id: i64,
    pub amount_cents: i64,
    pub source: String,
    pub date: String,
}

// Structurally `CreateProjectContributionInput` minus `source`, and that omission is the control:
// the confirm path writes `'suggested'` as a SQL literal in `db/projects.rs`, so no caller can name
// its own source value through the IPC boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAllocationInput {
    pub project_id: i64,
    pub account_id: i64,
    pub amount_cents: i64,
    pub date: String,
}

// Saved totals are aggregated on read (`SUM(amount_cents)`), never stored on `projects`: a stored
// column would drift the moment a contribution is deleted outside the path that maintains it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSavedTotal {
    pub project_id: i64,
    pub saved_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountEarmarkSegment {
    pub project_id: i64,
    pub project_name: String,
    pub earmarked_cents: i64,
}

// `unallocated_cents` is a signed difference, never clamped: segments plus unallocated must account
// for every cent of `balance_cents`, so an over-earmarked account reports a negative remainder
// instead of hiding the over-commitment behind a floor of zero.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountEarmarkBreakdown {
    pub account_id: i64,
    pub balance_cents: i64,
    pub earmarked_cents: i64,
    pub unallocated_cents: i64,
    pub segments: Vec<AccountEarmarkSegment>,
}

// Backend-internal grounding input for the advisory prompt, like `BudgetCategoryStatus`: it never
// crosses to the frontend. `account_type` is carried even though only `chequing`/`savings` can ever
// populate it, so the filter that produced the row stays auditable at the point the prompt is built
// rather than being an invisible promise of the SQL. `unallocated_cents` is the same difference
// `AccountEarmarkBreakdown` reports, but aggregated across every project rather than one.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountHeadroom {
    pub account_id: i64,
    pub account_name: String,
    pub account_type: String,
    pub unallocated_cents: i64,
}

// `active_project_count` is what lets the dashboard card distinguish "no goals yet" (render nothing)
// from "goals with nothing saved yet" (render zero) — a total alone cannot tell those apart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavingsProjectsSummary {
    pub active_project_count: i64,
    pub total_saved_cents: i64,
    pub total_target_cents: i64,
}

// `remaining_cents`, `months_to_target`, `priority_rank` and `weight` are carried on the wire so the
// suggestion is auditable rather than a black box: the panel bounds its editable field by
// `remaining_cents` and explains *why* a project got more from the urgency and rank figures.
// `PartialEq` is what lets the determinism test compare two runs directly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectAllocationSuggestion {
    pub project_id: i64,
    pub project_name: String,
    pub suggested_cents: i64,
    pub remaining_cents: i64,
    pub target_cents: i64,
    pub saved_cents: i64,
    pub target_date: Option<String>,
    pub months_to_target: Option<i64>,
    pub priority_rank: i32,
    pub weight: i64,
}

// The two rates are nullable together and separately from `status`: a `neutral` project has no
// definable required rate (no deadline, or too new to average), and sending `0` instead of `null`
// would render as "you need $0/mo", which is a claim rather than an absence. `PartialEq` is what lets
// the determinism test compare two runs directly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectPace {
    pub project_id: i64,
    pub required_monthly_cents: Option<i64>,
    pub actual_monthly_cents: Option<i64>,
    /// One of `good`, `caution`, `over`, `neutral` — the `Badge` variants the row may use.
    pub status: String,
}

// How the current calendar month was settled. A tagged enum rather than a `settled: bool` plus
// nullable columns because the two outcomes carry different facts: a confirmation has a receipt
// (a date, a total, a project count) and a skip has nothing but the month it applies to.
// `settled_by` is the discriminant so the frontend switches on one field.
//
// `Confirm` is never stored: it is derived from the `project_contributions` ledger itself
// (`source = 'suggested'` rows dated inside the month), which is why there is no "confirmed" flag
// anywhere in the schema. `Skip` is the only stored half, and it lives in the `config` table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "settled_by", rename_all = "snake_case")]
pub enum SuggestionSettlement {
    Confirm {
        /// ISO 8601 `YYYY-MM-DD`: the newest suggested contribution date inside the month.
        settled_date: String,
        /// `YYYY-MM`.
        settled_month: String,
        confirmed_total_cents: i64,
        confirmed_project_count: i64,
    },
    Skip {
        /// `YYYY-MM`.
        settled_month: String,
    },
}

// The suggestion surface's whole state in one read. `suggestions` is carried even when the month is
// settled: "Adjust this month's split" re-opens the live panel without a second round trip, and the
// panel needs the same rows it would have got unsettled.
//
// `remaining_surplus_cents` is `available_surplus_cents` minus whatever the month already confirmed,
// so the settled card can say how much of the surplus is still unspoken for without redoing the
// arithmetic in TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SuggestedAllocationResponse {
    pub suggestions: Vec<ProjectAllocationSuggestion>,
    pub available_surplus_cents: i64,
    pub remaining_surplus_cents: i64,
    /// `YYYY-MM`, the month the cadence is currently asking about.
    pub current_month: String,
    /// ISO 8601 `YYYY-MM-DD` of the 1st of next month: when the panel reopens on its own.
    pub next_suggestion_date: String,
    pub settlement: Option<SuggestionSettlement>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_state_logged_out_serializes_with_status_tag() {
        let json = serde_json::to_string(&AuthState::LoggedOut).unwrap();
        assert_eq!(json, r#"{"status":"LoggedOut"}"#);
    }

    #[test]
    fn auth_state_logged_in_serializes_with_name() {
        let json = serde_json::to_string(&AuthState::LoggedIn {
            email: "user@example.com".to_string(),
            name: Some("Nick".to_string()),
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"status":"LoggedIn","email":"user@example.com","name":"Nick"}"#
        );
    }

    #[test]
    fn auth_state_logged_in_serializes_absent_name_as_null() {
        let json = serde_json::to_string(&AuthState::LoggedIn {
            email: "user@example.com".to_string(),
            name: None,
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"status":"LoggedIn","email":"user@example.com","name":null}"#
        );
    }

    #[test]
    fn auth_state_session_expired_serializes_with_status_tag() {
        let json = serde_json::to_string(&AuthState::SessionExpired).unwrap();
        assert_eq!(json, r#"{"status":"SessionExpired"}"#);
    }
}
