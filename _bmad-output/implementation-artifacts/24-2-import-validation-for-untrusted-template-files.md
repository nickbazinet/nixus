---
baseline_commit: 1bc542762f39223e091c1f9d297fd2b0b8e9cc3e
---

# Story 24.2: Import Validation for Untrusted Template Files

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want defensive validation of imported template files before any database write,
so that malformed or adversarial community-shared files cannot corrupt the user's budget.

**Scope:** Rust backend only — new `commands/budget_template.rs` (`import_budget_template` command with the Rust-side file dialog), a new file-boundary layer `import_budget_template_from_path` in the **existing** `db/budget_template.rs` (created by Story 24.1), `commands/mod.rs` + `lib.rs` registration, and the exhaustive per-rule negative-test matrix. **No frontend, no hook, no i18n, no export, no system templates, no migration.**

**FRs:** FR96 (import + defensive validation portion) · **NFRs:** NFR11 (never silently lose/corrupt records), NFR6 (no new sensitive-data storage)
**Epic:** [epics-budget-templates.md § Epic 24, Story 24.2](../planning-artifacts/epics-budget-templates.md)
**Architecture:** [architecture-budget-templates.md](../planning-artifacts/architecture-budget-templates.md) — **Decision 4** (defensive import validation), Decision 3 (schema), Decision 5 (audit), § Implementation Patterns, § Project Structure
**Predecessor:** [Story 24.1](24-1-template-schema-models-core-apply-function.md) — binding prior art for types, constants, and message strings

---

## ⛔ HARD PREREQUISITE — READ FIRST

**Story 24.1 must be implemented before this story starts.** Verified as of story creation: `apps/desktop/src-tauri/src/db/budget_template.rs` does **not** exist, and `models/mod.rs` does **not** yet contain `SystemBudgetTemplate` / `TemplateGroupDef` / `TemplateCategoryDef` / `ApplyBudgetTemplateResult`.

**Before writing any code, run:**

```bash
ls apps/desktop/src-tauri/src/db/budget_template.rs
grep -n "ApplyBudgetTemplateResult" apps/desktop/src-tauri/src/models/mod.rs
```

If either is missing → **STOP and report that Story 24.1 is not done.** Do **not** implement 24.1's contents here. This story only *adds to* `db/budget_template.rs`; it does not create it.

---

## Acceptance Criteria

1. **Given** `apps/desktop/src-tauri/src/commands/budget_template.rs` (new file)
   **When** this story is implemented
   **Then** it defines `pub async fn import_budget_template(app_handle: AppHandle) -> Result<Option<ApplyBudgetTemplateResult>, AppError>` with `#[tauri::command(rename_all = "snake_case")]`
   **And** it opens a native open dialog via `tauri_plugin_dialog::DialogExt` `blocking_pick_file()` filtered to `json` files (mirroring `commands/backup.rs::import_backup`)
   **And** `pub mod budget_template;` is added to `commands/mod.rs` immediately after `pub mod budget;`
   **And** `commands::budget_template::import_budget_template` is registered in `lib.rs`'s `tauri::generate_handler!` immediately after `commands::budget::get_all_budget_categories`

2. **Given** the user cancels the open dialog
   **When** `blocking_pick_file()` returns `None` (or the returned `FilePath::as_path()` is `None`)
   **Then** the command returns `Ok(None)` — no error, no file read, no DB write, no audit row
   *(Resolves the architecture-vs-requirements conflict: see Dev Notes §Conflict A)*

