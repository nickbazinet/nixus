mod ai;
mod commands;
mod credentials;
mod db;
mod error;
mod financial_health;
mod maintenance;
mod models;

use db::{init_db, DbState};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tracing::info;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            // Ensure data directory exists before tracing tries to write logs
            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app data dir");

            // Set up tracing with file output
            let file_appender =
                tracing_appender::rolling::daily(&app_data_dir, "nkbaz-finance.log");
            tracing_subscriber::fmt()
                .with_writer(file_appender)
                .with_env_filter(EnvFilter::new("info"))
                .with_ansi(false)
                .init();

            // Initialize OS keychain store (must happen before any credential access)
            keyring::use_native_store(false)
                .expect("failed to initialize keychain store");

            // Initialize database
            let conn = init_db(&app_data_dir)
                .expect("failed to initialize database");

            info!("nkbaz-finance started, database initialized");

            // Initialize AI client synchronously using the db connection
            let ai_state = tauri::async_runtime::block_on(ai::init_ai_client(&conn));
            info!("AI client initialized");

            app.manage(DbState(Mutex::new(conn)));
            app.manage(Mutex::new(ai_state));

            let catalog_data_dir = app_data_dir.clone();
            maintenance::catalog::spawn_background_catalog_refresh(catalog_data_dir);

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<DbState>();
                let result = match state.0.lock() {
                    Ok(conn) => commands::recurring::apply_due_recurring_expenses(&conn),
                    Err(e) => {
                        tracing::error!("Failed to lock database for recurring apply: {}", e);
                        return;
                    }
                };

                match result {
                    Ok(created) => {
                        if created.is_empty() {
                            info!("Background recurring apply: no missing expenses");
                        } else {
                            info!(
                                "Background recurring apply: created {} expense(s)",
                                created.len()
                            );
                            let _ = app_handle.emit("recurring:applied", created.len());
                        }
                    }
                    Err(e) => tracing::error!("Background recurring apply failed: {}", e),
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_db_status,
            commands::budget::create_budget_group,
            commands::budget::get_budget_groups,
            commands::budget::create_budget_category,
            commands::budget::get_budget_categories,
            commands::budget::update_budget_group,
            commands::budget::update_budget_category,
            commands::budget::delete_budget_category,
            commands::budget::delete_budget_group,
            commands::budget::get_budget_status,
            commands::budget::get_all_budget_categories,
            commands::expense::create_expense,
            commands::expense::get_expenses,
            commands::expense::update_expense,
            commands::expense::delete_expense,
            commands::account::create_account,
            commands::account::get_accounts,
            commands::account::update_account_balance,
            commands::account::update_account,
            commands::account::delete_account,
            commands::asset::create_asset,
            commands::asset::get_assets,
            commands::asset::update_asset_value,
            commands::asset::update_asset,
            commands::asset::delete_asset,
            commands::dashboard::get_budget_summary,
            commands::dashboard::get_top_budget_categories,
            commands::dashboard::get_spending_breakdown,
            commands::net_worth::get_current_net_worth,
            commands::net_worth::get_recent_net_worth_snapshots,
            commands::net_worth::record_net_worth_snapshot,
            commands::net_worth::get_net_worth_history,
            commands::net_worth::get_net_worth_change,
            commands::import::validate_cc_file,
            commands::import::import_cc_statement,
            commands::import::confirm_import,
            commands::chat::send_chat_message,
            commands::chat::get_chat_messages,
            commands::chat::execute_chat_action,
            commands::chat::list_conversations,
            commands::onboarding::check_onboarding_status,
            commands::income::create_income_source,
            commands::income::get_income_sources,
            commands::income::update_income_source,
            commands::income::delete_income_source,
            commands::income::create_income_entry,
            commands::income::update_income_entry,
            commands::income::delete_income_entry,
            commands::income::get_income_entries,
            commands::income::get_income_entries_by_month,
            commands::income::get_income_total,
            commands::recurring::create_recurring_template,
            commands::recurring::get_recurring_templates,
            commands::recurring::update_recurring_template,
            commands::recurring::delete_recurring_template,
            commands::recurring::apply_recurring_expenses,
            commands::backup::export_backup,
            commands::backup::import_backup,
            commands::spending_trends::get_spending_trends,
            commands::yearly_summary::get_yearly_summary,
            commands::projection::get_projection_input,
            commands::settings::get_ai_config,
            commands::settings::save_aws_credentials,
            commands::settings::save_openai_credentials,
            commands::settings::clear_ai_credentials,
            commands::settings::test_ai_connection,
            commands::maintenance::get_maintenance_task_baselines,
            commands::maintenance::create_vehicle,
            commands::maintenance::get_vehicles,
            commands::maintenance::get_vehicle,
            commands::maintenance::update_vehicle,
            commands::maintenance::delete_vehicle,
            commands::maintenance::update_maintenance_task,
            commands::maintenance::add_maintenance_task,
            commands::maintenance::update_vehicle_odometer,
            commands::maintenance::log_maintenance_service,
            commands::maintenance::log_custom_service,
            commands::maintenance::get_service_history,
            commands::maintenance::get_maintenance_alert_summary,
            commands::maintenance::get_vehicle_catalog_status,
            commands::maintenance::get_vehicle_makes,
            commands::maintenance::get_vehicle_models,
            commands::financial_health::get_financial_health_summary,
            commands::financial_health::get_financial_health_detail,
            commands::financial_health::set_emergency_fund_target,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
