use std::borrow::Cow;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::{audit as audit_db, budget as budget_db};
use crate::error::AppError;
use crate::models::{
    ApplyBudgetTemplateResult, CreateBudgetCategory, CreateBudgetGroup, SystemBudgetTemplate,
    TemplateCategoryDef, TemplateGroupDef,
};

/// Highest `format_version` this build understands. Bump only alongside a
/// backwards-compatible reader for every older version.
pub const SUPPORTED_TEMPLATE_FORMAT_VERSION: i32 = 1;

/// Maximum characters (not bytes) allowed in a template group/category name.
/// Template-import-only bound; `db/budget.rs` imposes no length limit of its own.
pub const MAX_TEMPLATE_NAME_LEN: usize = 100;

/// Maximum categories allowed across all groups of a single template.
pub const MAX_TEMPLATE_CATEGORIES: usize = 100;

/// Upper bound for a template-supplied `target_cents` (overflow/garbage guard).
pub const MAX_TEMPLATE_TARGET_CENTS: i64 = 100_000_000;

/// Target applied when a template category carries no amount (amount-stripped
/// user exports per FR96). `create_budget_category` rejects `target_cents <= 0`,
/// so an intentionally obvious `$1.00` placeholder is used instead of `0`.
pub const DEFAULT_TEMPLATE_TARGET_CENTS: i64 = 100;

/// Largest template file accepted from disk (1 MiB). 100 categories of realistic
/// JSON is roughly 8 KB, so this leaves ~100x headroom.
pub const MAX_TEMPLATE_FILE_BYTES: u64 = 1_048_576;

/// Name written into a user-exported template. Users cannot title an export
/// today; Decision 3's schema uses this exact placeholder for the export shape.
pub const DEFAULT_EXPORT_TEMPLATE_NAME: &str = "My Budget";

const MSG_INVALID_FILE: &str = "This file is not a valid Nixus budget template.";
const MSG_VERSION_TOO_NEW: &str =
    "This template was created with a newer version of Nixus. Please update the app.";
const MSG_NOTHING_TO_EXPORT: &str =
    "There is nothing to export yet. Create at least one budget category first.";
const MSG_EXPORT_NOT_PORTABLE: &str = "Your budget is too large to share as a template. \
    Templates support at most 100 categories, each with a name of 100 characters or less.";

fn invalid_file() -> AppError {
    AppError::File {
        message: MSG_INVALID_FILE.to_string(),
    }
}

fn validate_template_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_TEMPLATE_NAME_LEN {
        return Err(invalid_file());
    }
    Ok(())
}

/// Validates a template document in full. Runs before any DB write so that an
/// apply is either fully valid or fully rejected.
///
/// Every rejection **from this function** is `AppError::File` — template files
/// are untrusted input and the frontend surfaces the message verbatim. DB-layer
/// failures later in `apply_template_inner` (e.g. a valid-but-DB-rejected
/// `target_cents: 0`) propagate as `AppError::Database`/`AppError::Validation`
/// instead, via `?`.
fn validate_budget_template(template: &SystemBudgetTemplate) -> Result<(), AppError> {
    if template.format_version > SUPPORTED_TEMPLATE_FORMAT_VERSION {
        return Err(AppError::File {
            message: MSG_VERSION_TOO_NEW.to_string(),
        });
    }
    if template.format_version != SUPPORTED_TEMPLATE_FORMAT_VERSION {
        return Err(invalid_file());
    }

    if template.groups.is_empty() {
        return Err(invalid_file());
    }

    let mut total_categories: usize = 0;
    for group in template.groups.iter() {
        validate_template_name(&group.name)?;

        if group.categories.is_empty() {
            return Err(invalid_file());
        }

        for category in group.categories.iter() {
            validate_template_name(&category.name)?;

            if let Some(target_cents) = category.target_cents {
                if !(0..=MAX_TEMPLATE_TARGET_CENTS).contains(&target_cents) {
                    return Err(invalid_file());
                }
            }
        }

        total_categories += group.categories.len();
    }

    if total_categories > MAX_TEMPLATE_CATEGORIES {
        return Err(invalid_file());
    }

    Ok(())
}

// The audit write lives in the db layer instead of a command (a deliberate
// deviation from docs/project-context.md §3) because exactly one audit row must
// exist per apply regardless of source, and every source funnels through
// `apply_template_inner`.
fn write_apply_audit_log(
    conn: &Connection,
    template: &SystemBudgetTemplate,
    source: &str,
    result: &ApplyBudgetTemplateResult,
) {
    let summary = serde_json::json!({
        "groups": result.groups_created,
        "categories": result.categories_created,
        "source": source,
        "template_id": template.id.as_deref(),
    })
    .to_string();

    if let Err(e) = audit_db::insert_audit_log(
        conn,
        "budget_template",
        0,
        "apply",
        None,
        Some(summary.as_str()),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }
}

fn apply_template_inner(
    conn: &Connection,
    template: &SystemBudgetTemplate,
    source: &str,
) -> Result<ApplyBudgetTemplateResult, AppError> {
    validate_budget_template(template)?;

    let tx = conn.unchecked_transaction()?;

    // `budget_groups` has no UNIQUE constraint and `create_budget_group` does no
    // duplicate check, so collision detection is entirely ours.
    let mut taken_names: Vec<String> = budget_db::get_budget_groups(&tx)?
        .into_iter()
        .map(|group| group.name.trim().to_lowercase())
        .collect();

    let mut result = ApplyBudgetTemplateResult {
        groups_created: 0,
        categories_created: 0,
        skipped_groups: Vec::new(),
    };

    for group in template.groups.iter() {
        let group_name = group.name.trim();
        let collision_key = group_name.to_lowercase();

        if taken_names.contains(&collision_key) {
            result.skipped_groups.push(group_name.to_string());
            continue;
        }

        let created_group = budget_db::create_budget_group(
            &tx,
            &CreateBudgetGroup {
                name: group_name.to_string(),
            },
        )?;
        taken_names.push(collision_key);
        result.groups_created += 1;

        for category in group.categories.iter() {
            // Decision 4 accepts `target_cents: 0` as valid input, but
            // `create_budget_category` rejects `<= 0`. Normalize 0 exactly like
            // null so a legal file never surfaces a confusing
            // `AppError::Validation` from the DB layer on an import.
            let target_cents = category
                .target_cents
                .filter(|cents| *cents > 0)
                .unwrap_or(DEFAULT_TEMPLATE_TARGET_CENTS);

            budget_db::create_budget_category(
                &tx,
                &CreateBudgetCategory {
                    group_id: created_group.id,
                    name: category.name.trim().to_string(),
                    target_cents,
                },
            )?;
            result.categories_created += 1;
        }
    }

    tx.commit()?;

    write_apply_audit_log(conn, template, source, &result);

    Ok(result)
}

