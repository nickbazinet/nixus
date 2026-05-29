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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectionInput {
    pub account_balances: Vec<AccountBalanceByType>,
    pub asset_values: Vec<AssetValueByType>,
    pub avg_monthly_income_cents: i64,
    pub avg_monthly_expense_cents: i64,
    pub income_month_count: i64,
    pub expense_month_count: i64,
}