3. **Given** a template file with structurally invalid JSON (fails `SystemBudgetTemplate` deserialization for any reason — malformed syntax, missing `format_version`, `format_version` not an integer, `target_cents` exceeding `i64`, nesting beyond serde_json's recursion limit, wrong field types)
   **When** `import_budget_template` processes it
   **Then** the command returns `AppError::File { message: MSG_INVALID_FILE }` (`"This file is not a valid Nixus budget template."`)
   **And** zero rows exist in `budget_groups`, `budget_categories`, and `audit_log`

4. **Given** a template file whose `format_version` is greater than `SUPPORTED_TEMPLATE_FORMAT_VERSION` (e.g. `2`, `99`)
   **When** `import_budget_template` processes it
   **Then** the command returns `AppError::File { message: MSG_VERSION_TOO_NEW }` (`"This template was created with a newer version of Nixus. Please update the app."`)
   **And** no database write occurs

5. **Given** a template file whose `format_version` is `0` or negative
   **When** `import_budget_template` processes it
   **Then** the command returns `AppError::File { message: MSG_INVALID_FILE }` — **not** the version-too-new message
   **And** a template file with `format_version` **absent** also yields `MSG_INVALID_FILE`, produced by deserialization failure (the field has no `#[serde(default)]`) — no extra branch is needed for the absent case

6. **Given** a template file with a group or category `name` that is empty or whitespace-only
   **When** validated
   **Then** the import is rejected with `AppError::File` **before any DB write**, and zero rows exist in `budget_groups` / `budget_categories` / `audit_log`

7. **Given** a template file with a group or category `name` whose `trim().chars().count()` exceeds `MAX_TEMPLATE_NAME_LEN` (`100`)
   **When** validated
   **Then** the import is rejected with `AppError::File`
   **And** a name of exactly `100` **multibyte** characters (e.g. accented or CJK, whose UTF-8 byte length exceeds 100) is **accepted** — the bound is characters, not bytes

8. **Given** a template file with a `target_cents` that is negative, or greater than `MAX_TEMPLATE_TARGET_CENTS` (`100_000_000`)
   **When** validated
   **Then** the import is rejected with `AppError::File`
   **And** a `target_cents` of exactly `100_000_000` is accepted (inclusive upper bound)

9. **Given** a template file with `target_cents` explicitly set to `0` (a legal value per Decision 4's "non-negative" rule)
   **When** applied
   **Then** the category is created with `DEFAULT_TEMPLATE_TARGET_CENTS` (`100`) — identical treatment to `null`/absent
   **And** the import does **not** surface `AppError::Validation { message: "Target must be greater than 0" }` from `create_budget_category`
   **And** `db/budget.rs` is **not** modified
   *(Resolves a latent defect in 24.1's `unwrap_or`: see Dev Notes §Conflict B)*

10. **Given** a template file with an empty `groups` array, or any group with an empty `categories` array
    **When** validated
    **Then** the import is rejected with `AppError::File` before any DB write

11. **Given** a template file with more than `MAX_TEMPLATE_CATEGORIES` (`100`) categories in total across all groups
    **When** validated
    **Then** the import is rejected with `AppError::File`
    **And** a file with exactly `100` categories is accepted (inclusive bound)

12. **Given** a file on disk whose size exceeds `MAX_TEMPLATE_FILE_BYTES`
    **When** `import_budget_template_from_path` runs
    **Then** the file is rejected with `AppError::File { message: MSG_INVALID_FILE }` **without** being read into memory — the size is checked via `std::fs::metadata` **before** `read_to_string`
    *(New guard introduced by this story: Decision 4 caps categories but nothing capped bytes — see Dev Notes §Conflict C)*

13. **Given** a file that is not valid UTF-8 (arbitrary binary content)
    **When** read
    **Then** the `std::io::ErrorKind::InvalidData` read failure maps to `AppError::File { message: MSG_INVALID_FILE }`
    **And** any other IO failure (missing file, permission denied) maps to `AppError::File { message: format!("Failed to read template file: {e}") }`

14. **Given** a valid template file saved with a UTF-8 byte-order mark (`\u{FEFF}`, as produced by Windows Notepad)
    **When** parsed
    **Then** the leading BOM is stripped before `serde_json::from_str` and the import succeeds — a BOM alone must not make a valid template unimportable

15. **Given** a valid template file that passes every check
    **When** `import_budget_template` completes
    **Then** it returns `Ok(Some(ApplyBudgetTemplateResult { .. }))` with accurate `groups_created` / `categories_created` / `skipped_groups`
    **And** validation completed **fully** before `apply_budget_template_json` opened its transaction (asserted structurally: every rejection test above proves zero rows)
    **And** exactly **one** `audit_log` row exists — written by 24.1's shared primitive with `entity_type: "budget_template"`, `action: "apply"`, `entity_id: 0`, `new_value` containing `"source":"import"`
    **And** `commands/budget_template.rs` contains **no** `insert_audit_log` call of its own

16. **Given** `apply_budget_template_json` now has a real non-test caller
    **When** this story lands
    **Then** the `#[allow(dead_code)]` that Story 24.1 placed on `apply_budget_template_json` is **removed**
    **And** the `#[allow(dead_code)]` on `apply_system_budget_template` is **left in place** (still unused until Story 25.1)
    **And** `cd apps/desktop/src-tauri && cargo check` produces **zero warnings**

17. **Given** the Rust backend
    **When** `cd apps/desktop/src-tauri && cargo test` runs
    **Then** all pre-existing tests (including Story 24.1's) still pass **and** every new negative/positive case in the matrix below passes

---

## Tasks / Subtasks

- [x] **Task 0: Confirm prerequisite** (see ⛔ HARD PREREQUISITE)
  - [x] `ls apps/desktop/src-tauri/src/db/budget_template.rs` → must exist
  - [x] Read the existing `db/budget_template.rs` end-to-end: note the exact names of `validate_budget_template`, `apply_budget_template_json`, the five `pub const`s, `MSG_INVALID_FILE`, `MSG_VERSION_TOO_NEW`, and the `template_test_db()` test helper
  - [x] If 24.1 named anything differently than this story assumes, **use 24.1's actual names** and note the deviation in Completion Notes

- [x] **Task 1: Add the file-boundary layer to `db/budget_template.rs`** (AC: #12, #13, #14, #3)
  - [x] Add `pub const MAX_TEMPLATE_FILE_BYTES: u64 = 1_048_576;` next to 24.1's existing constants
  - [x] Add `use std::path::Path;` to the module's imports
  - [x] Implement:
    ```rust
    pub fn import_budget_template_from_path(
        conn: &Connection,
        path: &Path,
    ) -> Result<ApplyBudgetTemplateResult, AppError> {
    ```
  - [x] Step 1 — size guard **before** any read: `std::fs::metadata(path)`, map IO error via `format!("Failed to read template file: {e}")`; if `.len() > MAX_TEMPLATE_FILE_BYTES` → `AppError::File { message: MSG_INVALID_FILE.to_string() }`
  - [x] Step 2 — read: `std::fs::read_to_string(path)`, mapping `e.kind() == std::io::ErrorKind::InvalidData` → `MSG_INVALID_FILE`, all other kinds → `format!("Failed to read template file: {e}")`
  - [x] Step 3 — strip BOM: `let json = contents.trim_start_matches('\u{feff}');`
  - [x] Step 4 — delegate: `apply_budget_template_json(conn, json)` (do **not** re-implement deserialization or validation here)
  - [x] Add a WHY comment on the size guard: untrusted community file, guard against unbounded `read_to_string`

- [x] **Task 2: Fix the `target_cents: Some(0)` path in the existing apply core** (AC: #9)
  - [x] In `apply_template_inner`, change the target resolution from `c.target_cents.unwrap_or(DEFAULT_TEMPLATE_TARGET_CENTS)` to:
    ```rust
    // Decision 4 accepts target_cents == 0 as valid input, but create_budget_category
    // rejects <= 0 — normalize 0 exactly like null so a legal file never surfaces a
    // confusing AppError::Validation from the DB layer.
    let target_cents = c
        .target_cents
        .filter(|cents| *cents > 0)
        .unwrap_or(DEFAULT_TEMPLATE_TARGET_CENTS);
    ```
  - [x] Do **not** change `validate_budget_template`'s accepted range (`0..=MAX_TEMPLATE_TARGET_CENTS` stays — rejecting `0` would contradict Decision 4)
  - [x] Do **not** modify `db/budget.rs`

- [x] **Task 3: Remove the now-obsolete dead-code allowance** (AC: #16)
  - [x] Delete `#[allow(dead_code)]` + its WHY comment from `apply_budget_template_json` (this story is its first real caller)
  - [x] Leave `#[allow(dead_code)]` on `apply_system_budget_template` untouched (Story 25.1 owns it)

- [x] **Task 4: Create `commands/budget_template.rs`** (AC: #1, #2, #15)
  - [x] Imports (mirror `commands/backup.rs` lines 1-10):
    ```rust
    use tauri::{AppHandle, Manager};
    use tauri_plugin_dialog::DialogExt;

    use crate::db::budget_template as budget_template_db;
    use crate::db::DbState;
    use crate::error::AppError;
    use crate::models::ApplyBudgetTemplateResult;
    ```
  - [x] Signature: `#[tauri::command(rename_all = "snake_case")] pub async fn import_budget_template(app_handle: AppHandle) -> Result<Option<ApplyBudgetTemplateResult>, AppError>`
  - [x] Dialog **first**, before touching `DbState` (never hold the mutex across a blocking dialog):
    ```rust
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
    ```
  - [x] Then lock state and delegate:
    ```rust
    let db_state = app_handle.state::<DbState>();
    let conn = db_state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let result = budget_template_db::import_budget_template_from_path(&conn, &selected_path)?;
    Ok(Some(result))
    ```
  - [x] **No `insert_audit_log` call here** — 24.1's primitive already writes exactly one row (AC #15). Add a WHY comment stating this so a future reader does not "fix" the apparent omission against `project-context.md` §3
  - [x] Optionally `tracing::info!` the applied counts (mirrors `backup.rs`'s `info!`); never `println!`

- [x] **Task 5: Register the module and the command** (AC: #1)
  - [x] `commands/mod.rs`: insert `pub mod budget_template;` between `pub mod budget;` and `pub mod chat;`
  - [x] `lib.rs`: insert `commands::budget_template::import_budget_template,` in `tauri::generate_handler!` directly after `commands::budget::get_all_budget_categories,` and before `commands::expense::create_expense,`
  - [x] Confirm `tauri_plugin_dialog::init()` is already registered in `lib.rs` (it is) — add nothing to `Cargo.toml`

- [x] **Task 6: Negative/positive test matrix** (AC: #3–#14, #17)
  - [x] Extend the **existing** `#[cfg(test)] mod tests` in `db/budget_template.rs` — reuse 24.1's `template_test_db()`, do **not** define a second helper
  - [x] Add `use tempfile::NamedTempFile;` (crate `tempfile = "3"` is already a dependency; `commands/backup.rs` tests use it)
  - [x] Add one local helper:
    ```rust
    fn write_template_file(contents: &str) -> NamedTempFile {
        use std::io::Write;
        let mut f = NamedTempFile::new().unwrap();
        f.write_all(contents.as_bytes()).unwrap();
        f.flush().unwrap();
        f
    }
    ```
  - [x] Add a second helper asserting the no-write invariant, used by **every** rejection test:
    ```rust
    fn assert_no_rows(conn: &Connection) {
        for table in ["budget_groups", "budget_categories", "audit_log"] {
            let n: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0, "{table} should be empty");
        }
    }
    ```
  - [x] Assert exact messages by matching the variant, mirroring `db/budget.rs:511-517`:
    ```rust
    match err {
        AppError::File { message } => assert_eq!(message, MSG_INVALID_FILE),
        other => panic!("expected file error, got {other:?}"),
    }
    ```
  - [x] Write these tests (each rejection test calls `assert_no_rows`):

  | Test fn | Input | Expected |
  |---|---|---|
  | `import_file_malformed_json` | `"{ not json"` | `MSG_INVALID_FILE` |
  | `import_file_empty` | `""` | `MSG_INVALID_FILE` |
  | `import_file_missing_format_version` | valid doc minus `format_version` | `MSG_INVALID_FILE` |
  | `import_file_format_version_zero` | `format_version: 0` | `MSG_INVALID_FILE` |
  | `import_file_format_version_negative` | `format_version: -1` | `MSG_INVALID_FILE` |
  | `import_file_format_version_too_new` | `format_version: 2` and `99` | `MSG_VERSION_TOO_NEW` |
  | `import_file_format_version_not_integer` | `format_version: "1"`, then `1.5` | `MSG_INVALID_FILE` |
  | `import_file_blank_group_name` | group `name: "   "` | `AppError::File` |
  | `import_file_blank_category_name` | category `name: ""` | `AppError::File` |
  | `import_file_group_name_too_long` | 101-char group name | `AppError::File` |
  | `import_file_category_name_too_long` | 101-char category name | `AppError::File` |
  | `import_file_name_100_multibyte_chars_ok` | 100 × `'é'` category name | **Ok**, category created |
  | `import_file_negative_target` | `target_cents: -1` | `AppError::File` |
  | `import_file_target_above_max` | `target_cents: 100_000_001` | `AppError::File` |
  | `import_file_target_at_max_ok` | `target_cents: 100_000_000` | **Ok** |
  | `import_file_target_exceeds_i64` | `target_cents: 99999999999999999999` | `MSG_INVALID_FILE` (serde) |
  | `import_file_zero_target_uses_default` | `target_cents: 0` | **Ok**, stored `target_cents == DEFAULT_TEMPLATE_TARGET_CENTS` |
  | `import_file_empty_groups` | `groups: []` | `AppError::File` |
  | `import_file_group_with_no_categories` | one group, `categories: []` | `AppError::File` |
  | `import_file_over_category_cap` | 101 categories total across 2 groups | `AppError::File` |
  | `import_file_at_category_cap_ok` | exactly 100 categories | **Ok**, `categories_created == 100` |
  | `import_file_too_large` | file > `MAX_TEMPLATE_FILE_BYTES` | `MSG_INVALID_FILE` |
  | `import_file_not_utf8` | raw bytes `[0xFF, 0xFE, 0x00]` (write via `write_all` on a `NamedTempFile`) | `MSG_INVALID_FILE` |
  | `import_file_missing_path` | path to a nonexistent file | `AppError::File`, message contains `"Failed to read template file"` |
  | `import_file_with_bom_ok` | `"\u{feff}"` + valid doc | **Ok** |
  | `import_file_valid_writes_one_audit_row` | valid doc | `Ok`, `audit_log` count `== 1`, `new_value` contains `"source":"import"`, `entity_type == "budget_template"`, `action == "apply"`, `entity_id == 0` |

- [x] **Task 7: Verification** (AC: #16, #17)
  - [x] `cd apps/desktop/src-tauri && cargo check` → **zero warnings**
  - [x] `cd apps/desktop/src-tauri && cargo test` → all pass; record the new total in Completion Notes (do not hardcode an expected count)
  - [x] Confirm untouched: `db/budget.rs`, `db/audit.rs`, `error.rs`, `models/mod.rs`, `commands/backup.rs`, all of `apps/desktop/src/**`, `locales/*.json`, `migrations/`
  - [x] `git diff --stat` should show exactly: `commands/budget_template.rs` (new), `commands/mod.rs`, `lib.rs`, `db/budget_template.rs`

---

## Dev Notes

### Critical Rules (DO NOT VIOLATE)

1. **Do not re-implement Story 24.1.** `validate_budget_template`, `apply_budget_template_json`, `apply_template_inner`, the five constants, and both message constants already exist. This story adds a **file boundary** on top and a **command** on top of that. [Source: 24-1 §Scope Boundary vs. Story 24.2]
2. **`db/budget.rs`, `db/audit.rs`, `error.rs` are read-only.** No new `AppError` variant, no relaxed `create_budget_category` validation, no raw `INSERT`. [Source: architecture-budget-templates.md § Files explicitly NOT modified, § Enforcement Guidelines]
3. **All validation before any DB write.** Never `?`-into a transaction and hope for rollback as the *primary* guarantee — validation is the guarantee, rollback is the backstop. Every rejection test asserts zero rows. [Source: Decision 4]
4. **Exactly one audit row per apply, written by the `db/` primitive.** The command adds none. This is an intentional, documented deviation from `project-context.md` §3 ("commands write the audit log"), inherited from 24.1 AC #6. [Source: 24-1 §Audit Pattern]
5. **Zero compilation warnings.** [Source: docs/project-context.md §9, docs/guidelines/warnings.md]
6. **No frontend, no i18n, no export, no `SYSTEM_TEMPLATES`, no migration in this story.**
7. **Never surface raw filesystem paths or serde error text to the user.** The two canned messages exist precisely so an adversarial file cannot control user-visible copy. Only the generic `"Failed to read template file: {e}"` includes OS text, and only for genuine IO faults.

### Three Conflicts Resolved Here (Binding — Do Not Re-derive)

**Conflict A — `import_budget_template`'s return type cannot be non-optional.**
Architecture § API & Communication Patterns specifies `import_budget_template() -> Result<ApplyBudgetTemplateResult, AppError>`, but epic Story 24.4 requires "the user cancels the open dialog → returns without error and performs no import." Those are incompatible: a cancelled dialog has no result to return and must not be an error.
**Resolution:** `Result<Option<ApplyBudgetTemplateResult>, AppError>`, `Ok(None)` on cancel. This matches the established codebase precedent exactly — `commands/backup.rs::export_backup` is `Result<Option<BackupResult>, AppError>` returning `Ok(None)` on cancel (`backup.rs:17`, `:50`). The frontend contract in Story 25.2 must type this as `ApplyBudgetTemplateResult | null`.

**Conflict B — `target_cents: Some(0)` is valid input but crashes the apply.**
Decision 4 says `target_cents` must be "non-negative", and 24.1's `validate_budget_template` accordingly accepts `0..=MAX_TEMPLATE_TARGET_CENTS`. But 24.1's Task 4 resolves the value with `c.target_cents.unwrap_or(DEFAULT_TEMPLATE_TARGET_CENTS)` — which passes `Some(0)` straight through as `0`, and `db/budget.rs:78-83` rejects `target_cents <= 0` with `AppError::Validation { message: "Target must be greater than 0", field: Some("target_cents") }`. Result: a *legal* file fails mid-transaction with a `validation` error the frontend does not expect from an import, instead of a clean `file` error or a successful apply.
**Resolution:** `.filter(|cents| *cents > 0).unwrap_or(DEFAULT_TEMPLATE_TARGET_CENTS)` — treat `0` exactly like `null`. Chosen over "reject `0` in validation" because rejecting it would contradict Decision 4's explicit "non-negative" wording. `db/budget.rs` stays untouched. AC #9 + test `import_file_zero_target_uses_default` lock this.

**Conflict C — Decision 4 caps categories but nothing caps file size.**
`read_to_string` on an untrusted file is unbounded: a 2 GB file would be fully buffered into memory before the 100-category cap could ever apply. Decision 4's stated intent ("guard against malformed or adversarial files") is not met by a category cap alone.
**Resolution:** this story introduces `MAX_TEMPLATE_FILE_BYTES: u64 = 1_048_576` (1 MiB) checked via `std::fs::metadata().len()` **before** the read. Headroom is ~100×: 100 categories of realistic JSON is roughly 8 KB. This is a *new* constant for the file layer and does not contradict 24.1's "do not invent other constants" (which scoped 24.1's own validation constants; file I/O is this story's responsibility per architecture § Project Structure, which assigns "export/import file I/O" to `db/budget_template.rs`). `std::fs::metadata` has precedent in `commands/import.rs`.

### Serde Behaviours You Can Rely On (do not add redundant branches)

Confirmed against `serde` 1.0.228 / `serde_json` 1.0.150 and 24.1's type definitions:

| Input | Outcome | Why |
|---|---|---|
| `format_version` absent | deserialization error → `MSG_INVALID_FILE` | no `#[serde(default)]` on the field (24.1 AC #2) |
| `format_version: "1"` or `1.5` | deserialization error → `MSG_INVALID_FILE` | field is `i32`; serde_json rejects string/float for integers |
| `target_cents` > `i64::MAX` | deserialization error → `MSG_INVALID_FILE` | field is `Option<i64>`; the bounds check never sees it |
| unknown extra fields | **ignored, import succeeds** | no `#[serde(deny_unknown_fields)]` — this is the desired forward compatibility for `format_version: 1` readers |
| nesting > 128 levels | deserialization error → `MSG_INVALID_FILE` | serde_json's default recursion limit; no stack overflow |
| duplicate JSON keys | last value wins, no error | serde_json default; accepted, not a corruption risk here |
| leading UTF-8 BOM | **would fail** without the explicit strip | serde_json does not skip a BOM — hence AC #14 |

Because `format_version` absent and `format_version: 0` both land on `MSG_INVALID_FILE`, the epic's "generic invalid-file message for missing/zero" needs **no** dedicated code path — deserialization covers "missing", 24.1's validator covers "zero". Do not add a pre-parse `serde_json::Value` peek.

### Existing Code to Extend (DO NOT REINVENT)

| Item | File:line | Exact fact |
|---|---|---|
| `AppError::File` | `error.rs:9` | `File { message: String }` — plain owned `String`, **not** `Cow`, not a tuple variant. `AppError` is a hand-rolled enum with manual `Display`/`Serialize`/`Error` impls — **`thiserror` is not used**; do not add a derive |
| `AppError` serialization | `error.rs:31-90` | `File` → `{ "type": "file", "message": "..." }` via `SerializeMap` |
| `From<rusqlite::Error>` | `error.rs:92-97` | `?` auto-converts rusqlite errors to `AppError::Database`; `Mutex` poison has **no** `From` — always `.map_err` it inline |
| `AppError::File` construction style | `db/mod.rs:57`, `ai/cc_parser.rs:125`, `maintenance/catalog.rs:159` | always `AppError::File { message: format!("...: {}", e) }` — no constructor helper, no `.into()` |
| Dialog command shape | `commands/backup.rs:17-68` (`export_backup`), `:70-167` (`import_backup`) | **only** dialog usage in the whole Rust tree. `async fn` + `AppHandle` (not `State<DbState>`); `use tauri::{AppHandle, Manager}; use tauri_plugin_dialog::DialogExt;`; DB state fetched via `app_handle.state::<DbState>()` |
| Cancel idiom | `commands/backup.rs:50-58`, `:79-87` | double `match`: `blocking_pick_file()` → `Option<FilePath>`, then `FilePath::as_path()` → `Option<&Path>`. Both `None` arms `return Ok(<sentinel>)` |
| Mutex lock idiom | `commands/budget.rs` (9× verbatim) | `let conn = state.0.lock().map_err(\|e\| AppError::Database { message: e.to_string() })?;` |
| `insert_audit_log` | `db/audit.rs:5` | `(conn, entity_type: &str, entity_id: i64, action: &str, old_value: Option<&str>, new_value: Option<&str>)` — **positional order is entity_type, entity_id, action**. Not called by this story |
| Non-fatal audit idiom | `commands/account.rs:30-33` | `if let Err(e) = ... { tracing::error!("Failed to write audit log: {}", e); }`. `commands/import.rs:433`'s `?` form is an outlier — do not copy |
| `std::fs::metadata` precedent | `commands/import.rs` | `std::fs::metadata(&file_path).map_err(\|e\| AppError::File { .. })?` |
| Test DB helper | `db/budget_template.rs` (`template_test_db()`, added by 24.1) | Hand-rolled DDL on `Connection::open_in_memory()`; includes `budget_groups`, `budget_categories`, `audit_log`. **No migration-based test harness exists anywhere** — do not look for one |
| `tempfile` in tests | `commands/backup.rs:215-276` | `tempfile = "3"` already a dependency; `NamedTempFile` used in 5 existing tests |

**`&tx` is accepted anywhere `&Connection` is expected** (`rusqlite::Transaction: Deref<Target = Connection>`), per `db/expense.rs:59-107`.

### Registration — Exact Insertion Points

`commands/mod.rs` (alphabetical, 19 `pub mod` lines):
```rust
pub mod budget;
pub mod budget_template;   // <-- add here
pub mod chat;
```

`lib.rs` `tauri::generate_handler!` (90 commands, grouped by domain — **not** globally alphabetical; keep budget commands contiguous):
```rust
    commands::budget::get_all_budget_categories,
    commands::budget_template::import_budget_template,   // <-- add here
    commands::expense::create_expense,
```

`tauri_plugin_dialog::init()` is already registered (`lib.rs:20`). `tauri-plugin-dialog = "2.7.0"` (Cargo.lock resolves `2.7.1`) is already in `Cargo.toml:30`. **No dependency changes in this story.**

### Command Attribute Decision

Use `#[tauri::command(rename_all = "snake_case")]`. `project-context.md` §2 states every command MUST carry it; it is a no-op for a command whose only parameter is the injected `AppHandle`. Note that `backup.rs`'s two dialog commands use bare `#[tauri::command]` — the stricter form is chosen here to satisfy the explicit project rule, and it is behaviourally identical.

### Dead Code (this WILL bite you)

`mod db;` is private in `lib.rs`, so unreferenced `pub fn`s in `db/*.rs` still trigger `dead_code`, and `#[cfg(test)]` usage does **not** suppress it under plain `cargo check`.

- `apply_budget_template_json` gains its first non-test caller here → **remove** 24.1's `#[allow(dead_code)]` (AC #16). Leaving a stale allowance is not a warning, but it is misleading and contradicts `warnings.md`'s "add an ignore only if it is used [later]" intent.
- `apply_system_budget_template` is still uncalled until Story 25.1 → **keep** its allowance.
- `import_budget_template_from_path` is called by the new command → no allowance needed.
- `MAX_TEMPLATE_FILE_BYTES` is used inside `import_budget_template_from_path` → no allowance needed.
- Tauri's `generate_handler!` counts as a use, so the registered command will not warn even though no frontend calls it until Story 24.4.
- Never delete code to silence a warning — everything here is consumed by 24.3 / 24.4 / 25.x.

### Scope Boundary vs. Story 24.4 (binding)

Epic Story 24.4's ACs restate the dialog, the cancel path, and the error path. Those are **implemented here** and become *verification-only* in 24.4. Rationale: epic 24.2's own ACs are phrased against the `import_budget_template` **command** ("the command returns `AppError::File { .. }`"), so the command must exist and be registered in this story; a registered Tauri command needs a file source, and architecture § API & Communication Patterns mandates a **Rust-side** dialog. Story 24.1's binding split likewise assigns "the `import_budget_template` command, file reading, surfacing the messages over IPC, and the exhaustive per-rule negative test matrix" to 24.2.

**Story 24.4 therefore owns (do not build any of it here):** `useImportBudgetTemplate()`, `lib/types.ts` shapes, `queryKeys` invalidation of `budgetGroups` / `allBudgetCategories` / `budgetStatus`, the `YourDataSettings.tsx` button wiring, the skipped-groups toast copy, `locales/en.json` / `fr.json` strings, and `tests/budget-templates.spec.ts`.

### Out of Scope (later stories)

| Item | Story |
|---|---|
| Frontend hook, `lib/types.ts`, `queryKeys.systemBudgetTemplates`, query invalidation | 25.2 (import mutation surface) / 24.4 |
| `YourDataSettings.tsx` wiring, toasts, `locales/en.json` + `fr.json` | 25.3 / 24.4 |
| `export_budget_template`, slugified filename, `blocking_save_file` | 24.3 |
| `budget/template_defaults.rs`, `SYSTEM_TEMPLATES`, `mod budget;` in `lib.rs`, `list_system_templates`, `apply_system_template`, `SystemBudgetTemplateSummary` | 25.1 |
| Onboarding fork starter-template path | 25.4 |
| `tests/budget-templates.spec.ts` Playwright E2E | 24.4 / 25.4 |
| Import **preview/confirmation** UI before applying | Undecided — architecture § Important Gaps; not blocked by this story |
| New migration / `budget_templates` table | Never (Decision 1) |

### Naming Collision Warning

`models/mod.rs:352` already defines `RecurringExpenseTemplate` (a recurring monthly expense rule — `merchant`, `amount_cents`, `budget_category_id`, `day_of_month`) with `db/recurring.rs` + `commands/recurring.rs`. **Unrelated concept.** Never introduce a bare `Template` type; never touch the recurring files. [Source: architecture-budget-templates.md § Technical Constraints]

### Project Structure Notes

- Monorepo path: `apps/desktop/src-tauri/` (`@nkbaz/desktop`). Registration lives in `lib.rs`, not `main.rs`
- `commands/budget_template.rs` confirmed absent at story-creation time; `commands/` currently holds 19 domain modules + `mod.rs`
- `src-tauri/src/budget/` does **not** exist (Story 25.1 creates it) — nothing in this story needs it
- `tests/budget-templates.spec.ts` does **not** exist; 22 Playwright specs exist in `apps/desktop/tests/`
- Latest migration is `022_budget_category_soft_delete.sql`; this story adds none
- Money is always `i64` cents with a `_cents` suffix; never `f64` (NFR13)
- No `clippy.toml`, no `#![deny(warnings)]`, no `rust-toolchain.toml`, and **no `cargo test`/`cargo clippy` step in CI** — the zero-warning rule is enforced procedurally, so run it yourself
- Verify with: `cd apps/desktop/src-tauri && cargo check && cargo test` (per `CONTRIBUTING.md:190-212`). If `cargo fmt` is unavailable in the environment, note it rather than hand-reformatting (as in Story 23.1)

### Previous Story Intelligence (Story 24.1)

24.1 is the direct predecessor and is **also still `ready-for-dev`** — treat its content as a specification, not as verified code. Carry-forwards that directly shape this story:

- **Names/constants are fixed:** `SUPPORTED_TEMPLATE_FORMAT_VERSION = 1`, `MAX_TEMPLATE_NAME_LEN = 100` (**chars** via `.trim().chars().count()`, not bytes), `MAX_TEMPLATE_CATEGORIES = 100`, `MAX_TEMPLATE_TARGET_CENTS = 100_000_000`, `DEFAULT_TEMPLATE_TARGET_CENTS = 100`. Both message strings are asserted by this story's tests — reuse, never retype from memory.
- **`MAX_TEMPLATE_NAME_LEN` is new, not "reused".** 24.1 Conflict 2 established that `db/budget.rs` has **no** length bound at all (only `.trim()` + `.is_empty()`), contradicting architecture Decision 4's "reuse `create_budget_category`'s existing bounds". Independently re-confirmed: no length check and no `target_cents` upper bound exists anywhere in `db/budget.rs`. Do not go looking for one.
- **`Cow<'static, str>` / `Cow<'static, [T]>` field shapes** (24.1 Conflict 3) exist so one schema type is both `const`-constructible for Story 25.1 and `Deserialize`-able from untrusted JSON. When building test JSON or reading names, remember `name` is a `Cow`, so use `&*c.name` / `c.name.trim()` — not `c.name.as_str()` on an `Option`.
- **`budget_groups` has no `UNIQUE` constraint on `name`** and `create_budget_group` performs no duplicate check — collision handling is entirely Rust-side (24.1's job). Do not add a second collision check here.
- **Transaction pattern:** `let tx = conn.unchecked_transaction()?; ... tx.commit()?;` with rollback via `Drop` on early return (`db/expense.rs:59-107`, `db/budget.rs:272`). Already inside 24.1's `apply_template_inner`; this story never opens a transaction of its own.
- **Test conventions:** `#[cfg(test)] mod tests { use super::*; use rusqlite::Connection; }`, hand-rolled in-memory DDL, `assert_eq!`/`assert!`, error assertions via `match err { AppError::X { message, .. } => ..., other => panic!("... {other:?}") }` (`db/budget.rs:511-517`). Baseline was 165 tests as of Story 23.1, plus 24.1's additions.
- **Scope-creep warning inherited from 23.1:** if you find yourself editing `db/budget.rs`, `db/audit.rs`, `error.rs`, `models/mod.rs`, or anything under `apps/desktop/src/`, stop — that is a scope violation, not a necessity.

### Recent Commit Context

`git log` head: `fix(trends): show friendly fallback instead of raw error on AI insight failure`, `fix: AI chat layout + version bump to 0.3.1`, `feat(ui): Implement new UI/UX` ×2, `feat(ui): Small improvements`. Two slightly older commits — `fix(budget): show actionable errors when category delete is blocked` and `fix: where you can't delete a category due to past spending` — touched `db/budget.rs`'s soft-delete path (`db/budget.rs:244-291`). Read but do not modify it. The most recent commit is thematically relevant precedent: the codebase's current direction is **friendly, canned user-facing error copy instead of raw error text** — exactly what `MSG_INVALID_FILE` / `MSG_VERSION_TOO_NEW` deliver here. No template work exists in history; this is greenfield. Working tree currently has untracked planning artifacts only — do not commit anything.

### Latest Tech Information

- `tauri-plugin-dialog` **2.7.0** pinned (2.7.1 resolved). `blocking_pick_file()` / `blocking_save_file()` must not be called from the main thread — they are safe inside a `#[tauri::command] async fn` because Tauri dispatches commands off the main thread. This is why `backup.rs`'s dialog commands are `async` while `budget.rs`'s are sync; follow `backup.rs` here.
- `add_filter(name, &["json"])` sets the extension filter. A filter is a UI hint only — an adversarial or misnamed file can still reach the parser, which is exactly why AC #12/#13 exist. Never treat the `.json` extension as validation.
- `serde` **1.0.228** / `serde_json` **1.0.150**, `rusqlite` **0.38.0** (bundled SQLite), Rust edition **2021**. No new crates.
- `serde_json::from_str` borrows from the input `&str`, but `SystemBudgetTemplate`'s `Cow<'static, …>` fields force owned (`Cow::Owned`) data on deserialization — so the returned value safely outlives the file contents. No lifetime gymnastics required.

### UX Note

No UX-DR covers budget templates (`ux-design-specification.md` predates the 2026-08-01 FR70 amendment). This story is backend-only with no user-visible surface of its own, but it fixes the two user-facing strings that Story 24.4 / 25.3 will display verbatim. Two items to raise at that UX review: (a) an amount-stripped import lands every category at **$1.00** (`DEFAULT_TEMPLATE_TARGET_CENTS`, inherited from 24.1 Conflict 1) and now also does so for an explicit `0`; (b) whether a preview/confirmation step should precede the apply (architecture § Important Gaps — still undecided, and deliberately not resolved here).

### References

- [Source: _bmad-output/planning-artifacts/epics-budget-templates.md — Epic 24 § Story 24.2 (all 8 ACs), Story 24.4 (scope boundary), Requirements Inventory § Additional Requirements]
- [Source: _bmad-output/planning-artifacts/architecture-budget-templates.md — Decision 3 (schema), **Decision 4 (defensive import validation)**, Decision 5 (audit), § API & Communication Patterns, § Implementation Patterns (error messages), § Enforcement Guidelines, § Project Structure & Implementation Map, § Gap Analysis (import-confirmation UX)]
- [Source: _bmad-output/implementation-artifacts/24-1-template-schema-models-core-apply-function.md — §Constants, §Type Definitions, §Three Conflicts, §Scope Boundary vs. Story 24.2, §Dead Code, §Test DB Helper]
- [Source: _bmad-output/planning-artifacts/prd.md — FR96, FR70, FR71, NFR6, NFR11, NFR13]
- [Source: docs/project-context.md — §1 integer cents, §2 Tauri IPC (`rename_all`, `Result<T, AppError>`, `DbState` lock), §3 db/commands separation + audit, §5 `AppError`, §9 warnings policy]
- [Source: docs/guidelines/warnings.md — dead-code resolution policy]
- [Source: apps/desktop/src-tauri/src/error.rs:9,15-27,31-90,92-97 — `AppError::File { message: String }`, hand-rolled `Display`/`Serialize`, `From<rusqlite::Error>`]
- [Source: apps/desktop/src-tauri/src/commands/backup.rs:1-10,17-68,70-167,215-276 — sole dialog precedent: `async fn` + `AppHandle`, `DialogExt`, `blocking_pick_file`, cancel→`Ok(None)`, `tempfile` tests]
- [Source: apps/desktop/src-tauri/src/commands/budget.rs — `#[tauri::command(rename_all = "snake_case")]` + `State<DbState>` lock idiom]
- [Source: apps/desktop/src-tauri/src/commands/mod.rs:1-19 — alphabetical `pub mod` list, insertion point]
- [Source: apps/desktop/src-tauri/src/lib.rs:18-22,91-182 — `tauri_plugin_dialog::init()`, `generate_handler!` budget block ends at `get_all_budget_categories`]
- [Source: apps/desktop/src-tauri/src/db/budget.rs:6-44,64-111,244-290,384,511-517 — `create_budget_group`/`create_budget_category` (no length bound, `target_cents <= 0` rejection), transaction pattern, test-db + error-assertion style]
- [Source: apps/desktop/src-tauri/src/db/audit.rs:5-18 — `insert_audit_log` signature (not called by this story)]
- [Source: apps/desktop/src-tauri/src/commands/account.rs:30-33,60-70 — non-fatal audit idiom]
- [Source: apps/desktop/src-tauri/src/commands/import.rs — `std::fs::metadata` precedent; `:433` audit `?` outlier to avoid]
- [Source: apps/desktop/src-tauri/src/db/expense.rs:59-107 — `unchecked_transaction` + `&tx` as `&Connection`]
- [Source: apps/desktop/src-tauri/Cargo.toml:20-43 — `tauri-plugin-dialog = "2.7.0"`, `tempfile = "3"`, `serde_json = "1"`, `rusqlite = "0.38"`; no `thiserror`]
- [Source: CONTRIBUTING.md:190-212 — `cd apps/desktop/src-tauri && cargo check`; no Rust step in .github/workflows/release.yml]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

Red-green-refactor was followed per task; the failing-first runs are recorded here.

- **Task 1 RED** — `cargo test --lib` failed to compile with 8 errors before the file layer existed:
  `error[E0425]: cannot find value MAX_TEMPLATE_FILE_BYTES in this scope` ×2,
  `error[E0425]: cannot find function import_budget_template_from_path in this scope` ×6.
- **Task 1 GREEN** — 204 passed / 0 failed.
- **Task 2 RED** — `cargo test --lib import_file_zero_target` reproduced the exact defect 24.1's review deferred:
  ``panicked at src/db/budget_template.rs:832: called `Result::unwrap()` on an `Err` value: Validation { message: "Target must be greater than 0", field: Some("target_cents") }``
- **Task 2 GREEN (first pass)** — `import_file_zero_target_uses_default` passed, but `rollback_leaves_no_rows` then failed
  (204 passed / 1 failed) because that Story 24.1 test used `target_cents: 0` as its mid-apply failure trigger, which this
  story deliberately makes valid. Retriggered rather than removed — see Completion Notes decision 2.
- **Task 2 GREEN (final)** — 205 passed / 0 failed.
- **Task 6 GREEN** — 225 passed / 0 failed.
- One self-inflicted detour worth noting: the initial `use std::path::Path;` edit landed inside `mod tests` instead of the
  module header (the editor matched the indented `use rusqlite::Connection;` inside the test module as a substring),
  producing a simultaneous `cannot find type Path` + `unused import: std::path::Path`. Corrected by moving the import to
  line 1. No functional impact.

### Completion Notes List

**Deviation-free on naming.** Story 24.1's actual names matched every assumption in this story: `validate_budget_template`,
`apply_budget_template_json`, `apply_template_inner`, `apply_system_budget_template`, `template_test_db()`, the five
`pub const`s, and both message constants. No renames were needed. One detail worth recording for 24.3/24.4: `MSG_INVALID_FILE`
and `MSG_VERSION_TOO_NEW` are **private** (`const`, not `pub const`) in `db/budget_template.rs`. That is sufficient for this
story (tests live in the same module) but a sibling module needing them will have to make them `pub`.

**Decision 1 — `target_cents: 0` is normalized to the default, not rejected (AC #9).**
This is the decision Story 24.1's review explicitly deferred. Two options existed:
(a) reject `0` in `validate_budget_template` as an invalid file, or (b) treat `0` exactly like `null`/absent.
**Chose (b).** Rationale: architecture Decision 4 specifies `target_cents` must be "non-negative", and `0` is non-negative —
rejecting it would contradict the binding architecture wording, and would also make a legitimately amount-stripped export
(where a producer wrote `0` rather than omitting the key) unimportable for no user benefit. Implemented as
`.filter(|cents| *cents > 0).unwrap_or(DEFAULT_TEMPLATE_TARGET_CENTS)` in `apply_template_inner`, so the category is created
at `DEFAULT_TEMPLATE_TARGET_CENTS` (`100` = $1.00). `db/budget.rs` was **not** modified and `validate_budget_template`'s
accepted range stays `0..=MAX_TEMPLATE_TARGET_CENTS`. Consequence: the pre-existing
`AppError::Validation { message: "Target must be greater than 0" }` leak from `create_budget_category` is now unreachable
from any template-valid import — an import can no longer surface a `validation`-typed error the frontend does not expect.
UX follow-up for 24.4 / 25.3 (already flagged in this story's §UX Note): an explicit `0` now silently lands at **$1.00**,
same as a stripped amount.

**Decision 2 — `rollback_leaves_no_rows` was re-triggered, not weakened.**
Decision 1 removed the only mid-apply DB failure that Story 24.1's `rollback_leaves_no_rows` test could provoke; after this
change **no template-valid input can make `create_budget_category` fail at all** (blank names and out-of-range targets are
already rejected by validation, and `0` is now normalized). The test's validation-failure half still asserts zero rows. For
its transaction-rollback half, the trigger was replaced with explicit fault injection: the test creates a
`UNIQUE INDEX ... ON budget_categories(group_id, name)` that the production schema does **not** have, then imports a group
containing two categories named `Rent`. Duplicate category names within one group are template-valid (validation does not
dedupe them), so the first category inserts and the second fails with a rusqlite constraint error → `AppError::Database` →
early return → `Drop` rolls the transaction back. The test now asserts `AppError::Database` containing
`"UNIQUE constraint failed"` and still asserts zero rows in all three tables. The injected index is commented as
deliberately synthetic so no future reader mistakes it for a real schema constraint. Net effect: the rollback backstop is
still genuinely exercised, and no test was deleted, skipped, or softened.

**Decision 3 — `MAX_TEMPLATE_FILE_BYTES` guard placement.** The size check uses `std::fs::metadata().len()` and returns
before `read_to_string` is ever called, so an oversized file is never buffered (AC #12). An extra boundary test
(`import_file_at_size_limit_is_read`, not in the story's matrix) proves the guard does **not** fire at exactly
`MAX_TEMPLATE_FILE_BYTES` — a file at the cap is read and then fails in the parser, which is the only way to distinguish
"rejected by the size guard" from "rejected at the cap boundary off-by-one".

**Test totals.** Baseline before this story: **198** passing. After: **225** passing, 0 failed, 0 ignored (+27 tests — all
26 rows of the story's matrix plus the size-boundary test above). All 26 named test functions from the matrix table exist
with the names specified.

**Zero-warning gate.** `cargo check --all-targets`, `cargo clippy --all-targets` (forced to re-analyze via `touch` after the
first run reported a cached result), and `cargo test` all produce zero warnings and zero errors. `#[allow(dead_code)]` was
removed from `apply_budget_template_json` (this story is its first non-test caller) and left in place on
`apply_system_budget_template` (still Story 25.1's). Exactly one `#[allow(dead_code)]` remains in the file. No warning was
suppressed anywhere.

**Scope containment.** `db/budget.rs`, `db/audit.rs`, `error.rs`, `commands/backup.rs`, `migrations/`, `locales/*.json`, and
all of `apps/desktop/src/**` are untouched — verified via `git status --porcelain` against those paths returning empty. No
frontend file was touched, so `tsc --noEmit` is not applicable to this story. No dependency changes.

**Environment notes.** `cargo fmt` is not installed on this toolchain, so formatting was not auto-applied (consistent with
Story 23.1's note); code was hand-written to match the surrounding style and `clippy` is clean.
`_bmad/scripts/resolve_customization.py` could not run (requires Python 3.11+ for `tomllib`; this machine has an older
Python), so the `workflow` block was resolved manually per the skill's documented fallback — no team or user override file
exists for `bmad-dev-story`, so the base `customize.toml` values applied (`persistent_facts` →
`docs/project-context.md`, empty prepend/append steps, empty `on_complete`).

**Note on the story's Task 7 `git diff --stat` expectation.** It also shows `db/mod.rs` (+1) and `models/mod.rs` (+31).
Those are Story 24.1's own uncommitted changes (`pub mod budget_template;` and the four template structs), present in the
worktree before this story started and not modified here.

### File List

- `apps/desktop/src-tauri/src/commands/budget_template.rs` — **new**: `import_budget_template` Tauri command (dialog, cancel → `Ok(None)`, delegates to the db layer, no audit call of its own)
- `apps/desktop/src-tauri/src/db/budget_template.rs` — modified: added `MAX_TEMPLATE_FILE_BYTES` + `use std::path::Path`, added `import_budget_template_from_path` (size guard → read → BOM strip → delegate), normalized `target_cents: Some(0)` to the default in `apply_template_inner`, removed the obsolete `#[allow(dead_code)]` on `apply_budget_template_json`, re-triggered `rollback_leaves_no_rows`, and added 27 tests plus 7 test helpers
- `apps/desktop/src-tauri/src/commands/mod.rs` — modified: added `pub mod budget_template;`
- `apps/desktop/src-tauri/src/lib.rs` — modified: registered `commands::budget_template::import_budget_template` in `generate_handler!`
- `_bmad-output/implementation-artifacts/24-2-import-validation-for-untrusted-template-files.md` — modified: `baseline_commit` frontmatter, task checkboxes, Dev Agent Record, File List, Change Log, Status
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified: story status `ready-for-dev` → `in-progress` → `review`

## Change Log

- 2026-08-04: Story context created (ready-for-dev).
- 2026-08-04: Implemented Tasks 0-7. Added the untrusted-file boundary layer (`import_budget_template_from_path`) with a
  pre-read 1 MiB size guard, UTF-8/BOM handling, and the `import_budget_template` Tauri command (cancel → `Ok(None)`).
  Resolved the `target_cents: 0` decision deferred by Story 24.1's review by normalizing `0` to
  `DEFAULT_TEMPLATE_TARGET_CENTS` rather than rejecting it, and re-triggered `rollback_leaves_no_rows` with explicit fault
  injection so the transaction-rollback backstop stays covered. Test suite 198 → 225 passing; zero warnings from
  `cargo check --all-targets`, `cargo clippy --all-targets`, and `cargo test`. Status → review.
- 2026-08-04: Adversarial code review (bmad-code-review) run against `commands/budget_template.rs` (new),
  `db/budget_template.rs` (this story's additions only — `MAX_TEMPLATE_FILE_BYTES`, `import_budget_template_from_path`,
  the `target_cents` filter, the dead-code removal, and the retriggered `rollback_leaves_no_rows`), `commands/mod.rs`,
  and `lib.rs`. All 17 ACs re-verified against the actual code (each traced to the exact lines that satisfy it, not just
  the tests). Re-ran `cargo check --all-targets` (0 warnings), `cargo clippy --all-targets -- -D warnings` (0 warnings,
  forced re-analysis via `touch` to bypass the cache), and `cargo test` (225 passed / 0 failed / 0 ignored — matches the
  claimed count exactly, including all 27 new `db::budget_template::tests` functions). Empirically verified the
  "no stack overflow on deep JSON nesting" claim in Dev Notes by feeding `serde_json` 200,000 levels of array nesting in
  an isolated throwaway crate: it returns a graceful `Err("recursion limit exceeded")`, not a panic — claim confirmed,
  Edge Case Hunter's nesting-DoS finding dismissed. Verdict: **PASS**. 2 low-severity findings deferred (both pre-date
  a design decision on read-strategy hardening, not blocking); see Review Findings below and `deferred-work.md`. Status
  → done.

## Review Findings

**Reviewer verdict: PASS.** All 17 acceptance criteria verified against the actual code (not just the tests). Zero
compilation/clippy warnings. 225/225 tests pass. No `decision-needed` or `patch` findings — nothing required an
unambiguous, safe, in-scope code change, so no production code was modified by this review.

**Judgment calls requested by the review task, resolved:**
- **`target_cents: 0` normalization (Decision 1):** Confirmed consistent with architecture Decision 4's "non-negative"
  wording and AC #9. Traced the full path: `validate_budget_template` only ever lets `0..=MAX_TEMPLATE_TARGET_CENTS`
  through when `target_cents` is present, then `apply_template_inner`'s `.filter(|c| *c > 0).unwrap_or(DEFAULT)` means
  the value handed to `create_budget_category` is always either the original (already `> 0`) or `DEFAULT_TEMPLATE_TARGET_CENTS`
  (`100`, `> 0`). `AppError::Validation { message: "Target must be greater than 0" }` is genuinely unreachable from any
  template-valid import. Confirmed correct.
- **`rollback_leaves_no_rows`'s synthetic `UNIQUE INDEX` (Decision 2):** Legitimate fault-injection test — it correctly
  exercises the real `Transaction`/`Drop`-based rollback mechanism on a real rusqlite constraint error, is clearly
  commented as synthetic, and is isolated per-test (in-memory DB, no cross-test leakage). Judgment: **pass, with a note**
  — its real-world fidelity is now zero, because after Decision 1 no template-valid input can reach a mid-apply DB
  failure in the *actual* schema. The test proves the generic rollback backstop works, not that a realistic import can
  trigger it. That is an acceptable, well-documented consequence of validation now being airtight, not a defect.
- **Dialog-before-lock / TOCTOU / error-path leaks (Decision 3):** No absolute path or filesystem detail leaks into any
  user-facing message — the only OS-detail-carrying message is the generic `"Failed to read template file: {e}"`
  fallback, and `std::io::Error`'s `Display` does not include the file path. A genuine TOCTOU gap exists between the
  `std::fs::metadata` size check and the later `std::fs::read_to_string` call — see Deferred Findings below.

**Deferred findings (real, low-severity, not blocking — see `deferred-work.md` for tracking):**
- [x] [Review][Defer] TOCTOU between the size guard and the read in `import_budget_template_from_path` [`db/budget_template.rs`] — deferred, requires a read-strategy design decision (e.g. `File::open` + `file.metadata()` + a length-capped `Read` adapter instead of path-based `metadata()` + `read_to_string()`), not a trivial patch.
- [x] [Review][Defer] No `is_file()` guard before reading the selected path [`db/budget_template.rs`] — deferred, a symlink to a FIFO/special device could hang the read or report a misleading size via `metadata()`; low real-world likelihood on a local-first single-user app, but worth a follow-up hardening pass alongside the TOCTOU item above.

**Dismissed as noise / out of scope (with reasoning):**
- Deep-JSON-nesting stack overflow (Edge Case Hunter) — empirically refuted; `serde_json`'s built-in recursion limit returns a graceful error, no crash.
- Blocking `blocking_pick_file()` inside `async fn`, and the `DbState` mutex held across file I/O + parse + validate (Blind Hunter + Edge Case Hunter) — established codebase precedent, identical to `commands/backup.rs`, explicitly mandated by this story's own Dev Notes to mirror; not introduced by this diff.
- Audit row written after `tx.commit()` and its failure being non-fatal/swallowed, magic `entity_id: 0`, `DEFAULT_TEMPLATE_TARGET_CENTS` placeholder ambiguity, Unicode zero-width-space/NFC-NFD name bypass (Blind Hunter + Edge Case Hunter) — all in `write_apply_audit_log` / `apply_template_inner`'s collision logic / `validate_template_name`, which are **Story 24.1's code**, unmodified by this story (only the `target_cents` filter line, the file-boundary layer, and the dead-code removal are 24.2's). Out of scope per this review's boundary; already covered by 24.1's review.
- `#[allow(dead_code)]` on `apply_system_budget_template` "shipped ahead of its consumer" (Blind Hunter) — contradicts binding AC #16, which explicitly requires this allowance stay in place until Story 25.1.
- Double-`match` cancel handling, zero command-layer unit tests (Blind Hunter) — both mirror `commands/backup.rs`'s established idiom verbatim (confirmed by reading `backup.rs`'s own test module: only helper functions are unit-tested, never the `AppHandle`-taking command itself), matching this story's own explicit Dev Notes instruction to copy that precedent exactly.
- `FilePath` variant without a plain path silently treated as cancel, missing `MAX_TEMPLATE_GROUPS` constant, log line omitting template name (Blind Hunter + Edge Case Hunter) — inherited idiom / not a real gap / cosmetic, respectively.