/// Applies a serialized template document (an untrusted file, or any future
/// remote fetch) to the user's budget in a single transaction.
///
/// Groups whose name already exists case-insensitively are skipped whole — the
/// group and all of its categories — and reported in
/// `ApplyBudgetTemplateResult::skipped_groups`. Counts reflect rows actually
/// inserted. On `Err` nothing is written.
pub fn apply_budget_template_json(
    conn: &Connection,
    json: &str,
) -> Result<ApplyBudgetTemplateResult, AppError> {
    let template = serde_json::from_str::<SystemBudgetTemplate>(json).map_err(|e| {
        tracing::debug!("Template JSON parse failed: {}", e);
        invalid_file()
    })?;

    apply_template_inner(conn, &template, "import")
}

/// Reads, size-guards, and applies an untrusted template file from disk.
///
/// Errors are deliberately opaque: a rejected file yields the canned
/// [`MSG_INVALID_FILE`] copy so an adversarial file cannot control user-visible
/// text. Only genuine IO faults surface OS detail.
pub fn import_budget_template_from_path(
    conn: &Connection,
    path: &Path,
) -> Result<ApplyBudgetTemplateResult, AppError> {
    let read_error = |e: std::io::Error| AppError::File {
        message: format!("Failed to read template file: {e}"),
    };

    // Community template files are untrusted, and `read_to_string` is unbounded:
    // a multi-gigabyte file would be fully buffered before the category cap could
    // ever apply. Check the size before reading a single byte.
    let metadata = std::fs::metadata(path).map_err(read_error)?;
    if metadata.len() > MAX_TEMPLATE_FILE_BYTES {
        return Err(invalid_file());
    }

    let contents = std::fs::read_to_string(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::InvalidData {
            invalid_file()
        } else {
            read_error(e)
        }
    })?;

    // serde_json does not skip a UTF-8 BOM, so a template saved by Windows
    // Notepad would otherwise be unimportable.
    let json = contents.trim_start_matches('\u{feff}');

    apply_budget_template_json(conn, json)
}

/// Applies an already-deserialized template (a compiled-in system starter) with
/// the same guarantees as [`apply_budget_template_json`], skipping the JSON
/// round-trip.
pub fn apply_system_budget_template(
    conn: &Connection,
    template: &SystemBudgetTemplate,
) -> Result<ApplyBudgetTemplateResult, AppError> {
    apply_template_inner(conn, template, "system")
}

/// Renders the user's live budget as a shareable template document.
///
/// Read-only: opens no transaction and writes no audit row. Decision 5 scopes
/// the template audit row to *apply* only, and `commands/backup.rs`'s export —
/// which also writes user data to a file — records nothing either.
///
/// Every `target_cents` is `None` **by construction** (FR96): the DB value is
/// never copied into the document, so the stored budgeted amount cannot reach
/// the file via this field. (A user's own group/category name is copied
/// through verbatim and may coincidentally contain digits or a `$` — that is
/// the user's own label, not a leaked stored amount, and is unaffected by
/// this guarantee.)
pub fn build_budget_template_export_json(conn: &Connection) -> Result<String, AppError> {
    let groups = budget_db::get_budget_groups(conn)?;
    let categories = budget_db::get_all_budget_categories(conn)?;

    let mut template_groups: Vec<TemplateGroupDef> = Vec::new();

    // `categories` already arrives ordered by (group_id, sort_order), so this
    // filter preserves per-group order without any sorting or grouping map.
    for group in &groups {
        let cats: Vec<TemplateCategoryDef> = categories
            .iter()
            .filter(|c| c.group_id == group.id)
            .map(|c| TemplateCategoryDef {
                name: Cow::Owned(c.name.trim().to_string()),
                // FR96: stripped by construction — `c.target_cents` is never read.
                target_cents: None,
            })
            .collect();

        // `budget_groups` has no soft delete, so a group whose only categories
        // were deleted still exists as a row. Emitting it would produce a file
        // our own importer rejects (`validate_budget_template` bans empty
        // `categories`), silently breaking the export -> re-import round trip.
        if cats.is_empty() {
            continue;
        }

        template_groups.push(TemplateGroupDef {
            name: Cow::Owned(group.name.trim().to_string()),
            categories: Cow::Owned(cats),
        });
    }

    if template_groups.is_empty() {
        return Err(AppError::File {
            message: MSG_NOTHING_TO_EXPORT.to_string(),
        });
    }

    let document = SystemBudgetTemplate {
        format_version: SUPPORTED_TEMPLATE_FORMAT_VERSION,
        id: None,
        name: Cow::Borrowed(DEFAULT_EXPORT_TEMPLATE_NAME),
        description: None,
        groups: Cow::Owned(template_groups),
    };

    // Self-check against our own importer so every file this writes is one this
    // app version can read back.
    if let Err(e) = validate_budget_template(&document) {
        // The validator's copy is written for someone importing a bad file; it
        // would read as nonsense to someone exporting their own budget.
        tracing::warn!("Budget is not exportable as a template: {}", e);
        return Err(AppError::File {
            message: MSG_EXPORT_NOT_PORTABLE.to_string(),
        });
    }

    serde_json::to_string_pretty(&document).map_err(|e| AppError::File {
        message: format!("Failed to serialize template: {}", e),
    })
}

/// Default filename offered by the save dialog. `today` is a parameter rather
/// than read from the clock so the format stays unit-testable.
pub fn export_template_file_name(name: &str, today: &str) -> String {
    format!(
        "budget-template-{}-{}.json",
        slugify_template_name(name),
        today
    )
}

