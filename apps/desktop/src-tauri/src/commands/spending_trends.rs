use std::sync::Mutex;

use tauri::State;

use crate::ai::{trends_insight, AiProvider, AiState};
use crate::db::spending_trends as spending_trends_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{SpendingTrendsData, TrendsInsightRequest, TrendsInsightResponse};

fn normalize_months(months: i32) -> i32 {
    match months {
        3 | 6 | 12 => months,
        n if n < 3 => 3,
        n if n <= 6 => 6,
        _ => 12,
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_spending_trends(
    state: State<DbState>,
    months: i32,
) -> Result<SpendingTrendsData, AppError> {
    let months = normalize_months(months);
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let by_category = spending_trends_db::get_monthly_spend_by_category(&conn, months)?;
    let totals = spending_trends_db::get_monthly_spend_totals(&conn, months)?;
    let targets = spending_trends_db::get_category_targets(&conn)?;
    let category_compare =
        spending_trends_db::compute_category_compare(&by_category, months, &targets);

    Ok(SpendingTrendsData {
        by_category,
        totals,
        category_compare,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn generate_trends_insight(
    ai_state: State<'_, Mutex<AiState>>,
    months: i32,
    window_label: String,
    locale: String,
    categories: Vec<crate::models::CategoryCompareRow>,
) -> Result<TrendsInsightResponse, AppError> {
    let request = TrendsInsightRequest {
        months,
        window_label,
        locale,
        categories,
    };

    let provider = {
        let ai = ai_state.lock().map_err(|_| AppError::Database {
            message: "AI state lock poisoned".to_string(),
        })?;
        match &ai.provider {
            None => return Err(AppError::NotConfigured),
            Some(AiProvider::Bedrock(client)) => {
                trends_insight::ProviderClient::Bedrock(client.clone())
            }
            Some(AiProvider::OpenAI(client)) => {
                trends_insight::ProviderClient::OpenAI(client.clone())
            }
        }
    };

    trends_insight::generate_trends_insight(&provider, request).await
}
