use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tracing::info;

use crate::budget::template_defaults::{self, SYSTEM_TEMPLATES};
use crate::db::budget_template as budget_template_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{
    ApplyBudgetTemplateResult, SystemBudgetTemplateDetail, SystemBudgetTemplateSummary,
    TemplateCategoryDetail, TemplateGroupDetail, TemplateTargetOverride,
};

#[derive(Serialize)]
pub struct BudgetTemplateExportResult {
    pub path: String,
}

/// Prompts for a template file and applies it. Returns `Ok(None)` when the user
/// cancels the dialog — a cancellation is not an error.
///
/// No `insert_audit_log` call belongs here: `import_budget_template_from_path`
/// funnels into the shared apply primitive, which writes exactly one audit row
/// per apply regardless of source. This is a deliberate, documented deviation
/// from `docs/project-context.md` §3 — adding a call here would double-count.
#[tauri::command(rename_all = "snake_case")]
pub async fn import_budget_template(
    app_handle: AppHandle,
) -> Result<Option<ApplyBudgetTemplateResult>, AppError> {
    // The dialog blocks, so it runs before the DbState mutex is ever acquired —
    // holding the lock across a dialog would freeze every other command for as
    // long as the file picker is open.
    let file_path = app_handle
        .dialog()
        .file()
        .add_filter("Nixus Budget Template", &["json"])
        .blocking_pick_file();

    let selected_path = match file_path {
        Some(p) => p.as_path().map(|p| p.to_path_buf()),
        None => return Ok(None), // User cancelled
    };

    let selected_path = match selected_path {
        Some(p) => p,
        None => return Ok(None),
    };

    let db_state = app_handle.state::<DbState>();
    let active = db_state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let result = budget_template_db::import_budget_template_from_path(&conn, &selected_path)?;

    info!(
        "Budget template imported: {} groups, {} categories, {} skipped",
        result.groups_created,
        result.categories_created,
        result.skipped_groups.len()
    );

    Ok(Some(result))
}