fn slugify_template_name(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_sep = false;

    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_was_sep = false;
        } else if !last_was_sep {
            slug.push('-');
            last_was_sep = true;
        }
    }

    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "budget".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn ensure_json_extension(path: PathBuf) -> PathBuf {
    // Our own open dialog filters to *.json, so a template saved without that
    // extension could not be selected for re-import by this app.
    //
    // Checked as a string suffix rather than via `Path::extension()`: for a
    // dotfile-shaped name like ".json", `extension()` returns `None` (the whole
    // name is treated as the stem), which would otherwise double-append to
    // ".json.json".
    let is_json = path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.to_ascii_lowercase().ends_with(".json"));

    if is_json {
        path
    } else {
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(".json");
        path.with_file_name(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::budget::template_defaults::{
        find_system_template, merge_target_overrides, CANADIAN_STARTER_ID, SYSTEM_TEMPLATES,
    };
    use crate::models::{TemplateCategoryDef, TemplateGroupDef, TemplateTargetOverride};
    use rusqlite::Connection;
    use std::borrow::Cow;
    use tempfile::NamedTempFile;

    fn template_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE budget_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE budget_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL REFERENCES budget_groups(id),
                name TEXT NOT NULL,
                target_cents INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                deleted_at TEXT
            );
            CREATE TABLE audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .unwrap();
        conn
    }

    // Proves the `Cow`-based schema is const-constructible, so Story 25.1 can
    // declare `pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate]` unchanged.
    const SMOKE_CATEGORIES: &[TemplateCategoryDef] = &[
        TemplateCategoryDef {
            name: Cow::Borrowed("Rent"),
            target_cents: Some(120_000),
        },
        TemplateCategoryDef {
            name: Cow::Borrowed("Hydro"),
            target_cents: Some(9_000),
        },
    ];

    const SMOKE_GROUPS: &[TemplateGroupDef] = &[TemplateGroupDef {
        name: Cow::Borrowed("Housing"),
        categories: Cow::Borrowed(SMOKE_CATEGORIES),
    }];

    const SMOKE_TEMPLATE: SystemBudgetTemplate = SystemBudgetTemplate {
        format_version: SUPPORTED_TEMPLATE_FORMAT_VERSION,
        id: Some(Cow::Borrowed("smoke-starter")),
        name: Cow::Borrowed("Smoke Starter"),
        description: None,
        groups: Cow::Borrowed(SMOKE_GROUPS),
    };

    const VALID_IMPORT_JSON: &str = r#"{
        "format_version": 1,
        "id": null,
        "name": "Community Budget",
        "description": null,
        "groups": [
            {
                "name": "Housing",
                "categories": [
                    { "name": "Rent", "target_cents": null },
                    { "name": "Hydro" }
                ]
            },
            {
                "name": "Food",
                "categories": [{ "name": "Groceries", "target_cents": 50000 }]
            }
        ]
    }"#;

    fn row_count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    fn seed_group(conn: &Connection, name: &str) {
        conn.execute(
            "INSERT INTO budget_groups (name, sort_order) VALUES (?1, 0)",
            rusqlite::params![name],
        )
        .unwrap();
    }

    fn seed_budget_group(conn: &Connection, name: &str) -> i64 {
        budget_db::create_budget_group(
            conn,
            &CreateBudgetGroup {
                name: name.to_string(),
            },
        )
        .unwrap()
        .id
    }

    fn seed_budget_category(conn: &Connection, group_id: i64, name: &str, target_cents: i64) {
        budget_db::create_budget_category(
            conn,
            &CreateBudgetCategory {
                group_id,
                name: name.to_string(),
                target_cents,
            },
        )
        .unwrap();
    }

    // `db/budget.rs` bounds no name length, so an over-long name is legal in the
    // DB but illegal in a template — `create_budget_category` cannot produce it.
    fn seed_budget_category_raw(conn: &Connection, group_id: i64, name: &str) {
        conn.execute(
            "INSERT INTO budget_categories (group_id, name, target_cents, sort_order) VALUES (?1, ?2, 100, 0)",
            rusqlite::params![group_id, name],
        )
        .unwrap();
    }

    fn soft_delete_category(conn: &Connection, name: &str) {
        let updated = conn
            .execute(
                "UPDATE budget_categories SET deleted_at = datetime('now') WHERE name = ?1",
                rusqlite::params![name],
            )
            .unwrap();
        assert_eq!(updated, 1, "expected to soft-delete exactly one category");
    }

    fn export_doc(conn: &Connection) -> SystemBudgetTemplate {
        let json = build_budget_template_export_json(conn).unwrap();
        serde_json::from_str(&json).unwrap()
    }

    fn group_names(doc: &SystemBudgetTemplate) -> Vec<String> {
        doc.groups.iter().map(|g| g.name.to_string()).collect()
    }

    fn category_names(group: &TemplateGroupDef) -> Vec<String> {
        group.categories.iter().map(|c| c.name.to_string()).collect()
    }

    fn expect_file_error<T: std::fmt::Debug>(result: Result<T, AppError>, expected: &str) {
        match result.unwrap_err() {
            AppError::File { message } => assert_eq!(message, expected),
            other => panic!("expected AppError::File, got {other:?}"),
        }
    }

    fn write_template_file(contents: &str) -> NamedTempFile {
        write_template_bytes(contents.as_bytes())
    }

    fn write_template_bytes(contents: &[u8]) -> NamedTempFile {
        use std::io::Write;
        let mut f = NamedTempFile::new().unwrap();
        f.write_all(contents).unwrap();
        f.flush().unwrap();
        f
    }

    fn import_file(conn: &Connection, contents: &str) -> Result<ApplyBudgetTemplateResult, AppError> {
        let file = write_template_file(contents);
        import_budget_template_from_path(conn, file.path())
    }

    // Every rejection path must leave the database untouched — validation, not
    // rollback, is the guarantee (Decision 4).
    fn assert_no_rows(conn: &Connection) {
        for table in ["budget_groups", "budget_categories", "audit_log"] {
            assert_eq!(row_count(conn, table), 0, "{table} should be empty");
        }
    }

    fn doc_with_format_version(raw: &str) -> String {
        format!(
            r#"{{"format_version":{raw},"name":"X","groups":[{{"name":"G","categories":[{{"name":"C"}}]}}]}}"#
        )
    }

    fn doc_with_target(raw: &str) -> String {
        format!(
            r#"{{"format_version":1,"name":"X","groups":[{{"name":"G","categories":[{{"name":"C","target_cents":{raw}}}]}}]}}"#
        )
    }

    fn doc_with_group_name(name: &str) -> String {
        format!(
            r#"{{"format_version":1,"name":"X","groups":[{{"name":"{name}","categories":[{{"name":"C"}}]}}]}}"#
        )
    }

    fn doc_with_category_name(name: &str) -> String {
        format!(
            r#"{{"format_version":1,"name":"X","groups":[{{"name":"G","categories":[{{"name":"{name}"}}]}}]}}"#
        )
    }

    fn doc_with_category_counts(counts: &[usize]) -> String {
        let groups: Vec<String> = counts
            .iter()
            .enumerate()
            .map(|(g, n)| {
                let cats: Vec<String> = (0..*n)
                    .map(|c| format!(r#"{{"name":"G{g}C{c}"}}"#))
                    .collect();
                format!(
                    r#"{{"name":"Group{g}","categories":[{}]}}"#,
                    cats.join(",")
                )
            })
            .collect();
        format!(
            r#"{{"format_version":1,"name":"X","groups":[{}]}}"#,
            groups.join(",")
        )
    }

    #[test]
    fn const_template_is_constructible_and_valid() {
        assert_eq!(SMOKE_TEMPLATE.format_version, 1);
        assert_eq!(SMOKE_TEMPLATE.id.as_deref(), Some("smoke-starter"));
        assert_eq!(SMOKE_TEMPLATE.name, "Smoke Starter");
        assert!(SMOKE_TEMPLATE.description.is_none());
        assert_eq!(SMOKE_TEMPLATE.groups.len(), 1);
        assert_eq!(SMOKE_TEMPLATE.groups[0].categories.len(), 2);
        validate_budget_template(&SMOKE_TEMPLATE).unwrap();
    }

    #[test]
    fn apply_system_template_creates_groups_and_categories() {
        let conn = template_test_db();

        let result = apply_system_budget_template(&conn, &SMOKE_TEMPLATE).unwrap();

        assert_eq!(result.groups_created, 1);
        assert_eq!(result.categories_created, 2);
        assert!(result.skipped_groups.is_empty());
        assert_eq!(row_count(&conn, "budget_groups"), 1);
        assert_eq!(row_count(&conn, "budget_categories"), 2);

        // Array order is preserved through the derived sort_order.
        let ordered: Vec<String> = conn
            .prepare("SELECT name FROM budget_categories ORDER BY sort_order")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap();
        assert_eq!(ordered, vec!["Rent".to_string(), "Hydro".to_string()]);

        let new_value: String = conn
            .query_row("SELECT new_value FROM audit_log", [], |row| row.get(0))
            .unwrap();
        assert!(new_value.contains("\"source\":\"system\""));
        assert!(new_value.contains("\"template_id\":\"smoke-starter\""));
    }

    // Guardrail for every current and future entry of SYSTEM_TEMPLATES: the
    // validator is private to this module, so this is the only place a compiled
    // const can be proven acceptable to the same rules an imported file faces.
    #[test]
    fn system_templates_all_pass_validation() {
        for template in SYSTEM_TEMPLATES.iter() {
            assert!(
                validate_budget_template(template).is_ok(),
                "system template {:?} does not satisfy validate_budget_template",
                template.id
            );
        }
    }

    #[test]
    fn merged_starter_persists_the_edited_target_and_nothing_else() {
        let conn = template_test_db();
        let template = find_system_template(CANADIAN_STARTER_ID).unwrap();
        let merged = merge_target_overrides(
            template,
            &[TemplateTargetOverride {
                group_name: "housing".to_string(),
                category_name: "rent / mortgage".to_string(),
                target_cents: 275_000,
            }],
        )
        .unwrap();

        let result = apply_system_budget_template(&conn, &merged).unwrap();

        assert_eq!(result.groups_created, 4);
        assert_eq!(result.categories_created, 12);
        assert!(result.skipped_groups.is_empty());

        let stored = |name: &str| -> i64 {
            conn.query_row(
                "SELECT target_cents FROM budget_categories WHERE name = ?1",
                rusqlite::params![name],
                |row| row.get(0),
            )
            .unwrap()
        };

        assert_eq!(stored("Rent / Mortgage"), 275_000);
        assert_eq!(stored("Utilities (Hydro, Gas, Water)"), 20_000);
        assert_eq!(stored("Groceries"), 60_000);

        // An edited apply is still one system apply: the audit row must not shift
        // source or template_id just because targets were customized.
        let new_value: String = conn
            .query_row("SELECT new_value FROM audit_log", [], |row| row.get(0))
            .unwrap();
        assert!(new_value.contains("\"source\":\"system\""));
        assert!(new_value.contains("\"template_id\":\"canadian-starter\""));
        assert_eq!(row_count(&conn, "audit_log"), 1);
    }

    #[test]
    fn canadian_starter_applies_to_empty_budget() {
        let conn = template_test_db();
        let template = find_system_template(CANADIAN_STARTER_ID).unwrap();

        let result = apply_system_budget_template(&conn, template).unwrap();

        assert_eq!(result.groups_created, 4);
        assert_eq!(result.categories_created, 12);
        assert!(result.skipped_groups.is_empty());

        let expected: Vec<(String, i64)> = template
            .groups
            .iter()
            .flat_map(|group| group.categories.iter())
            .map(|category| {
                (
                    category.name.to_string(),
                    category
                        .target_cents
                        .expect("every starter target is pre-filled"),
                )
            })
            .collect();

        let stored: Vec<(String, i64)> = conn
            .prepare("SELECT name, target_cents FROM budget_categories ORDER BY id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<(String, i64)>, _>>()
            .unwrap();

        assert_eq!(stored, expected);

        // No target may have been substituted by the `$1.00` placeholder — that
        // fallback only fires for a `None`/`0` amount, which a system template
        // never carries.
        for (name, target_cents) in &stored {
            assert_ne!(
                *target_cents, DEFAULT_TEMPLATE_TARGET_CENTS,
                "{name} fell back to DEFAULT_TEMPLATE_TARGET_CENTS"
            );
        }
    }

    #[test]
    fn canadian_starter_writes_one_system_audit_row() {
        let conn = template_test_db();
        let template = find_system_template(CANADIAN_STARTER_ID).unwrap();

        apply_system_budget_template(&conn, template).unwrap();

        let (entity_type, entity_id, action, new_value): (String, i64, String, String) = conn
            .query_row(
                "SELECT entity_type, entity_id, action, new_value FROM audit_log",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        assert_eq!(row_count(&conn, "audit_log"), 1);
        assert_eq!(entity_type, "budget_template");
        assert_eq!(action, "apply");
        assert_eq!(entity_id, 0);
        assert!(new_value.contains("\"source\":\"system\""));
        assert!(new_value.contains("\"template_id\":\"canadian-starter\""));
    }

    #[test]
    fn import_valid_file_uses_default_target_for_missing_amounts() {
        let conn = template_test_db();

        let result = apply_budget_template_json(&conn, VALID_IMPORT_JSON).unwrap();

        assert_eq!(result.groups_created, 2);
        assert_eq!(result.categories_created, 3);
        assert!(result.skipped_groups.is_empty());

        let targets: Vec<(String, i64)> = conn
            .prepare("SELECT name, target_cents FROM budget_categories ORDER BY id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<(String, i64)>, _>>()
            .unwrap();
        assert_eq!(
            targets,
            vec![
                ("Rent".to_string(), DEFAULT_TEMPLATE_TARGET_CENTS),
                ("Hydro".to_string(), DEFAULT_TEMPLATE_TARGET_CENTS),
                ("Groceries".to_string(), 50_000),
            ]
        );
    }

    #[test]
    fn import_invalid_version_is_rejected_before_any_write() {
        let conn = template_test_db();

        let too_new = r#"{"format_version":99,"name":"X","groups":[{"name":"G","categories":[{"name":"C","target_cents":100}]}]}"#;
        expect_file_error(
            apply_budget_template_json(&conn, too_new),
            MSG_VERSION_TOO_NEW,
        );

        let zero = r#"{"format_version":0,"name":"X","groups":[{"name":"G","categories":[{"name":"C","target_cents":100}]}]}"#;
        expect_file_error(apply_budget_template_json(&conn, zero), MSG_INVALID_FILE);

        let negative = r#"{"format_version":-1,"name":"X","groups":[{"name":"G","categories":[{"name":"C","target_cents":100}]}]}"#;
        expect_file_error(apply_budget_template_json(&conn, negative), MSG_INVALID_FILE);

        // `format_version` has no serde default — a missing field must fail.
        let missing_version =
            r#"{"name":"X","groups":[{"name":"G","categories":[{"name":"C"}]}]}"#;
        expect_file_error(
            apply_budget_template_json(&conn, missing_version),
            MSG_INVALID_FILE,
        );

        expect_file_error(apply_budget_template_json(&conn, "{"), MSG_INVALID_FILE);
        expect_file_error(
            apply_budget_template_json(&conn, "not json at all"),
            MSG_INVALID_FILE,
        );

        assert_eq!(row_count(&conn, "budget_groups"), 0);
        assert_eq!(row_count(&conn, "budget_categories"), 0);
        assert_eq!(row_count(&conn, "audit_log"), 0);
    }

    #[test]
    fn validate_rejects_structural_and_bounds_violations() {
        let conn = template_test_db();

        let cases = [
            r#"{"format_version":1,"name":"X","groups":[]}"#,
            r#"{"format_version":1,"name":"X","groups":[{"name":"G","categories":[]}]}"#,
            r#"{"format_version":1,"name":"X","groups":[{"name":"   ","categories":[{"name":"C"}]}]}"#,
            r#"{"format_version":1,"name":"X","groups":[{"name":"G","categories":[{"name":"  "}]}]}"#,
            r#"{"format_version":1,"name":"X","groups":[{"name":"G","categories":[{"name":"C","target_cents":-1}]}]}"#,
            r#"{"format_version":1,"name":"X","groups":[{"name":"G","categories":[{"name":"C","target_cents":100000001}]}]}"#,
        ];
        for case in cases {
            expect_file_error(apply_budget_template_json(&conn, case), MSG_INVALID_FILE);
        }

        let long_name = "n".repeat(MAX_TEMPLATE_NAME_LEN + 1);
        let long_group = format!(
            r#"{{"format_version":1,"name":"X","groups":[{{"name":"{long_name}","categories":[{{"name":"C"}}]}}]}}"#
        );
        expect_file_error(
            apply_budget_template_json(&conn, &long_group),
            MSG_INVALID_FILE,
        );
        let long_category = format!(
            r#"{{"format_version":1,"name":"X","groups":[{{"name":"G","categories":[{{"name":"{long_name}"}}]}}]}}"#
        );
        expect_file_error(
            apply_budget_template_json(&conn, &long_category),
            MSG_INVALID_FILE,
        );

        let too_many: Vec<String> = (0..=MAX_TEMPLATE_CATEGORIES)
            .map(|i| format!(r#"{{"name":"C{i}"}}"#))
            .collect();
        let over_cap = format!(
            r#"{{"format_version":1,"name":"X","groups":[{{"name":"G","categories":[{}]}}]}}"#,
            too_many.join(",")
        );
        expect_file_error(
            apply_budget_template_json(&conn, &over_cap),
            MSG_INVALID_FILE,
        );

        let at_cap: Vec<String> = (0..MAX_TEMPLATE_CATEGORIES)
            .map(|i| format!(r#"{{"name":"C{i}"}}"#))
            .collect();
        let boundary = format!(
            r#"{{"format_version":1,"name":"X","groups":[{{"name":"G","categories":[{}]}}]}}"#,
            at_cap.join(",")
        );
        let result = apply_budget_template_json(&conn, &boundary).unwrap();
        assert_eq!(result.categories_created, MAX_TEMPLATE_CATEGORIES as i32);
    }

    #[test]
    fn duplicate_group_skip_excludes_its_categories() {
        let conn = template_test_db();
        seed_group(&conn, "Needs");

        let json = r#"{
            "format_version": 1,
            "name": "X",
            "groups": [
                { "name": "  needs  ", "categories": [{ "name": "Should Not Exist" }] },
                { "name": "Wants", "categories": [{ "name": "Dining Out", "target_cents": 20000 }] }
            ]
        }"#;

        let result = apply_budget_template_json(&conn, json).unwrap();

        assert_eq!(result.groups_created, 1);
        assert_eq!(result.categories_created, 1);
        assert_eq!(result.skipped_groups, vec!["needs".to_string()]);
        assert_eq!(row_count(&conn, "budget_groups"), 2);
        assert_eq!(row_count(&conn, "budget_categories"), 1);

        let skipped_category_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM budget_categories WHERE name = 'Should Not Exist'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(skipped_category_count, 0);
    }

    #[test]
    fn duplicate_group_within_template_skips_the_second() {
        let conn = template_test_db();

        let json = r#"{
            "format_version": 1,
            "name": "X",
            "groups": [
                { "name": "Housing", "categories": [{ "name": "Rent" }] },
                { "name": "HOUSING", "categories": [{ "name": "Mortgage" }] }
            ]
        }"#;

        let result = apply_budget_template_json(&conn, json).unwrap();

        assert_eq!(result.groups_created, 1);
        assert_eq!(result.categories_created, 1);
        assert_eq!(result.skipped_groups, vec!["HOUSING".to_string()]);
        assert_eq!(row_count(&conn, "budget_categories"), 1);
    }

    #[test]
    fn rollback_leaves_no_rows() {
        let conn = template_test_db();

        // Validation failure: nothing is written at all.
        let invalid = r#"{"format_version":1,"name":"X","groups":[{"name":"Housing","categories":[{"name":"   "}]}]}"#;
        expect_file_error(apply_budget_template_json(&conn, invalid), MSG_INVALID_FILE);
        assert_eq!(row_count(&conn, "budget_groups"), 0);
        assert_eq!(row_count(&conn, "budget_categories"), 0);

        // Mid-apply DB failure: `target_cents: 0` is no longer a usable trigger
        // (Story 24.2 normalizes it to the default), and no template-valid input
        // can make `create_budget_category` fail any more — so the rollback
        // backstop is proven by injecting a constraint the real schema lacks.
        // Duplicate category names within one group are template-valid, so the
        // second insert fails after the group and first category are already in.
        conn.execute_batch(
            "CREATE UNIQUE INDEX idx_test_unique_category ON budget_categories(group_id, name);",
        )
        .unwrap();

        let mid_failure = r#"{
            "format_version": 1,
            "name": "X",
            "groups": [
                {
                    "name": "Housing",
                    "categories": [
                        { "name": "Rent", "target_cents": 120000 },
                        { "name": "Rent", "target_cents": 130000 }
                    ]
                }
            ]
        }"#;
        match apply_budget_template_json(&conn, mid_failure).unwrap_err() {
            AppError::Database { message } => {
                assert!(
                    message.contains("UNIQUE constraint failed"),
                    "unexpected message: {message}"
                );
            }
            other => panic!("expected AppError::Database, got {other:?}"),
        }
        assert_eq!(row_count(&conn, "budget_groups"), 0);
        assert_eq!(row_count(&conn, "budget_categories"), 0);
        assert_eq!(row_count(&conn, "audit_log"), 0);
    }

    #[test]
    fn audit_row_written_once_per_apply() {
        let conn = template_test_db();

        apply_budget_template_json(&conn, VALID_IMPORT_JSON).unwrap();

        let (entity_type, entity_id, action, old_value, new_value): (
            String,
            i64,
            String,
            Option<String>,
            String,
        ) = conn
            .query_row(
                "SELECT entity_type, entity_id, action, old_value, new_value FROM audit_log",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();

        assert_eq!(row_count(&conn, "audit_log"), 1);
        assert_eq!(entity_type, "budget_template");
        assert_eq!(entity_id, 0);
        assert_eq!(action, "apply");
        assert!(old_value.is_none());
        assert!(new_value.contains("\"source\":\"import\""));
        assert!(new_value.contains("\"groups\":2"));
        assert!(new_value.contains("\"categories\":3"));
        assert!(new_value.contains("\"template_id\":null"));
    }

    #[test]
    fn all_groups_skipped_still_succeeds_and_audits() {
        let conn = template_test_db();
        seed_group(&conn, "Needs");
        seed_group(&conn, "Wants");

        let json = r#"{
            "format_version": 1,
            "name": "X",
            "groups": [
                { "name": "needs", "categories": [{ "name": "Rent" }] },
                { "name": "WANTS", "categories": [{ "name": "Dining Out" }] }
            ]
        }"#;

        let result = apply_budget_template_json(&conn, json).unwrap();

        assert_eq!(result.groups_created, 0);
        assert_eq!(result.categories_created, 0);
        assert_eq!(
            result.skipped_groups,
            vec!["needs".to_string(), "WANTS".to_string()]
        );
        assert_eq!(row_count(&conn, "budget_groups"), 2);
        assert_eq!(row_count(&conn, "budget_categories"), 0);

        let new_value: String = conn
            .query_row("SELECT new_value FROM audit_log", [], |row| row.get(0))
            .unwrap();
        assert_eq!(row_count(&conn, "audit_log"), 1);
        assert!(new_value.contains("\"groups\":0"));
        assert!(new_value.contains("\"categories\":0"));
    }

    #[test]
    fn import_file_too_large() {
        let conn = template_test_db();
        let oversized = "x".repeat(MAX_TEMPLATE_FILE_BYTES as usize + 1);
        let file = write_template_file(&oversized);

        expect_file_error(
            import_budget_template_from_path(&conn, file.path()),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_at_size_limit_is_read() {
        let conn = template_test_db();
        // Exactly at the cap: the guard must not fire, so the failure that
        // surfaces comes from the parser, proving the file was read.
        let padding = " ".repeat(MAX_TEMPLATE_FILE_BYTES as usize - 1);
        let file = write_template_file(&format!("{{{padding}"));

        expect_file_error(
            import_budget_template_from_path(&conn, file.path()),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_not_utf8() {
        let conn = template_test_db();
        let file = write_template_bytes(&[0xFF, 0xFE, 0x00]);

        expect_file_error(
            import_budget_template_from_path(&conn, file.path()),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_missing_path() {
        let conn = template_test_db();
        let missing = std::env::temp_dir().join("nixus-no-such-template-file-24-2.json");

        match import_budget_template_from_path(&conn, &missing).unwrap_err() {
            AppError::File { message } => {
                assert!(
                    message.contains("Failed to read template file"),
                    "unexpected message: {message}"
                );
                assert_ne!(message, MSG_INVALID_FILE);
            }
            other => panic!("expected AppError::File, got {other:?}"),
        }
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_with_bom_ok() {
        let conn = template_test_db();
        let file = write_template_file(&format!("\u{feff}{VALID_IMPORT_JSON}"));

        let result = import_budget_template_from_path(&conn, file.path()).unwrap();

        assert_eq!(result.groups_created, 2);
        assert_eq!(result.categories_created, 3);
        assert_eq!(row_count(&conn, "budget_categories"), 3);
    }

    #[test]
    fn import_file_valid_writes_one_audit_row() {
        let conn = template_test_db();

        let result = import_file(&conn, VALID_IMPORT_JSON).unwrap();

        assert_eq!(result.groups_created, 2);
        assert_eq!(result.categories_created, 3);
        assert!(result.skipped_groups.is_empty());

        let (entity_type, entity_id, action, new_value): (String, i64, String, String) = conn
            .query_row(
                "SELECT entity_type, entity_id, action, new_value FROM audit_log",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        assert_eq!(row_count(&conn, "audit_log"), 1);
        assert_eq!(entity_type, "budget_template");
        assert_eq!(entity_id, 0);
        assert_eq!(action, "apply");
        assert!(new_value.contains("\"source\":\"import\""));
    }

    #[test]
    fn import_file_zero_target_uses_default() {
        let conn = template_test_db();
        let json = r#"{
            "format_version": 1,
            "name": "X",
            "groups": [
                {
                    "name": "Housing",
                    "categories": [
                        { "name": "Rent", "target_cents": 0 },
                        { "name": "Hydro", "target_cents": 120000 }
                    ]
                }
            ]
        }"#;

        let result = import_file(&conn, json).unwrap();

        assert_eq!(result.categories_created, 2);

        let targets: Vec<(String, i64)> = conn
            .prepare("SELECT name, target_cents FROM budget_categories ORDER BY id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<(String, i64)>, _>>()
            .unwrap();
        assert_eq!(
            targets,
            vec![
                ("Rent".to_string(), DEFAULT_TEMPLATE_TARGET_CENTS),
                ("Hydro".to_string(), 120_000),
            ]
        );
    }

    #[test]
    fn import_file_malformed_json() {
        let conn = template_test_db();
        expect_file_error(import_file(&conn, "{ not json"), MSG_INVALID_FILE);
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_empty() {
        let conn = template_test_db();
        expect_file_error(import_file(&conn, ""), MSG_INVALID_FILE);
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_missing_format_version() {
        let conn = template_test_db();
        let json = r#"{"name":"X","groups":[{"name":"G","categories":[{"name":"C"}]}]}"#;
        expect_file_error(import_file(&conn, json), MSG_INVALID_FILE);
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_format_version_zero() {
        let conn = template_test_db();
        expect_file_error(
            import_file(&conn, &doc_with_format_version("0")),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_format_version_negative() {
        let conn = template_test_db();
        expect_file_error(
            import_file(&conn, &doc_with_format_version("-1")),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_format_version_too_new() {
        let conn = template_test_db();
        for version in ["2", "99"] {
            expect_file_error(
                import_file(&conn, &doc_with_format_version(version)),
                MSG_VERSION_TOO_NEW,
            );
        }
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_format_version_not_integer() {
        let conn = template_test_db();
        for version in ["\"1\"", "1.5"] {
            expect_file_error(
                import_file(&conn, &doc_with_format_version(version)),
                MSG_INVALID_FILE,
            );
        }
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_blank_group_name() {
        let conn = template_test_db();
        expect_file_error(
            import_file(&conn, &doc_with_group_name("   ")),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_blank_category_name() {
        let conn = template_test_db();
        expect_file_error(
            import_file(&conn, &doc_with_category_name("")),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_group_name_too_long() {
        let conn = template_test_db();
        let name = "n".repeat(MAX_TEMPLATE_NAME_LEN + 1);
        expect_file_error(
            import_file(&conn, &doc_with_group_name(&name)),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_category_name_too_long() {
        let conn = template_test_db();
        let name = "n".repeat(MAX_TEMPLATE_NAME_LEN + 1);
        expect_file_error(
            import_file(&conn, &doc_with_category_name(&name)),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_name_100_multibyte_chars_ok() {
        let conn = template_test_db();
        // 100 chars but 200 UTF-8 bytes — proves the bound counts characters.
        let name = "é".repeat(MAX_TEMPLATE_NAME_LEN);
        assert!(name.len() > MAX_TEMPLATE_NAME_LEN);

        let result = import_file(&conn, &doc_with_category_name(&name)).unwrap();

        assert_eq!(result.categories_created, 1);
        let stored: String = conn
            .query_row("SELECT name FROM budget_categories", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, name);
    }

    #[test]
    fn import_file_negative_target() {
        let conn = template_test_db();
        expect_file_error(import_file(&conn, &doc_with_target("-1")), MSG_INVALID_FILE);
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_target_above_max() {
        let conn = template_test_db();
        expect_file_error(
            import_file(&conn, &doc_with_target("100000001")),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_target_at_max_ok() {
        let conn = template_test_db();

        let result = import_file(&conn, &doc_with_target("100000000")).unwrap();

        assert_eq!(result.categories_created, 1);
        let stored: i64 = conn
            .query_row("SELECT target_cents FROM budget_categories", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, MAX_TEMPLATE_TARGET_CENTS);
    }

    #[test]
    fn import_file_target_exceeds_i64() {
        let conn = template_test_db();
        expect_file_error(
            import_file(&conn, &doc_with_target("99999999999999999999")),
            MSG_INVALID_FILE,
        );
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_empty_groups() {
        let conn = template_test_db();
        let json = r#"{"format_version":1,"name":"X","groups":[]}"#;
        expect_file_error(import_file(&conn, json), MSG_INVALID_FILE);
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_group_with_no_categories() {
        let conn = template_test_db();
        let json = r#"{"format_version":1,"name":"X","groups":[{"name":"G","categories":[]}]}"#;
        expect_file_error(import_file(&conn, json), MSG_INVALID_FILE);
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_over_category_cap() {
        let conn = template_test_db();
        let json = doc_with_category_counts(&[50, 51]);
        expect_file_error(import_file(&conn, &json), MSG_INVALID_FILE);
        assert_no_rows(&conn);
    }

    #[test]
    fn import_file_at_category_cap_ok() {
        let conn = template_test_db();
        let json = doc_with_category_counts(&[50, 50]);

        let result = import_file(&conn, &json).unwrap();

        assert_eq!(result.groups_created, 2);
        assert_eq!(result.categories_created, MAX_TEMPLATE_CATEGORIES as i32);
        assert_eq!(
            row_count(&conn, "budget_categories"),
            MAX_TEMPLATE_CATEGORIES as i64
        );
    }

    #[test]
    fn export_json_strips_all_amounts() {
        let conn = template_test_db();
        let housing = seed_budget_group(&conn, "Housing");
        seed_budget_category(&conn, housing, "Rent", 123_456);
        let food = seed_budget_group(&conn, "Food");
        seed_budget_category(&conn, food, "Groceries", 987_654);

        let json = build_budget_template_export_json(&conn).unwrap();
        let doc: SystemBudgetTemplate = serde_json::from_str(&json).unwrap();

        for group in doc.groups.iter() {
            for category in group.categories.iter() {
                assert!(
                    category.target_cents.is_none(),
                    "{} leaked an amount",
                    category.name
                );
            }
        }
        assert!(!json.contains("123456"), "raw amount leaked into {json}");
        assert!(!json.contains("987654"), "raw amount leaked into {json}");
        // Present-and-null, not omitted: guards against a future
        // `skip_serializing_if` on the shared schema hiding a real value.
        assert!(json.contains("\"target_cents\": null"), "unexpected: {json}");
        assert!(!json.contains("\"target_cents\": 1"), "unexpected: {json}");
    }

    #[test]
    fn export_json_header_fields() {
        let conn = template_test_db();
        let group = seed_budget_group(&conn, "Housing");
        seed_budget_category(&conn, group, "Rent", 120_000);

        let doc = export_doc(&conn);

        assert_eq!(doc.format_version, SUPPORTED_TEMPLATE_FORMAT_VERSION);
        assert!(doc.id.is_none());
        assert!(doc.description.is_none());
        assert_eq!(&*doc.name, DEFAULT_EXPORT_TEMPLATE_NAME);
    }

    #[test]
    fn export_json_round_trips_through_apply() {
        let source = template_test_db();
        let housing = seed_budget_group(&source, "Housing");
        seed_budget_category(&source, housing, "Rent", 120_000);
        seed_budget_category(&source, housing, "Hydro", 9_000);
        let food = seed_budget_group(&source, "Food");
        seed_budget_category(&source, food, "Groceries", 50_000);
        seed_budget_category(&source, food, "Dining Out", 20_000);

        let json = build_budget_template_export_json(&source).unwrap();

        let target = template_test_db();
        let result = apply_budget_template_json(&target, &json).unwrap();

        assert_eq!(result.groups_created, 2);
        assert_eq!(result.categories_created, 4);
        assert!(result.skipped_groups.is_empty());
    }

    #[test]
    fn export_preserves_group_and_category_order() {
        let conn = template_test_db();
        for group_name in ["Housing", "Food", "Transport"] {
            let group = seed_budget_group(&conn, group_name);
            seed_budget_category(&conn, group, &format!("{group_name} First"), 1_000);
            seed_budget_category(&conn, group, &format!("{group_name} Second"), 2_000);
        }

        let doc = export_doc(&conn);

        assert_eq!(group_names(&doc), vec!["Housing", "Food", "Transport"]);
        for group in doc.groups.iter() {
            assert_eq!(
                category_names(group),
                vec![
                    format!("{} First", group.name),
                    format!("{} Second", group.name)
                ]
            );
        }
    }

    #[test]
    fn export_excludes_soft_deleted_categories() {
        let conn = template_test_db();
        let group = seed_budget_group(&conn, "Housing");
        seed_budget_category(&conn, group, "Rent", 120_000);
        seed_budget_category(&conn, group, "Deleted Utility", 9_000);
        soft_delete_category(&conn, "Deleted Utility");

        let doc = export_doc(&conn);

        assert_eq!(doc.groups.len(), 1);
        assert_eq!(category_names(&doc.groups[0]), vec!["Rent"]);
    }

    #[test]
    fn export_omits_group_with_only_soft_deleted_categories() {
        let conn = template_test_db();
        let kept = seed_budget_group(&conn, "Housing");
        seed_budget_category(&conn, kept, "Rent", 120_000);
        let emptied = seed_budget_group(&conn, "Abandoned");
        seed_budget_category(&conn, emptied, "Old Category", 5_000);
        soft_delete_category(&conn, "Old Category");

        let doc = export_doc(&conn);

        assert_eq!(doc.groups.len(), 1);
        assert_eq!(group_names(&doc), vec!["Housing"]);
    }

    #[test]
    fn export_trims_group_and_category_names() {
        let conn = template_test_db();
        let group = seed_budget_group(&conn, "Housing");
        seed_budget_category_raw(&conn, group, "  Padded Rent  ");
        conn.execute(
            "UPDATE budget_groups SET name = '  Padded Housing  ' WHERE id = ?1",
            rusqlite::params![group],
        )
        .unwrap();

        let doc = export_doc(&conn);

        assert_eq!(group_names(&doc), vec!["Padded Housing"]);
        assert_eq!(category_names(&doc.groups[0]), vec!["Padded Rent"]);
    }

    #[test]
    fn export_empty_budget_errors() {
        let conn = template_test_db();

        expect_file_error(
            build_budget_template_export_json(&conn),
            MSG_NOTHING_TO_EXPORT,
        );
    }

    #[test]
    fn export_group_without_categories_errors() {
        let conn = template_test_db();
        seed_group(&conn, "Housing");

        expect_file_error(
            build_budget_template_export_json(&conn),
            MSG_NOTHING_TO_EXPORT,
        );
    }

    #[test]
    fn export_all_categories_soft_deleted_errors() {
        let conn = template_test_db();
        let group = seed_budget_group(&conn, "Housing");
        seed_budget_category(&conn, group, "Rent", 120_000);
        soft_delete_category(&conn, "Rent");

        expect_file_error(
            build_budget_template_export_json(&conn),
            MSG_NOTHING_TO_EXPORT,
        );
    }

    #[test]
    fn export_over_category_cap_errors() {
        let conn = template_test_db();
        let first = seed_budget_group(&conn, "First");
        for i in 0..50 {
            seed_budget_category(&conn, first, &format!("A{i}"), 1_000);
        }
        let second = seed_budget_group(&conn, "Second");
        for i in 0..=50 {
            seed_budget_category(&conn, second, &format!("B{i}"), 1_000);
        }
        assert_eq!(
            row_count(&conn, "budget_categories"),
            MAX_TEMPLATE_CATEGORIES as i64 + 1
        );

        expect_file_error(
            build_budget_template_export_json(&conn),
            MSG_EXPORT_NOT_PORTABLE,
        );
    }

    #[test]
    fn export_at_category_cap_ok() {
        let conn = template_test_db();
        let first = seed_budget_group(&conn, "First");
        for i in 0..50 {
            seed_budget_category(&conn, first, &format!("A{i}"), 1_000);
        }
        let second = seed_budget_group(&conn, "Second");
        for i in 0..50 {
            seed_budget_category(&conn, second, &format!("B{i}"), 1_000);
        }

        let doc = export_doc(&conn);

        let total: usize = doc.groups.iter().map(|g| g.categories.len()).sum();
        assert_eq!(total, MAX_TEMPLATE_CATEGORIES);
    }

    #[test]
    fn export_long_category_name_errors() {
        let conn = template_test_db();
        let group = seed_budget_group(&conn, "Housing");
        seed_budget_category_raw(&conn, group, &"n".repeat(MAX_TEMPLATE_NAME_LEN + 1));

        expect_file_error(
            build_budget_template_export_json(&conn),
            MSG_EXPORT_NOT_PORTABLE,
        );
    }

    #[test]
    fn export_writes_no_rows() {
        let conn = template_test_db();
        let group = seed_budget_group(&conn, "Housing");
        seed_budget_category(&conn, group, "Rent", 120_000);
        seed_budget_category(&conn, group, "Hydro", 9_000);

        build_budget_template_export_json(&conn).unwrap();

        assert_eq!(row_count(&conn, "audit_log"), 0);
        assert_eq!(row_count(&conn, "budget_groups"), 1);
        assert_eq!(row_count(&conn, "budget_categories"), 2);
    }

    #[test]
    fn export_file_name_slugifies() {
        let today = "2026-08-04";

        assert_eq!(
            export_template_file_name(DEFAULT_EXPORT_TEMPLATE_NAME, today),
            "budget-template-my-budget-2026-08-04.json"
        );
        assert_eq!(
            export_template_file_name("  Nick's  Budget 2026! ", today),
            "budget-template-nick-s-budget-2026-2026-08-04.json"
        );
        assert_eq!(
            export_template_file_name("Café", today),
            "budget-template-caf-2026-08-04.json"
        );
        assert_eq!(
            export_template_file_name("!!!", today),
            "budget-template-budget-2026-08-04.json"
        );
    }

    #[test]
    fn export_ensure_json_extension() {
        let cases = [
            ("budget.json", "budget.json"),
            ("budget.JSON", "budget.JSON"),
            ("budget", "budget.json"),
            ("notes.txt", "notes.txt.json"),
            // Dotfile-shaped name: `Path::extension()` treats the whole name as
            // the stem here (no extension), so a naive check would double-append
            // to ".json.json". The string-suffix check must not do that.
            (".json", ".json"),
        ];

        for (input, expected) in cases {
            assert_eq!(
                ensure_json_extension(PathBuf::from(input)),
                PathBuf::from(expected)
            );
        }
    }
}
