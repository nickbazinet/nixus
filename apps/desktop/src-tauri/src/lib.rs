mod ai;
mod budget;
mod commands;
mod credentials;
mod datasets;
mod db;
mod error;
mod financial_health;
mod json_store;
mod maintenance;
mod models;
mod profile_store;
mod projects;
mod tfsa;

use db::{init_db, DbState};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tracing::info;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance must precede deep-link so a Windows nixus:// launch is
    // forwarded into the running process instead of spawning a second window.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Log the argv count only: argv carries the callback URL, which contains
            // the single-use authorization code and the CSRF state.
            info!(
                "Second instance intercepted ({} argv entries); focusing main window",
                argv.len()
            );
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            let app_data_dir =
                datasets::global_root(&app_handle).expect("failed to resolve app data dir");

            // Ordering matters: must precede init_db so every command that later
            // resolves active_dataset_dir() succeeds.
            datasets::set_active_dataset_id(datasets::DEFAULT_DATASET_ID);

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

            // AD-4: the registry must exist, or hard-fail visibly, before any UI
            // renders. A corrupt file crashes here rather than being recreated,
            // which would orphan every non-default dataset it recorded.
            // Placed after the tracing subscriber is initialized above, so a
            // warning about a skipped registry entry actually reaches the log file.
            datasets::bootstrap_registry(&app_handle)
                .expect("dataset registry is corrupt or unreadable");

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
            app.manage(commands::auth::PendingLogin::default());
            app.manage(commands::auth_listener::LoopbackListener::default());

            let catalog_data_dir = app_data_dir.clone();
            maintenance::catalog::spawn_background_catalog_refresh(catalog_data_dir);

            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<DbState>();
                let (expense_result, income_result) = match state.0.lock() {
                    Ok(conn) => (
                        commands::recurring::apply_due_recurring_expenses(&conn),
                        commands::recurring_income::apply_due_recurring_income(&conn),
                    ),
                    Err(e) => {
                        tracing::error!("Failed to lock database for recurring apply: {}", e);
                        return;
                    }
                };

                match expense_result {
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

                match income_result {
                    Ok(created) => {
                        if created.is_empty() {
                            info!("Background recurring apply: no missing income");
                        } else {
                            info!(
                                "Background recurring apply: created {} income entry(ies)",
                                created.len()
                            );
                            let _ = app_handle.emit("recurring-income:applied", created.len());
                        }
                    }
                    Err(e) => {
                        tracing::error!("Background recurring income apply failed: {}", e)
                    }
                }
            });

            // Placed after the tracing subscriber is initialized above, so deep-link
            // log lines actually reach the log file.
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
                if let Err(e) = app.deep_link().register_all() {
                    tracing::warn!("Runtime deep link scheme registration failed: {}", e);
                }

                let deep_link_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        commands::auth::dispatch_deep_link_url(
                            &deep_link_handle,
                            url.as_str(),
                            "on_open_url",
                        );
                    }
                });

                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let cold_start_handle = app.handle().clone();
                    for url in urls {
                        commands::auth::dispatch_deep_link_url(
                            &cold_start_handle,
                            url.as_str(),
                            "cold_start",
                        );
                    }
                }
            }

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
            commands::budget_template::import_budget_template,
            commands::budget_template::export_budget_template,
            commands::budget_template::list_system_templates,
            commands::budget_template::get_system_template_detail,
            commands::budget_template::apply_system_template,
            commands::expense::create_expense,
            commands::expense::get_expenses,
            commands::expense::get_latest_expense,
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
            commands::import::save_import_clipboard_image,
            commands::import::import_cc_statement,
            commands::import::confirm_import,
            commands::chat::send_chat_message,
            commands::chat::get_chat_messages,
            commands::chat::execute_chat_action,
            commands::chat::list_conversations,
            commands::onboarding::check_onboarding_status,
            commands::onboarding::complete_onboarding,
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
            commands::recurring_income::create_recurring_income_template,
            commands::recurring_income::get_recurring_income_templates,
            commands::recurring_income::update_recurring_income_template,
            commands::recurring_income::delete_recurring_income_template,
            commands::backup::export_backup,
            commands::backup::import_backup,
            commands::danger_zone::delete_all_data,
            commands::spending_trends::get_spending_trends,
            commands::spending_trends::generate_trends_insight,
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
            commands::retirement::get_retirement_pension_cents,
            commands::retirement::set_retirement_pension_cents,
            commands::retirement::get_retirement_employer_pension_cents,
            commands::retirement::set_retirement_employer_pension_cents,
            commands::retirement::get_retirement_employer_pension_start_age,
            commands::retirement::set_retirement_employer_pension_start_age,
            commands::retirement::get_retirement_pension_tax_rate_percent,
            commands::retirement::set_retirement_pension_tax_rate_percent,
            commands::retirement::clear_retirement_pension_tax_rate_percent,
            commands::retirement::get_retirement_age_override,
            commands::retirement::set_retirement_age_override,
            commands::retirement::get_retirement_input,
            commands::auth::start_login,
            commands::auth::handle_auth_callback,
            commands::auth::get_auth_session,
            commands::auth::sign_out,
            commands::profile::get_user_profile,
            commands::profile::save_user_profile,
            commands::profile::get_countries,
            commands::profile::get_subdivisions,
            commands::profile::get_tfsa_accumulated_limit,
            commands::projects::create_project,
            commands::projects::update_project,
            commands::projects::reorder_projects,
            commands::projects::archive_project,
            commands::projects::get_projects,
            commands::projects::create_project_contribution,
            commands::projects::confirm_project_allocations,
            commands::projects::delete_project_contribution,
            commands::projects::get_project_contributions,
            commands::projects::get_project_saved_totals,
            commands::projects::get_account_earmark_breakdown,
            commands::projects::get_savings_projects_summary,
            commands::projects::get_suggested_allocation,
            commands::projects::get_project_pace,
            commands::projects::generate_project_advice,
            commands::projects::skip_suggested_allocation_for_month,
            commands::projects::clear_suggested_allocation_skip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
