---
baseline_commit: 1bc542762f39223e091c1f9d297fd2b0b8e9cc3e
---

# Story 24.3: Export Current Budget as Shareable Template

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to export my current budget as a template file with all dollar amounts stripped,
so that I can share my category structure without leaking my financial figures.

**Scope:** Rust backend only — an export document builder + filename helpers added to the **existing** `db/budget_template.rs` (created by Story 24.1), the `export_budget_template` Tauri command with its native save dialog added to `commands/budget_template.rs` (created by Story 24.2), `lib.rs` registration, and unit tests that prove no dollar amount can reach the file. **No frontend, no hook, no i18n, no toast, no import changes, no system templates, no migration, no Playwright spec.**

**FRs:** FR96 (export + amount-stripping portion) · **NFRs:** NFR6 (no new sensitive-data storage — this story is the one that *prevents* a leak), NFR13 (cents handling)
**Epic:** [epics-budget-templates.md § Epic 24, Story 24.3](../planning-artifacts/epics-budget-templates.md)
**Architecture:** [architecture-budget-templates.md](../planning-artifacts/architecture-budget-templates.md) — **Decision 3** (schema), Decision 1 (file-based only), § API & Communication Patterns, § New Patterns for Budget Templates (export filename convention), § Project Structure
**Predecessors:** [Story 24.1](24-1-template-schema-models-core-apply-function.md) (types, `validate_budget_template`, constants) · [Story 24.2](24-2-import-validation-for-untrusted-template-files.md) (`commands/budget_template.rs`, dialog-cancel contract, module registration)

---

## ⛔ HARD PREREQUISITE — READ FIRST

**Story 24.1 must be implemented before this story starts.** Verified at story-creation time: `apps/desktop/src-tauri/src/db/budget_template.rs` does **not** exist, `apps/desktop/src-tauri/src/commands/budget_template.rs` does **not** exist, and `models/mod.rs` contains **none** of `SystemBudgetTemplate` / `TemplateGroupDef` / `TemplateCategoryDef` / `ApplyBudgetTemplateResult`.

**Before writing any code, run:**

```bash
ls apps/desktop/src-tauri/src/db/budget_template.rs
grep -n "SystemBudgetTemplate\|TemplateGroupDef\|TemplateCategoryDef" apps/desktop/src-tauri/src/models/mod.rs
grep -n "fn validate_budget_template\|SUPPORTED_TEMPLATE_FORMAT_VERSION" apps/desktop/src-tauri/src/db/budget_template.rs
ls apps/desktop/src-tauri/src/commands/budget_template.rs   # 24.2's file — may or may not exist yet
```

- `db/budget_template.rs` missing, or `validate_budget_template` missing → **STOP and report that Story 24.1 is not done.** Do **not** implement 24.1's contents here.
- `commands/budget_template.rs` missing (Story 24.2 not yet done) → **continue**, and create that file with only this story's command in it (Task 4 covers both cases). Do **not** implement `import_budget_template`.

This story **adds to** existing files; it creates at most one file.

---

## Acceptance Criteria

1. **Given** `apps/desktop/src-tauri/src/db/budget_template.rs`
   **When** this story is implemented
   **Then** it exposes `pub fn build_budget_template_export_json(conn: &Connection) -> Result<String, AppError>` which reads the user's live budget via the **existing** `budget_db::get_budget_groups` + `budget_db::get_all_budget_categories` and returns a `serde_json::to_string_pretty` rendering of a `SystemBudgetTemplate`
   **And** **no** new schema/DTO struct is introduced — the document is built from 24.1's `SystemBudgetTemplate` / `TemplateGroupDef` / `TemplateCategoryDef` (Decision 3's "single schema, optional field, not two schemas")
   **And** `db/budget.rs`, `db/audit.rs`, `error.rs`, and `models/mod.rs` are **not** modified

2. **Given** a budget with any non-zero `target_cents` values
   **When** `build_budget_template_export_json` returns
   **Then** every `target_cents` in the document is `null` — set to `None` **by construction**, never read from the DB row into the document
   **And** the returned JSON string contains **none** of the source `target_cents` digit sequences (asserted directly by test `export_json_strips_all_amounts`)
   **And** the document carries `format_version: 1` (`SUPPORTED_TEMPLATE_FORMAT_VERSION`), `id: null`, `description: null`, and `name: "My Budget"` (`DEFAULT_EXPORT_TEMPLATE_NAME`)

3. **Given** the user's live budget
   **When** the document is assembled
   **Then** groups appear in `get_budget_groups` order (`ORDER BY sort_order`) and each group's categories appear in `get_all_budget_categories` order (`ORDER BY group_id, sort_order`)
   **And** soft-deleted categories (`deleted_at IS NOT NULL`) are absent — inherited for free from `get_all_budget_categories`'s existing `WHERE deleted_at IS NULL`
   **And** every group and category `name` is `trim()`ed into the document