/// Renders the user's budget as an amount-stripped template document, then
/// prompts for a save location. Returns `Ok(None)` when the user cancels — a
/// cancellation is not an error.
///
/// No `insert_audit_log` call belongs here either: export mutates nothing, and
/// Decision 5 scopes the template audit row to *apply* only. `export_backup`,
/// which also writes user data to a file, sets the same precedent. This is a
/// deliberate, documented deviation from `docs/project-context.md` §3.
#[tauri::command(rename_all = "snake_case")]
pub async fn export_budget_template(
    app_handle: AppHandle,
) -> Result<Option<BudgetTemplateExportResult>, AppError> {
    // Unlike the import above, whether anything is exportable is knowable before
    // prompting, so the document is built first and no dialog is opened for a
    // budget we would only reject. The explicit scope is load-bearing: a guard
    // held across `blocking_save_file` would freeze every other command for as
    // long as the dialog stays open.
    let json = {
        let db_state = app_handle.state::<DbState>();
        let active = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
        budget_template_db::build_budget_template_export_json(&conn)?
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let default_name = budget_template_db::export_template_file_name(
        budget_template_db::DEFAULT_EXPORT_TEMPLATE_NAME,
        &today,
    );

    let file_path = app_handle
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Nixus Budget Template", &["json"])
        .blocking_save_file();

    let save_path = match file_path {
        Some(p) => p.as_path().map(|p| p.to_path_buf()),
        None => return Ok(None), // User cancelled
    };

    let save_path = match save_path {
        Some(p) => p,
        None => return Ok(None),
    };

    let save_path = budget_template_db::ensure_json_extension(save_path);

    std::fs::write(&save_path, json).map_err(|e| AppError::File {
        message: format!("Failed to write template file: {}", e),
    })?;

    let path_str = save_path.to_string_lossy().to_string();
    info!("Budget template exported to {}", path_str);

    Ok(Some(BudgetTemplateExportResult { path: path_str }))
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_system_templates() -> Result<Vec<SystemBudgetTemplateSummary>, AppError> {
    // Summary projection only: the epic forbids leaking target amounts into the
    // list response. Returns Result (never Err today) because project-context.md
    // §2 requires every command to be Result<T, AppError>, and a future template
    // source could fail.
    Ok(SYSTEM_TEMPLATES
        .iter()
        .map(|t| SystemBudgetTemplateSummary {
            id: t.id.as_deref().unwrap_or_default().to_string(),
            name: t.name.to_string(),
            description: t.description.as_deref().map(str::to_string),
        })
        .collect())
}

#[tauri::command(rename_all = "snake_case")]
pub fn apply_system_template(
    state: State<DbState>,
    template_id: String,
    overrides: Option<Vec<TemplateTargetOverride>>,
) -> Result<ApplyBudgetTemplateResult, AppError> {
    // Resolve before locking: an unknown id must not acquire the DB mutex.
    let template = match template_defaults::find_system_template(&template_id) {
        Some(t) => t,
        None => {
            tracing::warn!("Unknown system template id requested: {}", template_id);
            return Err(AppError::Validation {
                message: "That starter template is not available.".to_string(),
                field: Some("template_id".to_string()),
            });
        }
    };

    // Merged before locking for the same reason, and kept alive for the borrow below.
    let edited = match overrides.as_deref() {
        Some(entries) if !entries.is_empty() => {
            Some(template_defaults::merge_target_overrides(template, entries)?)
        }
        _ => None,
    };

    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    // No insert_audit_log here: db::budget_template's shared primitive writes
    // exactly one row per apply (source: "system"). Adding one here would double
    // it. Intentional deviation from project-context.md §3.
    budget_template_db::apply_system_budget_template(&conn, edited.as_ref().unwrap_or(template))
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_system_template_detail(
    template_id: String,
) -> Result<SystemBudgetTemplateDetail, AppError> {
    // An owned projection, not a borrowed serialization: SystemBudgetTemplate's
    // Cow<'static, _> fields exist so SYSTEM_TEMPLATES can be a `pub const`, and
    // handing that lifetime to a command return type is not worth the churn.
    let template = template_defaults::find_system_template(&template_id).ok_or_else(|| {
        tracing::warn!("Unknown system template detail requested: {}", template_id);
        AppError::Validation {
            message: "That starter template is not available.".to_string(),
            field: Some("template_id".to_string()),
        }
    })?;

    Ok(SystemBudgetTemplateDetail {
        id: template.id.as_deref().unwrap_or_default().to_string(),
        name: template.name.to_string(),
        description: template.description.as_deref().map(str::to_string),
        groups: template
            .groups
            .iter()
            .map(|group| TemplateGroupDetail {
                name: group.name.to_string(),
                categories: group
                    .categories
                    .iter()
                    .map(|category| TemplateCategoryDetail {
                        name: category.name.to_string(),
                        target_cents: category.target_cents,
                    })
                    .collect(),
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // AC #5's literal requirement: "for SYSTEM_TEMPLATES as shipped it returns
    // exactly one summary: { id: "canadian-starter", name: "Canadian Starter
    // Budget", description: Some(..) }". `SYSTEM_TEMPLATES` being a single-item
    // const only proves cardinality by construction; it says nothing about
    // whether the id/name/description mapping in this function is correct.
    #[test]
    fn list_system_templates_returns_exactly_one_canadian_starter_summary() {
        let summaries = list_system_templates().unwrap();

        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "canadian-starter");
        assert_eq!(summaries[0].name, "Canadian Starter Budget");
        assert!(summaries[0].description.is_some());
    }

    #[test]
    fn get_system_template_detail_returns_every_group_category_and_target() {
        let detail = get_system_template_detail("canadian-starter".to_string()).unwrap();

        assert_eq!(detail.id, "canadian-starter");
        assert_eq!(detail.name, "Canadian Starter Budget");
        assert!(detail.description.is_some());
        assert_eq!(detail.groups.len(), 4);

        let total: usize = detail.groups.iter().map(|g| g.categories.len()).sum();
        assert_eq!(total, 12);

        // The whole point of this command over list_system_templates: targets are present.
        for group in &detail.groups {
            for category in &group.categories {
                assert!(
                    matches!(category.target_cents, Some(n) if n > 0),
                    "{} / {} lost its pre-filled target in the projection",
                    group.name,
                    category.name
                );
            }
        }

        let housing = detail
            .groups
            .iter()
            .find(|g| g.name == "Housing")
            .expect("Housing is part of the shipped starter");
        let rent = housing
            .categories
            .iter()
            .find(|c| c.name == "Rent / Mortgage")
            .expect("Rent / Mortgage is part of Housing");
        assert_eq!(rent.target_cents, Some(180_000));
    }

    #[test]
    fn get_system_template_detail_preserves_authored_group_and_category_order() {
        let detail = get_system_template_detail("canadian-starter".to_string()).unwrap();

        let group_names: Vec<&str> = detail.groups.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(
            group_names,
            vec!["Housing", "Transportation", "Living", "Savings"]
        );

        let housing_categories: Vec<&str> = detail.groups[0]
            .categories
            .iter()
            .map(|c| c.name.as_str())
            .collect();
        assert_eq!(
            housing_categories,
            vec![
                "Rent / Mortgage",
                "Utilities (Hydro, Gas, Water)",
                "Home & Tenant Insurance"
            ]
        );
    }

    #[test]
    fn get_system_template_detail_rejects_an_unknown_id() {
        for id in ["", "nope", "CANADIAN-STARTER"] {
            let error = get_system_template_detail(id.to_string()).unwrap_err();

            assert!(
                matches!(
                    error,
                    AppError::Validation { ref field, .. } if field.as_deref() == Some("template_id")
                ),
                "{id:?} must be rejected with the same error shape as apply_system_template"
            );
        }
    }
}