4. **Given** a group with zero active categories
   **When** the document is assembled
   **Then** that group is **omitted entirely** from `groups`
   *(An emitted group with `categories: []` would be rejected by this app's own importer — see Dev Notes §Conflict A)*

5. **Given** a budget with zero groups, or where every group was omitted by AC #4
   **When** `build_budget_template_export_json` runs
   **Then** it returns `AppError::File { message: MSG_NOTHING_TO_EXPORT }` — a new constant reading `"There is nothing to export yet. Create at least one budget category first."`
   **And** no save dialog is ever shown (the check happens before the dialog — AC #8)

6. **Given** an assembled document that would fail this app's own import rules (>`MAX_TEMPLATE_CATEGORIES` categories, or a name longer than `MAX_TEMPLATE_NAME_LEN`)
   **When** `build_budget_template_export_json` runs its self-check by calling 24.1's `validate_budget_template(&document)`
   **Then** it returns `AppError::File { message: MSG_EXPORT_NOT_PORTABLE }` — a new constant reading `"Your budget is too large to share as a template. Templates support at most 100 categories, each with a name of 100 characters or less."`
   **And** the underlying validation message is recorded via `tracing::warn!` (developer-visible only, never returned to the user)
   **And** a budget with exactly `MAX_TEMPLATE_CATEGORIES` (100) categories exports successfully

7. **Given** any document produced by `build_budget_template_export_json`
   **When** it is fed to 24.1's `apply_budget_template_json` against an empty budget
   **Then** it applies cleanly with `groups_created` / `categories_created` equal to the exported counts and `skipped_groups` empty — the export→import round trip is closed (asserted by test `export_json_round_trips_through_apply`)

8. **Given** `apps/desktop/src-tauri/src/commands/budget_template.rs`
   **When** this story is implemented
   **Then** it defines `pub async fn export_budget_template(app_handle: AppHandle) -> Result<Option<BudgetTemplateExportResult>, AppError>` with `#[tauri::command(rename_all = "snake_case")]`
   **And** it builds the JSON **first**, inside an explicit scope that **drops the `DbState` mutex guard before** the blocking dialog call
   **And** only then opens a native save dialog via `tauri_plugin_dialog::DialogExt` `blocking_save_file()`, chained exactly as `set_file_name(&default_name).add_filter("Nixus Budget Template", &["json"])` (mirroring `commands/backup.rs:42-47`)
   **And** `BudgetTemplateExportResult { path: String }` is defined **locally in that command file** with `#[derive(Serialize)]`, mirroring `backup.rs:12-15`'s `BackupResult` — `models/mod.rs` is not touched

9. **Given** the save dialog
   **When** it opens
   **Then** its pre-filled default filename is `budget-template-{slugified-name}-{yyyy-mm-dd}.json`, produced by `export_template_file_name(DEFAULT_EXPORT_TEMPLATE_NAME, &today)` where `today = chrono::Local::now().format("%Y-%m-%d").to_string()` (identical date idiom to `backup.rs:39`)
   **And** slugification is: lowercase → keep ASCII alphanumerics → collapse each run of other characters into a single `-` → trim leading/trailing `-` → fall back to `"budget"` if empty
   **And** with today's constant name the default filename is exactly `budget-template-my-budget-{yyyy-mm-dd}.json`

10. **Given** the user confirms the save dialog
    **When** the file is written
    **Then** the chosen path is normalized to end in `.json` (case-insensitive check; appended only when absent) and the JSON is written with `std::fs::write`
    **And** IO failure maps to `AppError::File { message: format!("Failed to write template file: {}", e) }`
    **And** on success it returns `Ok(Some(BudgetTemplateExportResult { path }))` with the **normalized** absolute path as a `String`, and logs `tracing::info!` once

11. **Given** the user cancels the save dialog
    **When** `blocking_save_file()` returns `None`, **or** the returned `FilePath::as_path()` is `None`
    **Then** the command returns `Ok(None)` — no error, no file written, no log-as-error
    *(Resolves the architecture-vs-requirements conflict: see Dev Notes §Conflict B)*

12. **Given** a completed export (successful or cancelled)
    **When** the database is inspected
    **Then** **zero** rows were written to `audit_log`, `budget_groups`, or `budget_categories` — export is strictly read-only
    *(Deliberate: architecture Decision 5 scopes audit logging to *apply* only, and `commands/backup.rs`'s export writes no audit row either — see Dev Notes §Conflict C)*

13. **Given** command registration
    **When** this story lands
    **Then** `pub mod budget_template;` exists in `commands/mod.rs` between `pub mod budget;` and `pub mod chat;` (add it only if Story 24.2 has not already)
    **And** `commands::budget_template::export_budget_template,` is registered in `lib.rs`'s `tauri::generate_handler!`, kept contiguous with the other budget-template/budget commands
    **And** nothing is added to `Cargo.toml` — `tauri-plugin-dialog`, `chrono`, `serde_json` are all already dependencies, and `tauri_plugin_dialog::init()` is already registered at `lib.rs:20`

14. **Given** the Rust backend
    **When** `cd apps/desktop/src-tauri && cargo check` runs
    **Then** it produces **zero warnings**
    **And** this story adds **no** new `#[allow(dead_code)]` (every new item has a real caller) and does not alter the existing allowance on `apply_system_budget_template` (Story 25.1 owns it)

15. **Given** the Rust backend
    **When** `cd apps/desktop/src-tauri && cargo test` runs
    **Then** all pre-existing tests (including 24.1's and 24.2's) still pass **and** every new test in Task 5's matrix passes

---

## Tasks / Subtasks

- [x] **Task 0: Confirm prerequisites** (see ⛔ HARD PREREQUISITE)
  - [x] Read the existing `db/budget_template.rs` end-to-end. Record the **actual** names of: `validate_budget_template`, `apply_budget_template_json`, `SUPPORTED_TEMPLATE_FORMAT_VERSION`, `MAX_TEMPLATE_NAME_LEN`, `MAX_TEMPLATE_CATEGORIES`, `MSG_INVALID_FILE`, and the `template_test_db()` test helper
  - [x] If 24.1 named anything differently than this story assumes, **use 24.1's actual names** and note the deviation in Completion Notes
  - [x] Note whether `commands/budget_template.rs` and `commands/mod.rs`'s `pub mod budget_template;` already exist (Story 24.2)

- [x] **Task 1: Add export constants to `db/budget_template.rs`** (AC: #2, #5, #6)
  - [x] Add next to 24.1's existing constants:
    ```rust
    /// Templates exported by a user carry no user-supplied title today; Decision 3's schema
    /// example uses this exact placeholder for the user-export shape.
    pub const DEFAULT_EXPORT_TEMPLATE_NAME: &str = "My Budget";

    const MSG_NOTHING_TO_EXPORT: &str =
        "There is nothing to export yet. Create at least one budget category first.";
    const MSG_EXPORT_NOT_PORTABLE: &str = "Your budget is too large to share as a template. \
        Templates support at most 100 categories, each with a name of 100 characters or less.";
    ```
  - [x] Add `use std::borrow::Cow;` and `use std::path::{Path, PathBuf};` to the module imports (24.2 may already have added `std::path::Path`)
  - [x] Add `use crate::models::{TemplateCategoryDef, TemplateGroupDef};` to the existing `crate::models::{...}` import list
  - [x] Do **not** invent any other constant, and do **not** change 24.1's five validation constants

- [x] **Task 2: Implement the export document builder** (AC: #1, #2, #3, #4, #5, #6, #7)
  - [x] ```rust
        pub fn build_budget_template_export_json(conn: &Connection) -> Result<String, AppError> {
        ```
  - [x] Read once each: `let groups = budget_db::get_budget_groups(conn)?;` and `let categories = budget_db::get_all_budget_categories(conn)?;` — **do not write new SQL**, both functions already exist and already filter/order correctly (`db/budget.rs:46`, `db/budget.rs:358`)
  - [x] Build `let mut template_groups: Vec<TemplateGroupDef> = Vec::new();`. For each `g` in `groups`, in order:
    ```rust
    let cats: Vec<TemplateCategoryDef> = categories
        .iter()
        .filter(|c| c.group_id == g.id)
        .map(|c| TemplateCategoryDef {
            name: Cow::Owned(c.name.trim().to_string()),
            // FR96: amounts are stripped by construction — c.target_cents is never read.
            target_cents: None,
        })
        .collect();
    if cats.is_empty() {
        // A group with no categories is rejected by our own importer (24.1 validation),
        // so emitting it would produce a file this app cannot re-import.
        continue;
    }
    template_groups.push(TemplateGroupDef {
        name: Cow::Owned(g.name.trim().to_string()),
        categories: Cow::Owned(cats),
    });
    ```
    `categories` is already ordered `group_id, sort_order`, so this filter preserves per-group `sort_order` without any sorting or `HashMap`
  - [x] If `template_groups.is_empty()` → `return Err(AppError::File { message: MSG_NOTHING_TO_EXPORT.to_string() });`
  - [x] Assemble the document:
    ```rust
    let document = SystemBudgetTemplate {
        format_version: SUPPORTED_TEMPLATE_FORMAT_VERSION,
        id: None,          // Decision 3: `id` is for system/library templates, absent for user exports
        name: Cow::Borrowed(DEFAULT_EXPORT_TEMPLATE_NAME),
        description: None,
        groups: Cow::Owned(template_groups),
    };
    ```
  - [x] Self-check with 24.1's validator (same module, so the private fn is callable) — guarantees AC #7:
    ```rust
    if let Err(e) = validate_budget_template(&document) {
        // Never surface the import-flavoured validation copy to an exporting user.
        tracing::warn!("Budget is not exportable as a template: {}", e);
        return Err(AppError::File {
            message: MSG_EXPORT_NOT_PORTABLE.to_string(),
        });
    }
    ```
  - [x] Serialize: `serde_json::to_string_pretty(&document).map_err(|e| AppError::File { message: format!("Failed to serialize template: {}", e) })` — never `.unwrap()`
  - [x] Do **not** open a transaction (read-only) and do **not** call `insert_audit_log` (AC #12)

- [x] **Task 3: Implement the filename helpers in `db/budget_template.rs`** (AC: #9, #10)
  - [x] ```rust
        pub fn export_template_file_name(name: &str, today: &str) -> String {
            format!("budget-template-{}-{}.json", slugify_template_name(name), today)
        }
        ```
        Taking `today` as a parameter keeps it pure and unit-testable; the command supplies the clock
  - [x] ```rust
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
        ```
        Shape mirrors `maintenance/catalog.rs:77-97`'s `make_slug`, with `-` instead of `_` (architecture requires "spaces → hyphens") and `"budget"` instead of `"unknown"`. **Do not import, move, or refactor `make_slug`** — it lives in the `maintenance` module, uses the wrong separator, and promoting it would put this story into unrelated files
  - [x] ```rust
        pub fn ensure_json_extension(path: PathBuf) -> PathBuf {
            // Our own open dialog filters to *.json, so a template saved without that extension
            // could not be re-imported by this app.
            let is_json = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("json"));
            if is_json {
                path
            } else {
                let mut name = path.file_name().unwrap_or_default().to_os_string();
                name.push(".json");
                path.with_file_name(name)
            }
        }
        ```
        (See Dev Notes §Conflict D. If `is_some_and` is unavailable on the toolchain, use `map_or(false, ..)`.)
  - [x] Add no `#[allow(dead_code)]` — all three are reached from the command

- [x] **Task 4: Add the `export_budget_template` command** (AC: #8, #9, #10, #11, #12)
  - [x] If `commands/budget_template.rs` exists (Story 24.2 done) → **add to it**. If not → create it with only this command
  - [x] Ensure these imports exist in the file (deduplicate against 24.2's; `noUnusedLocals` has no Rust twin but unused imports *are* warnings — AC #14):
    ```rust
    use serde::Serialize;
    use tauri::{AppHandle, Manager};
    use tauri_plugin_dialog::DialogExt;

    use crate::db::budget_template as budget_template_db;
    use crate::db::DbState;
    use crate::error::AppError;
    ```
  - [x] Local result DTO (mirrors `backup.rs:12-15`; **not** in `models/mod.rs`):
    ```rust
    #[derive(Serialize)]
    pub struct BudgetTemplateExportResult {
        pub path: String,
    }
    ```
  - [x] ```rust
        #[tauri::command(rename_all = "snake_case")]
        pub async fn export_budget_template(
            app_handle: AppHandle,
        ) -> Result<Option<BudgetTemplateExportResult>, AppError> {
        ```
  - [x] Build the JSON in an **explicit scope** so the mutex guard is released before the blocking dialog (see Dev Notes §Mutex + Dialog Ordering — this is the one place this story deviates from 24.2's dialog-first order, and it is deliberate):
    ```rust
    let json = {
        let db_state = app_handle.state::<DbState>();
        let conn = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        budget_template_db::build_budget_template_export_json(&conn)?
    }; // guard dropped here — never hold the DB lock across a blocking native dialog
    ```
  - [x] Default filename + dialog:
    ```rust
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
    ```
  - [x] Cancel handling — copy `backup.rs:49-57`'s double `match` verbatim in shape, both arms `return Ok(None)`:
    ```rust
    let save_path = match file_path {
        Some(p) => p.as_path().map(|p| p.to_path_buf()),
        None => return Ok(None), // User cancelled
    };

    let save_path = match save_path {
        Some(p) => p,
        None => return Ok(None),
    };
    ```
  - [x] Normalize, write, log, return:
    ```rust
    let save_path = budget_template_db::ensure_json_extension(save_path);

    std::fs::write(&save_path, json).map_err(|e| AppError::File {
        message: format!("Failed to write template file: {}", e),
    })?;

    let path_str = save_path.to_string_lossy().to_string();
    tracing::info!("Budget template exported to {}", path_str);

    Ok(Some(BudgetTemplateExportResult { path: path_str }))
    ```
    Use fully-qualified `tracing::info!` / `chrono::Local` so no new `use` line can end up unused if 24.2 already added its own
  - [x] Add a WHY comment stating that export writes **no** audit row (Decision 5 covers *apply* only), so a future reader does not "fix" the apparent omission against `project-context.md` §3

- [x] **Task 5: Registration** (AC: #13)
  - [x] `commands/mod.rs`: ensure `pub mod budget_template;` sits between `pub mod budget;` (line 4) and `pub mod chat;` (line 5) — add only if absent
  - [x] `lib.rs` `generate_handler!`: add `commands::budget_template::export_budget_template,` immediately after `commands::budget_template::import_budget_template,` if present, otherwise immediately after `commands::budget::get_all_budget_categories,` (`lib.rs:102`) and before `commands::expense::create_expense,` (`lib.rs:103`)
  - [x] Touch neither `Cargo.toml` nor the plugin list

- [x] **Task 6: Tests** (AC: #2–#7, #9, #10, #12, #15)
  - [x] Extend the **existing** `#[cfg(test)] mod tests` in `db/budget_template.rs`. Reuse 24.1's `template_test_db()` — do **not** define a second DB helper. Note it seeds **no** rows, so each test seeds its own
  - [x] Local seed helper (use the real db-layer fns so tests exercise the same path production does):
    ```rust
    fn seed_group(conn: &Connection, name: &str) -> i64 {
        budget_db::create_budget_group(conn, &CreateBudgetGroup { name: name.to_string() })
            .unwrap()
            .id
    }

    fn seed_category(conn: &Connection, group_id: i64, name: &str, target_cents: i64) {
        budget_db::create_budget_category(
            conn,
            &CreateBudgetCategory { group_id, name: name.to_string(), target_cents },
        )
        .unwrap();
    }
    ```
    For rows `create_budget_category` would reject (over-long names) insert with raw SQL instead — `db/budget.rs` has **no** name-length bound, so a long name is legal in the DB but not in a template
  - [x] Assert errors by matching the variant, mirroring `db/budget.rs:511-517`:
    ```rust
    match err {
        AppError::File { message } => assert_eq!(message, MSG_NOTHING_TO_EXPORT),
        other => panic!("expected file error, got {other:?}"),
    }
    ```

  | Test fn | Setup | Expected |
  |---|---|---|
  | `export_json_strips_all_amounts` | 2 groups, categories with `target_cents` `123_456` and `987_654` | parsed doc: every `target_cents.is_none()`; **and** `!json.contains("123456")`, `!json.contains("987654")` |
  | `export_json_header_fields` | 1 group + 1 category | `format_version == SUPPORTED_TEMPLATE_FORMAT_VERSION`, `id.is_none()`, `description.is_none()`, `&*name == DEFAULT_EXPORT_TEMPLATE_NAME` |
  | `export_json_round_trips_through_apply` | 2 groups × 2 categories, then apply the exported JSON into a **second** `template_test_db()` | `Ok`, `groups_created == 2`, `categories_created == 4`, `skipped_groups.is_empty()` |
  | `export_preserves_group_and_category_order` | 3 groups seeded in order, 2 categories each | doc group names and per-group category names match seed order exactly |
  | `export_excludes_soft_deleted_categories` | 1 group, 2 categories, one soft-deleted via `UPDATE budget_categories SET deleted_at = datetime('now') WHERE id = ?` | only the active category present |
  | `export_omits_group_with_only_soft_deleted_categories` | group A (1 active category) + group B (its single category soft-deleted) | `groups.len() == 1`, group B absent |
  | `export_empty_budget_errors` | fresh DB, nothing seeded | `AppError::File` == `MSG_NOTHING_TO_EXPORT` |
  | `export_all_categories_soft_deleted_errors` | 1 group, its only category soft-deleted | `AppError::File` == `MSG_NOTHING_TO_EXPORT` |
  | `export_over_category_cap_errors` | 101 categories across 2 groups | `AppError::File` == `MSG_EXPORT_NOT_PORTABLE` |
  | `export_at_category_cap_ok` | exactly 100 categories | `Ok`; parsed doc total categories == 100 |
  | `export_long_category_name_errors` | category name of 101 chars inserted via raw SQL | `AppError::File` == `MSG_EXPORT_NOT_PORTABLE` |
  | `export_writes_no_rows` | seed, export, then `SELECT COUNT(*)` on `audit_log` | count == 0 (and group/category counts unchanged) |
  | `export_file_name_slugifies` | pure helper, `today = "2026-08-04"` | `"My Budget"` → `budget-template-my-budget-2026-08-04.json`; `"  Nick's  Budget 2026! "` → `budget-template-nick-s-budget-2026-2026-08-04.json`; `"Café"` → `budget-template-caf-2026-08-04.json`; `"!!!"` → `budget-template-budget-2026-08-04.json` |
  | `export_ensure_json_extension` | pure helper | `budget.json` → unchanged; `budget.JSON` → unchanged; `budget` → `budget.json`; `notes.txt` → `notes.txt.json` |

- [x] **Task 7: Verification** (AC: #14, #15)
  - [x] `cd apps/desktop/src-tauri && cargo check` → **zero warnings**
  - [x] `cd apps/desktop/src-tauri && cargo test` → all pass; record the new total in Completion Notes (do not hardcode an expected count)
  - [x] Confirm untouched: `db/budget.rs`, `db/audit.rs`, `error.rs`, `models/mod.rs`, `commands/backup.rs`, `maintenance/`, all of `apps/desktop/src/**`, `locales/*.json`, `apps/desktop/tests/**`, `migrations/`, `Cargo.toml`
  - [x] `git diff --stat` should show exactly: `db/budget_template.rs`, `commands/budget_template.rs`, `commands/mod.rs` (only if 24.2 had not added the line), `lib.rs`
  - [x] Do **not** commit

### Review Findings

_Adversarial code review, 2026-08-04. Scope: this story's own additions only (`build_budget_template_export_json`, `export_template_file_name`, `slugify_template_name`, `ensure_json_extension`, the 3 new constants, and the 16 new tests in `db/budget_template.rs`; `BudgetTemplateExportResult` + `export_budget_template` in `commands/budget_template.rs`; the 1-line registration in `lib.rs`). Stories 24.1/24.2 code excluded — already reviewed and passed. Verification: `cargo check --all-targets` 0 warnings, `cargo clippy --all-targets -- -D warnings` 0 warnings, `cargo test` 241/241 pass, `cargo test rollback_leaves_no_rows` 1/1 pass. All 15 ACs independently re-verified against actual code (not just tests) — no violations found. No path-traversal, filesystem-injection, or amount-leakage defect found in `slugify_template_name`/`export_template_file_name`/`ensure_json_extension` or the export builder, confirmed by hand-tracing and by two independent adversarial passes (one diff-only "blind" pass, one full-repo-access "edge case" pass), including mutation testing that confirmed `export_json_strips_all_amounts` and the export self-check genuinely fail on regression._

- [x] [Review][Defer] `ensure_json_extension` appends `.json` to the chosen save path **after** the native save dialog has already resolved (and after any OS-level overwrite-confirmation the dialog itself may have shown, which would have run against the pre-extension name the user typed). If a user types a bare stem (e.g. `foo`) when `foo` doesn't exist but `foo.json` already does (e.g. a prior export), `std::fs::write` silently overwrites `foo.json` with **no** confirmation shown for the name actually written. `commands/backup.rs` has no equivalent post-dialog rename step, so it does not share this risk — this is specific to this story's Conflict D resolution. **Decision (2026-08-04): accept as-is, deferred.** Impact is bounded to overwriting a previously-exported template file (never live budget data — the DB is untouched by export), and the current behavior matches the existing `commands/backup.rs` save-dialog precedent; fixing it here alone would introduce an inconsistency between the two save-dialog flows. A proper fix belongs with a broader save-dialog UX pass across both commands. Logged in `deferred-work.md` under "Deferred from: code review of 24-3-export-current-budget-as-shareable-template (2026-08-04)".

- [x] [Review][Patch] `ensure_json_extension` used `Path::extension()` to detect an existing `.json` extension, which returns `None` for a dotfile-shaped name like `.json` (the whole name is treated as the stem) — so `ensure_json_extension(PathBuf::from(".json"))` incorrectly became `.json.json`. Fixed to check the filename as a case-insensitive string suffix instead; added a regression case to `export_ensure_json_extension`. [db/budget_template.rs:383-396, test at :1556-1574]

- [x] [Review][Patch] The doc-comment on `build_budget_template_export_json` overstated the export guarantee as "no dollar amount can reach the file" — true for the structured `target_cents` field (what FR96/AC#2 actually require, and what `export_json_strips_all_amounts` asserts), but a user's own category/category-group name is copied through verbatim and may itself contain a `$` or digits (e.g. "Save $1200/mo") — that's the user's own label, not a leaked stored amount. Clarified the comment to scope the claim precisely. [db/budget_template.rs:286-291]

- [x] [Review][Defer] `export_budget_template`/`import_budget_template` call `blocking_save_file()`/`blocking_pick_file()` directly inside `async fn` Tauri commands with no `spawn_blocking`; on a small executor thread pool a long-open native dialog could stall other concurrent async commands. Pre-existing pattern established by `commands/backup.rs` and Story 24.2's `import_budget_template` (both already shipped/reviewed) — not introduced by this story. Deferred as a repo-wide concern outside 24.3's scope, not a regression here.

**Dismissed as noise / handled elsewhere (4):** generic `MSG_EXPORT_NOT_PORTABLE` message not naming the specific offending group/category — this is the exact literal text mandated by AC #6, and is already flagged as a 25.3 UX follow-up in this story's own Dev Notes. Export/import lossiness on case-insensitive duplicate group names — inherited from 24.1's existing `apply_template_inner` collision-skip logic (not modified here), and explicitly documented in this story's Dev Notes as "expected... not a bug in this story." Pre-dialog vs. post-dialog snapshot timing vs. `backup.rs` — a deliberate, explicitly documented design choice (see "Mutex + Dialog Ordering" below), not exploitable in this single-mutex, single-window app. Unicode grapheme-cluster-vs-scalar-value name-length counting, control-character/bidi sanitization, and `to_string_lossy()` WTF-8 edge cases — all pre-existing 24.1 code or codebase-wide precedent (`backup.rs`), out of this story's scope per review instructions.

---

## Dev Notes

### Critical Rules (DO NOT VIOLATE)

1. **Amounts are stripped by construction, not filtered afterwards.** `target_cents: None` is a literal in the `.map()`; the DB value is never copied into the document. FR96 and the shipped user-facing promise ("will strip every dollar amount and keep only the category names", `locales/en.json:796`) both depend on this being structurally impossible to get wrong. [Source: prd.md:600, architecture § Requirements Coverage]
2. **Do not create a new export schema type.** Reuse 24.1's `SystemBudgetTemplate` / `TemplateGroupDef` / `TemplateCategoryDef`. Decision 3 mandates one schema with an optional field, not two. The `System…` prefix reads oddly for a user export — that is intentional and settled; renaming it would break Story 25.1.
3. **Do not write new SQL.** `get_budget_groups` and `get_all_budget_categories` already exist, already filter `deleted_at IS NULL`, and already order correctly. Adding a `get_budget_groups_with_categories` JOIN would be reinvention and would modify `db/budget.rs`, which is read-only for this epic. [Source: architecture § Files explicitly NOT modified]
4. **`db/budget.rs`, `db/audit.rs`, `error.rs`, `models/mod.rs` are read-only.** No new `AppError` variant.
5. **Never hold the `DbState` mutex across `blocking_save_file()`.** Use the explicit scope in Task 4.
6. **Zero compilation warnings**, and no new `#[allow(dead_code)]`. [Source: docs/project-context.md §9, docs/guidelines/warnings.md]
7. **No frontend, no i18n, no toast, no Playwright, no `SYSTEM_TEMPLATES`, no migration, no import changes in this story.**
8. **Never surface raw filesystem paths or serializer text as an explanation.** The two new canned messages are the only user-visible copy this story adds; only the genuine-IO-fault message includes OS text (mirroring `backup.rs`'s `"Failed to copy database: {}"`).

### Four Conflicts Resolved Here (Binding — Do Not Re-derive)

**Conflict A — a naive export produces a file this app refuses to import.**
Epic AC 24.3 says the file "contains the current groups/categories by name". But 24.1's `validate_budget_template` (AC #9) rejects an empty `groups` array *and* any group with an empty `categories` array — and `budget_groups` has no soft-delete, so a group whose only categories were soft-deleted still exists as a row with zero active children. A literal "export everything" therefore yields a non-importable file for two ordinary states (brand-new user; group emptied by deletions), silently breaking the export→re-import round trip that epic Story 24.4 will E2E-test.
**Resolution:** skip groups with zero active categories (AC #4); if nothing survives, fail fast with `MSG_NOTHING_TO_EXPORT` (AC #5); and self-check the assembled document with `validate_budget_template` before serializing (AC #6). Every file this command writes is importable by this app version, by construction. This costs nothing — the validator already exists in the same module.

**Conflict B — `export_budget_template`'s return type cannot be `Result<(), AppError>`.**
Architecture § API & Communication Patterns specifies `export_budget_template() -> Result<(), AppError>`, but epic AC 24.3 requires both a **success confirmation** ("a success toast/confirmation is shown") and a **silent cancel** ("returns without error and without writing a file"). `()` can express neither.
**Resolution:** `Result<Option<BudgetTemplateExportResult>, AppError>`, `Ok(None)` on cancel — identical in shape to `commands/backup.rs::export_backup`'s `Result<Option<BackupResult>, AppError>` (`backup.rs:18`, `:50`, `:56`), which the frontend already consumes as `invoke<{ path: string } | null>("export_backup")` with a `if (result) toast.success(...)` guard (`YourDataSettings.tsx:26-27`). Story 24.2 resolved the mirror-image conflict for `import_budget_template` the same way. Story 25.3 must type this as `{ path: string } | null`.

**Conflict C — should export write an audit row?**
`project-context.md` §3 and its anti-pattern list demand an audit row on "every create/update/delete". Export is none of those: it performs zero DB mutations. Architecture Decision 5 scopes the new audit row explicitly to *template application*. `commands/backup.rs::export_backup` — the closest precedent, which also produces a file containing user data — writes no audit row either.
**Resolution:** **no audit row on export.** AC #12 asserts `audit_log` stays empty. Leave the WHY comment from Task 4 so this is not "fixed" later.

**Conflict D — the saved file may not end in `.json`.**
Nothing in the epic or architecture addresses the extension, and `backup.rs` does not normalize it. But this feature's own importer filters the open dialog to `&["json"]` (Story 24.2 AC #1), so a user who types `mybudget` in the save dialog gets a file they cannot select on re-import.
**Resolution:** `ensure_json_extension` appends `.json` when absent (case-insensitive), and the returned `path` is the normalized one so the confirmation shows the real file. This is a deliberate, minimal deviation from `backup.rs`; it is unit-tested (`export_ensure_json_extension`) rather than assumed.

### Two Facts That Contradict the Planning Docs (verified in code)

1. **There are no "already-scaffolded but disabled" Templates buttons.** Architecture § Frontend Architecture and the epic both say `YourDataSettings.tsx`'s `settings.sectionTemplates` block has "buttons currently disabled". It does not. `YourDataSettings.tsx:138-146` renders a `SettingsSection` containing a single `SettingRow` with `title`/`description` and `data-testid="setting-templates-unavailable"` — **no `control` prop, no `Button`, no `disabled` attribute**, plus a source comment (`:135-137`) explaining that the button was withheld until the backend could strip amounts. Only three i18n keys exist (`settings.sectionTemplates`, `settings.templatesUnavailableTitle`, `settings.templatesUnavailableBody` — `en.json:794-796`, `fr.json:794-796`). Story 25.3 must therefore **create** the buttons and **add** new keys, not enable existing ones. Do not go looking for a `disabled` prop in this story.
2. **Budgets are not month-scoped.** Neither table has a `month`/period column (only `002_budget_tables.sql` + `022_budget_category_soft_delete.sql` touch them). `get_budget_status(year, month)` derives per-month *spend* by joining `expenses`, but the category/target set is a single live list. "Current budget" therefore needs **no** year/month parameter — `export_budget_template` takes none.

### Existing Code to Extend (DO NOT REINVENT)

| Item | File:line | Exact fact |
|---|---|---|
| Save-dialog command shape | `commands/backup.rs:17-68` (`export_backup`) | The **only** `blocking_save_file` precedent. `async fn` + `AppHandle` (not `State<DbState>`); DB state via `app_handle.state::<DbState>()`; returns `Result<Option<BackupResult>, AppError>` |
| Dialog builder chain | `backup.rs:42-47` | `.dialog().file().set_file_name(&default_name).add_filter("SQLite Database", &["db"]).blocking_save_file()` — no `set_title`, no `set_directory`. Extensions carry no leading dot |
| Cancel idiom | `backup.rs:49-57` | Double `match`: `Option<FilePath>` then `FilePath::as_path() -> Option<&Path>`; both `None` arms `return Ok(None)` |
| Scoped guard inside an `async` command | `backup.rs:22-28` | Proof that locking `DbState` in a `{ }` block inside a `#[tauri::command] async fn` compiles — copy this shape |
| Local result DTO | `backup.rs:12-15` | `#[derive(Serialize)] pub struct BackupResult { pub path: String }` — declared in the command file, **not** `models/mod.rs`; only `Serialize` |
| Success payload | `backup.rs:64-67` | `save_path.to_string_lossy().to_string()`, then `info!(...)`, then `Ok(Some(BackupResult { path }))` |
| Today's date | `backup.rs:39` | `chrono::Local::now().format("%Y-%m-%d").to_string()` — `Local`, never `Utc`, for anything user-facing. `chrono = { version = "0.4", features = ["serde"] }` (`Cargo.toml:29`, locked 0.4.45) |
| File write + error map | `backup.rs:60-62` | `std::fs::…().map_err(\|e\| AppError::File { message: format!("Failed to …: {}", e) })?` — every IO failure in this file maps to `AppError::File` |
| No audit on export | `commands/backup.rs` (whole file) | Never calls `insert_audit_log`, though `db::audit` exists |
| `get_budget_groups` | `db/budget.rs:46` | `pub fn get_budget_groups(conn: &Connection) -> Result<Vec<BudgetGroup>, AppError>` — `SELECT id, name, sort_order, created_at FROM budget_groups ORDER BY sort_order` |
| `get_all_budget_categories` | `db/budget.rs:358` | `pub fn get_all_budget_categories(conn: &Connection) -> Result<Vec<BudgetCategory>, AppError>` — `… WHERE deleted_at IS NULL ORDER BY group_id, sort_order`. **Use this, not a new JOIN** |
| `BudgetGroup` | `models/mod.rs:3-9` | `{ id: i64, name: String, sort_order: i32, created_at: String }` |
| `BudgetCategory` | `models/mod.rs:11-19` | `{ id, group_id, name, target_cents: i64, sort_order, created_at }` — no `deleted_at` field (filtered in SQL only) |
| `create_budget_group` / `create_budget_category` | `db/budget.rs:6`, `:64` | Used only by tests here. Trim + empty check; category also rejects `target_cents <= 0`; **no name-length bound anywhere** |
| Slug helper shape | `maintenance/catalog.rs:77-97` (`make_slug`) | The only slug-like fn in the tree: lowercase, keep `is_ascii_alphanumeric`, collapse others into one `_`, `trim_matches`, fallback `"unknown"`. **Copy the shape, do not import it** — wrong separator, wrong module. No `slug`/`slugify` crate exists in `Cargo.toml` or `Cargo.lock`; do not add one |
| `AppError::File` | `error.rs:9` | `File { message: String }`, plain owned `String`. `AppError` is hand-rolled (manual `Display`/`Serialize`/`Error`); **`thiserror` is not used** — do not add a derive |
| `From<rusqlite::Error>` | `error.rs:92-97` | `?` converts rusqlite errors to `AppError::Database`; `Mutex` poison has no `From` — always `.map_err` inline |
| Mutex lock idiom | `commands/budget.rs` (9× verbatim) | `state.0.lock().map_err(\|e\| AppError::Database { message: e.to_string() })?` |
| Command attribute | `commands/budget.rs:125` | `#[tauri::command(rename_all = "snake_case")]` — required by `project-context.md` §2. `backup.rs` uses the bare form; Story 24.2 already chose the stricter one for this file, so match 24.2 |
| Test DB helper | `db/budget_template.rs` (`template_test_db()`, from 24.1) | Hand-rolled in-memory DDL with `budget_groups`, `budget_categories` (incl. `deleted_at`), `audit_log`. **Seeds no rows.** No migration-based test harness exists anywhere — do not look for one |
| Error-assertion style | `db/budget.rs:511-517` | `match err { AppError::X { message, .. } => assert!(…), other => panic!("… {other:?}") }` |

`&tx` is accepted anywhere `&Connection` is expected (`rusqlite::Transaction: Deref<Target = Connection>`) — irrelevant here, since export opens no transaction.

### Mutex + Dialog Ordering (deliberate deviation from Story 24.2)

24.2's `import_budget_template` shows the dialog **first**, then locks `DbState` — correct there, because nothing is knowable before the user picks a file. Export is the reverse: whether there is anything exportable at all is knowable *before* prompting, and prompting for a save location only to then error is poor UX (AC #5 requires no dialog in that case). So this command locks → builds JSON → **drops the guard** → shows the dialog → writes. The explicit `{ }` scope is load-bearing: a `MutexGuard` held across `blocking_save_file()` would block every other command for as long as the dialog is open. `backup.rs:22-28` establishes the same scoped-guard-then-dialog order.

### Schema Emitted by This Story (Decision 3)

```json
{
  "format_version": 1,
  "id": null,
  "name": "My Budget",
  "description": null,
  "groups": [
    { "name": "Housing", "categories": [{ "name": "Rent", "target_cents": null }] }
  ]
}
```

- `to_string_pretty` renders `Option::None` as `null` because 24.1's structs carry **no** `#[serde(skip_serializing_if)]` — AC #2's "`null` or absent" is satisfied by `null`. Do **not** add serde attributes to 24.1's types to make fields disappear.
- `sort_order` is deliberately absent from the file (Decision 3); array order is what round-trips, and 24.1's apply derives `sort_order` from `MAX(sort_order)+1` in array order.
- No BOM is written, so 24.2's BOM-stripping import path is not exercised by our own files (it exists for Notepad-edited third-party files).
- Re-importing your own export into the same budget will skip every group by case-insensitive name collision (24.1 AC #4) and land targets at `$1.00` (`DEFAULT_TEMPLATE_TARGET_CENTS`) in a fresh budget — expected, and flagged for the Story 25.3 UX review, not a bug in this story.

### Registration — Exact Insertion Points

`commands/mod.rs` (19 alphabetical `pub mod` lines; `budget` is line 4, `chat` is line 5):
```rust
pub mod budget;
pub mod budget_template;   // <-- 24.2 may already have added this
pub mod chat;
```

`lib.rs` `generate_handler!` (starts `lib.rs:91`; grouped by domain, **not** globally alphabetical — keep budget-template commands contiguous):
```rust
    commands::budget::get_all_budget_categories,          // lib.rs:102
    commands::budget_template::import_budget_template,    // from 24.2, if present
    commands::budget_template::export_budget_template,    // <-- add here
    commands::expense::create_expense,                    // lib.rs:103
```

`tauri_plugin_dialog::init()` is already registered (`lib.rs:20`). `tauri-plugin-dialog = "2.7.0"` (Cargo.lock resolves 2.7.1) is already in `Cargo.toml:30`. **No dependency changes.**

### Dead Code (this WILL bite you)

`mod db;` is private in `lib.rs`, so unreferenced `pub fn`s in `db/*.rs` still trigger `dead_code`, and `#[cfg(test)]` usage does **not** suppress it under plain `cargo check`.

- `build_budget_template_export_json`, `export_template_file_name`, `ensure_json_extension`, `DEFAULT_EXPORT_TEMPLATE_NAME` → all called from the new command → **no allowance needed**.
- `slugify_template_name` → called by `export_template_file_name` → no allowance needed.
- `MSG_NOTHING_TO_EXPORT` / `MSG_EXPORT_NOT_PORTABLE` → used inside the builder → no allowance needed.
- `export_budget_template` → `generate_handler!` counts as a use, so no warning even though no frontend calls it until Story 25.3.
- Leave `#[allow(dead_code)]` on `apply_system_budget_template` alone (Story 25.1 owns it). If Story 24.2 has not yet run, `apply_budget_template_json` may still carry its allowance — that is 24.2's to remove, not this story's.
- Never delete code to silence a warning.

### Out of Scope (later stories)

| Item | Story |
|---|---|
| `useExportBudgetTemplate()` hook, `lib/types.ts` shape (`{ path: string } \| null`), `queryKeys` | 25.2 |
| `YourDataSettings.tsx` "Export as template" **button** (must be created — none exists), success toast, new `locales/en.json` + `fr.json` keys | 25.3 |
| `import_budget_template` command, file reading, validation matrix | 24.2 |
| `useImportBudgetTemplate()`, skipped-groups toast copy | 24.4 |
| `budget/template_defaults.rs`, `SYSTEM_TEMPLATES`, `list_system_templates`, `apply_system_template`, `SystemBudgetTemplateSummary` | 25.1 |
| Onboarding fork starter-template path | 25.4 |
| `tests/budget-templates.spec.ts` Playwright E2E (export→re-import round trip) | 24.4 / 25.4 |
| Letting the user **name** the exported template (today it is the `DEFAULT_EXPORT_TEMPLATE_NAME` constant) | Deferred — flag at the 25.3 UX review |
| Import preview/confirmation UI | Undecided — architecture § Important Gaps |
| New migration / `budget_templates` table | Never (Decision 1) |

### Naming Collision Warning

`models/mod.rs:351-361` already defines `RecurringExpenseTemplate` (a recurring monthly expense rule — `merchant`, `amount_cents`, `budget_category_id`, `day_of_month`), served by `db/recurring.rs` + `commands/recurring.rs`. **Unrelated concept.** Never introduce a bare `Template` type; never touch the recurring files. Every new item here is `BudgetTemplate`/`budget_template`-prefixed or template-scoped. [Source: architecture § Technical Constraints]

### Project Structure Notes

- Monorepo path: `apps/desktop/src-tauri/` (`@nkbaz/desktop`). Registration lives in `lib.rs`, not `main.rs`
- `commands/` holds 19 domain modules + `mod.rs`; `db/` mirrors that layout (`db/budget.rs` is `db/mod.rs:13`)
- `src-tauri/src/budget/` does **not** exist (Story 25.1 creates it) — nothing here needs it
- Latest migration is `022_budget_category_soft_delete.sql`; this story adds none
- Money is always `i64` cents with a `_cents` suffix, never `f64` (NFR13) — and this story writes **no** cents to disk at all
- No `clippy.toml`, no `#![deny(warnings)]`, no `rust-toolchain.toml`, and **no `cargo test`/`cargo clippy` step in CI** — the zero-warning rule is enforced procedurally, so run it yourself
- Verify with `cd apps/desktop/src-tauri && cargo check && cargo test` (per `CONTRIBUTING.md:190-212`). If `cargo fmt` is unavailable in the environment, note it rather than hand-reformatting (as in Story 23.1)
- Rust test baseline at story creation: **188** `#[test]` fns across 21 files in `src-tauri/src` (5 in `db/budget.rs`), **before** 24.1's and 24.2's additions — do not hardcode an expected total

### Previous Story Intelligence (Story 24.2, immediate predecessor)

24.2 is `ready-for-dev`, **not verified code** — treat its content as specification. Carry-forwards that directly shape this story:

- **The cancel contract is settled and precedented.** 24.2's Conflict A established `Result<Option<T>, AppError>` + `Ok(None)` on cancel from `backup.rs::export_backup` (`backup.rs:17`, `:50`). This story reuses the identical shape for the save dialog — do not invent an `Err`-on-cancel or a `bool` return.
- **`commands/budget_template.rs` is 24.2's file.** Add to it; do not rewrite its imports or its `import_budget_template`. If it already imports `tauri::{AppHandle, Manager}`, `DialogExt`, `DbState`, `AppError`, reuse them rather than duplicating (duplicate `use` lines are warnings).
- **24.2 chose `#[tauri::command(rename_all = "snake_case")]`** for this file over `backup.rs`'s bare form, to satisfy `project-context.md` §2. Match it.
- **`tauri-plugin-dialog` 2.7.0**: `blocking_save_file()` must not run on the main thread; it is safe inside a `#[tauri::command] async fn` because Tauri dispatches commands off the main thread. This is why the command is `async`. `add_filter` is a UI hint only — never treat the extension as a guarantee (which is why `ensure_json_extension` exists).
- **`MAX_TEMPLATE_NAME_LEN` is a template-only bound (chars, via `.trim().chars().count()`), not a DB bound.** 24.1 Conflict 2 + 24.2 re-confirmed that `db/budget.rs` has no length check at all — hence AC #6's "too large to share" path is genuinely reachable and must be tested with a raw-SQL insert.
- **`Cow` field shapes.** 24.1 Conflict 3 makes every name field `Cow<'static, str>` and every list `Cow<'static, [T]>` so one type is both `const`-constructible (25.1) and `Deserialize`-able (24.2). Building an export means `Cow::Owned(String)` / `Cow::Owned(Vec<_>)`, and reading a name in tests means `&*doc.name`, not `.as_str()` on an `Option`.
- **`serde` 1.0.228 / `serde_json` 1.0.150 / `rusqlite` 0.38.0 / Rust 2021.** No new crates.
- **Scope-creep tripwire, inherited from 23.1 and repeated by 24.1/24.2:** if you find yourself editing `db/budget.rs`, `db/audit.rs`, `error.rs`, `models/mod.rs`, `maintenance/`, or anything under `apps/desktop/src/`, stop — that is a scope violation, not a necessity.

### Recent Commit Context

`git log --oneline -8`: `1bc5427 fix(trends): show friendly fallback instead of raw error on AI insight failure`, `9cadcad fix: AI chat layout + version bump to 0.3.1`, `ea5d9f8`/`f86f300 feat(ui): Implement new UI/UX`, `1e9560e feat(ui): Small improvements`, `ea8f35f chore: bump version to 0.2.8`, `0081d17 fix: where you can't delete a category due to past spending`, `e758710 fix(budget): show actionable errors when category delete is blocked`.

The head commit is directly relevant precedent: the codebase's current direction is **friendly canned copy instead of raw error text**, which is exactly what `MSG_NOTHING_TO_EXPORT` and `MSG_EXPORT_NOT_PORTABLE` deliver (and why the raw validator message is only `tracing::warn!`ed). The two older budget commits added the soft-delete path in `db/budget.rs:244-291` — read it to understand why `deleted_at` filtering matters to this export, but **do not modify it**. No template work exists in history; this is greenfield.

`git status --short` at story creation: `M _bmad-output/implementation-artifacts/deferred-work.md` plus untracked planning/story artifacts only — no source changes pending. **Do not commit anything.**

### UX Note

No UX-DR covers budget templates (`ux-design-specification.md` predates the 2026-08-01 FR70 amendment; architecture § Important Gaps flags the template UX as story-level). This story is backend-only and adds no user-visible surface of its own, but it fixes copy and behaviour that Story 25.3 will display verbatim. Raise at that UX review:

- Two new canned messages (`MSG_NOTHING_TO_EXPORT`, `MSG_EXPORT_NOT_PORTABLE`) currently exist only as English strings in Rust, matching 24.1/24.2's precedent. 25.3 decides whether to map them to i18n keys or show them as returned.
- The success confirmation: existing precedent is `toast.success(t("sidebar.backupSaved", { path: result.path }))` via `sonner` (`YourDataSettings.tsx:27`, `en.json` `sidebar.*` toast namespace) with a silent no-toast cancel (`if (result)` guard). 25.3 needs a new sibling key (e.g. `sidebar.templateSaved`) in **both** `en.json` and `fr.json`.
- The exported template's `name` is a hardcoded `"My Budget"`. Whether the user should be able to title it is an open product question.
- Playwright cannot drive a real native dialog. Existing specs stub the IPC transport (`tests/import.spec.ts:50` returns a canned path for `"plugin:dialog|open"`); an export E2E in 24.4/25.4 will need the same treatment for `"plugin:dialog|save"`.

### References

- [Source: _bmad-output/planning-artifacts/epics-budget-templates.md — Epic 24 § Story 24.3 (all 4 ACs), § Story 24.4 (scope boundary), Requirements Inventory § Additional Requirements (export filename convention), § UX Design Requirements]
- [Source: _bmad-output/planning-artifacts/architecture-budget-templates.md — Decision 1 (file-based only), **Decision 3 (schema, `id`/`target_cents` semantics)**, Decision 5 (audit scoped to apply), § API & Communication Patterns (`export_budget_template`), § New Patterns for Budget Templates (export filename convention, slugify rule), § Enforcement Guidelines, § Project Structure & Implementation Map, § Files explicitly NOT modified, § Gap Analysis]
- [Source: _bmad-output/implementation-artifacts/24-1-template-schema-models-core-apply-function.md — §Type Definitions (Copy Verbatim), §Constants, §Three Conflicts (1: `$1.00` default, 2: no DB length bound, 3: `Cow` shapes), §Test DB Helper, §Dead Code]
- [Source: _bmad-output/implementation-artifacts/24-2-import-validation-for-untrusted-template-files.md — §Conflict A (cancel → `Ok(None)`), §Existing Code to Extend, §Registration — Exact Insertion Points, §Command Attribute Decision, §Latest Tech Information (`tauri-plugin-dialog` 2.7.0 blocking-dialog threading)]
- [Source: _bmad-output/planning-artifacts/prd.md:600 — FR96 ("template export strips every dollar amount by construction … no account, no server, ever"); :626 NFR11; :628 NFR13]
- [Source: docs/project-context.md — §1 integer cents, §2 Tauri IPC (`rename_all`, `Result<T, AppError>`, `DbState` lock), §3 db/commands separation + audit expectation (deviation documented in Conflict C), §5 `AppError`, §9 warnings policy]
- [Source: docs/guidelines/warnings.md — dead-code resolution policy]
- [Source: apps/desktop/src-tauri/src/commands/backup.rs:7,12-15,17-18,22-28,39-47,49-57,60-67,73-77 — sole save-dialog precedent: local `BackupResult`, `async fn` + `AppHandle`, scoped `DbState` guard, `chrono::Local` filename date, builder chain, cancel→`Ok(None)`, `std::fs` + `AppError::File`, `info!`, no audit row]
- [Source: apps/desktop/src-tauri/src/db/budget.rs:6,46,64,113,244-291,358-361,384-438,500-518 — `create_budget_group`/`create_budget_category` (trim/empty, `target_cents <= 0`, no length bound), `get_budget_groups` SQL, `get_all_budget_categories` SQL (`deleted_at IS NULL ORDER BY group_id, sort_order`), soft-delete path, test-db helper, error-assertion style]
- [Source: apps/desktop/src-tauri/src/models/mod.rs:3-9,11-19,351-361 — `BudgetGroup`, `BudgetCategory` (no `deleted_at` field), `RecurringExpenseTemplate` collision]
- [Source: apps/desktop/src-tauri/migrations/002_budget_tables.sql:1-17, 022_budget_category_soft_delete.sql:1-3 — full DDL; no `month` column; `deleted_at` on categories only; no UNIQUE on `name`]
- [Source: apps/desktop/src-tauri/src/error.rs:4-13,15-27,31-90,92-97 — `AppError::File { message: String }`, hand-rolled `Display`/`Serialize` (no `thiserror`), `From<rusqlite::Error>`]
- [Source: apps/desktop/src-tauri/src/maintenance/catalog.rs:77-97 — `make_slug` shape precedent (`_` separator, `maintenance` module — copy the shape, do not import)]
- [Source: apps/desktop/src-tauri/src/commands/budget.rs:125-134 — `#[tauri::command(rename_all = "snake_case")]` + `State<DbState>` lock idiom]
- [Source: apps/desktop/src-tauri/src/commands/mod.rs:1-19 — alphabetical `pub mod` list, `budget` line 4 / `chat` line 5 insertion point]
- [Source: apps/desktop/src-tauri/src/lib.rs:20,91,102-103 — `tauri_plugin_dialog::init()`, `generate_handler!` start, budget block ends at `get_all_budget_categories`]
- [Source: apps/desktop/src-tauri/Cargo.toml:29-30 — `chrono = { version = "0.4", features = ["serde"] }`, `tauri-plugin-dialog = "2.7.0"`; no `slug`/`slugify` crate in Cargo.toml or Cargo.lock]
- [Source: apps/desktop/src/components/settings/YourDataSettings.tsx:3,5,10-13,22-33,35-49,118-133,135-146 — direct `invoke`, `sonner` `toast.success`, silent-cancel `if (result)` guard, and the buttonless `settings.sectionTemplates` block]
- [Source: apps/desktop/src/locales/en.json:794-796, fr.json:794-796 — the only three template i18n keys; `en.json:796` is the shipped amount-stripping promise this story must honor]
- [Source: apps/desktop/src/lib/constants.ts:1-17 — `queryKeys` budget keys; no `systemBudgetTemplates`]
- [Source: apps/desktop/tests/import.spec.ts:50 — `"plugin:dialog|open"` IPC stub; the only way Playwright can fake a native dialog]
- [Source: CONTRIBUTING.md:190-212 — `cd apps/desktop/src-tauri && cargo check`; no Rust step in .github/workflows/release.yml]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

Verification commands run in `apps/desktop/src-tauri` (sources `touch`ed before each static-analysis run to defeat Cargo/Clippy caching):

| Command | Result |
|---|---|
| `cargo check --all-targets` (baseline, before any change) | `Finished dev profile` — **0 warnings** |
| `cargo test` (baseline) | **225 passed**; 0 failed |
| `cargo test` (RED, tests written before implementation) | **14 compile errors** — `cannot find function build_budget_template_export_json` / `export_template_file_name` / `ensure_json_extension` |
| `cargo check --all-targets` (after Tasks 1–3, before command) | 7 `never used` warnings — the expected pre-registration dead-code state |
| `cargo check --all-targets` (final) | `Finished dev profile` — **0 warnings** |
| `cargo clippy --all-targets -- -D warnings` (final) | `Finished dev profile` — **0 warnings** |
| `cargo test` (final) | **241 passed**; 0 failed; 0 ignored |
| `cargo test export_` | **16 passed**; 0 failed (225 filtered out) |
| `cargo test rollback_leaves_no_rows` | **1 passed** — pre-existing rollback guarantee intact |

`cargo fmt` is not installed on this toolchain (same environment limitation recorded in Story 23.1); style was hand-matched to the surrounding file and Clippy was relied on instead.

`tsc --noEmit` was **not** run: `git status --short -- apps/desktop/src apps/desktop/tests apps/web packages` is empty, so no frontend file was touched (this story is backend-only by design).

### Completion Notes List

**Prerequisite check (Task 0).** Both predecessors are implemented and uncommitted on `master`. 24.1's actual names all match this story's assumptions: `validate_budget_template` (private `fn`, same module → directly callable), `apply_budget_template_json`, `SUPPORTED_TEMPLATE_FORMAT_VERSION`, `MAX_TEMPLATE_NAME_LEN`, `MAX_TEMPLATE_CATEGORIES`, `MSG_INVALID_FILE`, `template_test_db()`. 24.2 had already added `pub mod budget_template;` to `commands/mod.rs` and `commands::budget_template::import_budget_template,` to `lib.rs`, so `commands/mod.rs` was **not** touched by this story.

**Deviations from the story's literal instructions (all deliberate, none affecting an AC):**

1. **Test seed helpers renamed to avoid a collision.** Task 6 specifies `seed_group(conn, name) -> i64` and `seed_category(...)`, but 24.1's test module already defines `fn seed_group(conn: &Connection, name: &str)` (raw SQL, returns `()`), and three existing tests depend on it. Adding the story's version would have shadowed and broken them. The new helpers are `seed_budget_group(conn, name) -> i64` and `seed_budget_category(conn, group_id, name, target_cents)`, both built on `budget_db::create_budget_group`/`create_budget_category` exactly as specified. The pre-existing `seed_group` is untouched and still used by `export_group_without_categories_errors`.
2. **`expect_file_error` generalized from `Result<ApplyBudgetTemplateResult, _>` to `Result<T: Debug, _>`.** The export builder returns `Result<String, AppError>`, so the existing helper could not accept it. Making it generic reuses one assertion helper instead of adding a near-duplicate `expect_export_error`. This is a strict type generalization — the helper still asserts the `AppError::File` variant *and* exact message equality, every existing call site compiles unchanged, and no existing test was weakened.
3. **`MSG_INVALID_FILE` / `MSG_VERSION_TOO_NEW` left private.** The anticipated follow-up of making them `pub` proved unnecessary — this story's code never references them.
4. **`info!` (already-imported) used instead of fully-qualified `tracing::info!`.** Task 4 suggested fully-qualifying to avoid a possibly-unused `use`, but 24.2's `use tracing::info;` is already present *and* used, so the short form is both warning-free and consistent with the file. `chrono::Local` is fully qualified as specified (no new `use` line), matching `backup.rs:39`.
5. **Two tests added beyond Task 6's matrix.** `export_trims_group_and_category_names` (AC #3's trim clause was otherwise unasserted) and `export_group_without_categories_errors` (AC #4 + #5 interaction: a group row with *zero* categories ever, distinct from the soft-delete case). 16 new tests total against the matrix's 14.
6. **One assertion added to `export_json_strips_all_amounts`** proving `"target_cents": null` is emitted *present-and-null* rather than silently omitted. AC #2 accepts either, but the literal check also guards the Dev-Notes prohibition on adding `skip_serializing_if` to 24.1's shared types — a change that would otherwise make an amount leak invisible to the digit-sequence assertions.

**Implementation summary.**

- `db/budget_template.rs`: added `DEFAULT_EXPORT_TEMPLATE_NAME` (pub), `MSG_NOTHING_TO_EXPORT`, `MSG_EXPORT_NOT_PORTABLE`; widened the module imports to `std::borrow::Cow`, `std::path::{Path, PathBuf}`, and `TemplateCategoryDef`/`TemplateGroupDef`. Added `build_budget_template_export_json` (reads `get_budget_groups` + `get_all_budget_categories` — no new SQL; strips amounts by construction; skips categoryless groups; fails fast with `MSG_NOTHING_TO_EXPORT`; self-checks via `validate_budget_template` and downgrades its message to `MSG_EXPORT_NOT_PORTABLE` behind a `tracing::warn!`), plus `export_template_file_name`, private `slugify_template_name`, and `ensure_json_extension`.
- `commands/budget_template.rs`: added local `BudgetTemplateExportResult { path: String }` (`#[derive(Serialize)]`, mirroring `backup.rs`'s `BackupResult`) and `export_budget_template`. The `DbState` guard lives in an explicit `{ }` scope that ends **before** `blocking_save_file()`, so the DB lock is never held across the native dialog.
- `lib.rs`: registered `commands::budget_template::export_budget_template,` directly after 24.2's `import_budget_template,`.

**No `#[allow(dead_code)]` added.** All seven new items are reached from the registered command, so the final `cargo check --all-targets` is clean without any allowance. `apply_system_budget_template`'s existing allowance (Story 25.1's) was left untouched.

**Read-only confirmed by test, not by assumption.** `export_writes_no_rows` asserts `audit_log` stays at 0 rows and the group/category counts are unchanged after an export (AC #12, Conflict C).

**Round trip closed.** `export_json_round_trips_through_apply` exports a 2-group / 4-category budget and applies the resulting JSON into a second fresh DB through 24.1's `apply_budget_template_json`, asserting `groups_created == 2`, `categories_created == 4`, `skipped_groups.is_empty()` (AC #7).

**Scope confirmed clean.** `db/budget.rs`, `db/audit.rs`, `error.rs`, `models/mod.rs`, `commands/backup.rs`, `commands/mod.rs`, `maintenance/`, `Cargo.toml`, `migrations/`, all of `apps/desktop/src/**`, `locales/*.json`, and `apps/desktop/tests/**` are all unmodified by this story. Nothing was committed.

**Flagged for Story 25.3's UX review** (unchanged from the story's UX Note): `MSG_NOTHING_TO_EXPORT` and `MSG_EXPORT_NOT_PORTABLE` exist only as English strings in Rust and need an i18n decision; the exported template `name` is still the hardcoded `"My Budget"`; and the frontend must type this command as `{ path: string } | null`.

### File List

- `apps/desktop/src-tauri/src/db/budget_template.rs` (modified)
- `apps/desktop/src-tauri/src/commands/budget_template.rs` (modified)
- `apps/desktop/src-tauri/src/lib.rs` (modified)

## Change Log

- 2026-08-04: Story context created (ready-for-dev).
- 2026-08-04: Implemented export document builder, filename/extension helpers, and the `export_budget_template` command with 16 new unit tests. `cargo check --all-targets` and `cargo clippy --all-targets -- -D warnings` clean; `cargo test` 241 passed (baseline 225). Status → review.
- 2026-08-04: Code review. 1 decision-needed, 2 patches auto-applied (`ensure_json_extension` dotfile double-extension fix + doc-comment scope clarification), 1 deferred (async dialog blocking, pre-existing), 4 dismissed (spec-matching/out-of-scope). `cargo check --all-targets`/`cargo clippy --all-targets -- -D warnings` clean; `cargo test` 241/241 pass post-patch. Status → in-progress pending the decision-needed finding.
- 2026-08-04: Decision resolved — `ensure_json_extension` post-dialog overwrite finding accepted as-is and deferred (logged in `deferred-work.md`); matches `commands/backup.rs` precedent, impact bounded to a template file (not live budget data), proper fix belongs with a broader save-dialog UX pass. All review findings now resolved (fixed, deferred, or dismissed). `cargo check --all-targets` and `cargo clippy --all-targets -- -D warnings` clean; `cargo test` 241/241 pass. Status → done.
