---
baseline_commit: 1bc542762f39223e091c1f9d297fd2b0b8e9cc3e
---

# Story 24.1: Template Schema, Models & Core Apply Function

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the `BudgetTemplate` data model, `format_version: 1` schema, and a shared core apply function,
So that both import and system-template application paths build on one validated, transactional primitive.

**Scope:** Rust backend only — `models/mod.rs` types, new `db/budget_template.rs` module (schema, validation, transactional apply, audit hook), `db/mod.rs` registration, `#[cfg(test)]` coverage. **No Tauri commands, no `lib.rs` change, no frontend, no i18n, no migration.**

**FRs:** FR96 (schema + apply primitive portion) · **NFRs:** NFR11 (never silently lose/corrupt records), NFR13 (accurate to the cent)
**Epic:** [epics-budget-templates.md § Epic 24](../planning-artifacts/epics-budget-templates.md)
**Architecture:** [architecture-budget-templates.md](../planning-artifacts/architecture-budget-templates.md) — Decisions 1, 3, 4, 5 + Implementation Patterns

---

## Acceptance Criteria

1. **Given** `models/mod.rs`
   **When** this story is implemented
   **Then** it defines `SystemBudgetTemplate`, `TemplateGroupDef`, `TemplateCategoryDef`, and `ApplyBudgetTemplateResult { groups_created: i32, categories_created: i32, skipped_groups: Vec<String> }`
   **And** all four derive exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` with `snake_case` fields
   **And** `SystemBudgetTemplate`/`TemplateGroupDef`/`TemplateCategoryDef` are `const`-constructible so Story 25.1 can declare `pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate]` without changing these definitions

2. **Given** a template JSON document
   **When** deserialized into `SystemBudgetTemplate`
   **Then** it matches the schema: `format_version` (required integer), `id` (optional string), `name` (string), `description` (optional string), `groups` (array of `{ name, categories: [{ name, target_cents: optional integer }] }`)
   **And** a document missing `format_version` fails deserialization (it is not defaulted)

3. **Given** `db/budget_template.rs`
   **When** `apply_budget_template_json(conn: &Connection, json: &str)` is called with a valid document
   **Then** it deserializes, runs `validate_budget_template` fully, and only then creates budget groups/categories via existing `budget_db::create_budget_group` / `budget_db::create_budget_category` inside a single `conn.unchecked_transaction()`
   **And** returns `ApplyBudgetTemplateResult` with accurate `groups_created` / `categories_created` counts (counting only rows actually inserted — skipped groups and their categories are excluded)

4. **Given** an incoming group whose name matches an existing `budget_groups` row name case-insensitively (compared after `trim()`)
   **When** `apply_budget_template_json` processes it
   **Then** the entire incoming group **and all its categories** are skipped — no partial application of that group
   **And** the skipped group's name (as it appears in the template, trimmed) is added to `skipped_groups` in the result

5. **Given** any validation or DB failure during apply
   **When** the function returns `Err`
   **Then** the transaction is rolled back and no groups or categories from the template exist in the database afterward

6. **Given** a successful apply from any source
   **When** the transaction commits
   **Then** exactly one `audit_db::insert_audit_log` call is made with `entity_type: "budget_template"`, `action: "apply"`, `entity_id: 0`, `old_value: None`, and `new_value` = JSON summary `{"groups": N, "categories": N, "source": "system"|"import", "template_id": "..."|null}`
   **And** the audit call happens **after** `tx.commit()` and its failure is logged via `tracing::error!` without failing or rolling back the apply

7. **Given** a template where every group collides with an existing group
   **When** applied
   **Then** the call succeeds with `groups_created: 0`, `categories_created: 0`, and all names in `skipped_groups` — and the audit log is still written with `{"groups": 0, "categories": 0, ...}`

8. **Given** a category with `target_cents` absent or `null` (amount-stripped user export per FR96)
   **When** applied
   **Then** `DEFAULT_TEMPLATE_TARGET_CENTS` is used, because existing `create_budget_category` rejects `target_cents <= 0`
   **And** `db/budget.rs` is **not** modified to accommodate this

9. **Given** `validate_budget_template`
   **When** called
   **Then** it enforces, before any DB write: recognized `format_version`; non-empty-after-trim group and category names; name length ≤ `MAX_TEMPLATE_NAME_LEN`; `target_cents` (when present) in `0..=MAX_TEMPLATE_TARGET_CENTS`; non-empty `groups`; non-empty `categories` per group; total categories ≤ `MAX_TEMPLATE_CATEGORIES`
   **And** every rejection is `AppError::File { message }` — no new `AppError` variant is added

10. **Given** `pub mod budget_template;`
    **When** added to `db/mod.rs`
    **Then** `cargo check` in `apps/desktop/src-tauri/` produces **zero warnings** (including zero `dead_code` warnings — see Dev Notes §Dead Code)

11. **Given** the Rust backend
    **When** `cargo test` runs in `apps/desktop/src-tauri/`
    **Then** all pre-existing tests still pass **and** the new `db::budget_template` tests pass: apply-system-template, import-valid-file, import-invalid-version, duplicate-group-skip, rollback-leaves-no-rows, audit-row-written, null-target-uses-default, and a `const`-constructibility smoke test

---

## Tasks / Subtasks

- [x] **Task 1: Add template types to `models/mod.rs`** (AC: #1, #2)
  - [x] Add `use std::borrow::Cow;` to the top of `models/mod.rs`
  - [x] Insert the four structs **after** `BudgetCategoryStatus` and **before** `Expense` (budget-domain clustering — see Dev Notes §Where Types Go)
  - [x] Copy the struct definitions **verbatim** from Dev Notes §Type Definitions (Copy Verbatim) — do not substitute `String`/`Vec` for `Cow`
  - [x] Run `cargo check` and confirm the serde derives compile

- [x] **Task 2: Create `db/budget_template.rs` skeleton + constants** (AC: #9)
  - [x] Create `apps/desktop/src-tauri/src/db/budget_template.rs`
  - [x] Add `pub mod budget_template;` to `apps/desktop/src-tauri/src/db/mod.rs` (alphabetical: after `pub mod budget;`)
  - [x] Declare the four constants verbatim from Dev Notes §Constants (New — Do Not Invent Others)
  - [x] Imports: `rusqlite::Connection`, `crate::db::{audit as audit_db, budget as budget_db}`, `crate::error::AppError`, `crate::models::{ApplyBudgetTemplateResult, CreateBudgetCategory, CreateBudgetGroup, SystemBudgetTemplate}`

- [x] **Task 3: Implement `validate_budget_template`** (AC: #9)
  - [x] Signature: `fn validate_budget_template(template: &SystemBudgetTemplate) -> Result<(), AppError>`
  - [x] `format_version`: `== SUPPORTED_TEMPLATE_FORMAT_VERSION` → ok; `> SUPPORTED_...` → `MSG_VERSION_TOO_NEW`; anything else (incl. `0`, negative) → `MSG_INVALID_FILE`
  - [x] Reject empty `groups`; reject any group with empty `categories`
  - [x] Reject group/category name that is empty after `trim()` or whose `trim().chars().count()` exceeds `MAX_TEMPLATE_NAME_LEN`
  - [x] Reject `target_cents` outside `0..=MAX_TEMPLATE_TARGET_CENTS` when `Some`
  - [x] Reject when total category count across all groups exceeds `MAX_TEMPLATE_CATEGORIES`
  - [x] Every rejection returns `AppError::File { message: ... }`

- [x] **Task 4: Implement the private transactional core** (AC: #3, #4, #5, #7, #8)
  - [x] `fn apply_template_inner(conn: &Connection, template: &SystemBudgetTemplate, source: &str) -> Result<ApplyBudgetTemplateResult, AppError>`
  - [x] Call `validate_budget_template(template)?` **before** opening the transaction
  - [x] `let tx = conn.unchecked_transaction()?;`
  - [x] Read existing group names once via `budget_db::get_budget_groups(&tx)?`; build a `Vec<String>` of `name.trim().to_lowercase()` for collision matching
  - [x] For each template group **in array order**: if `name.trim().to_lowercase()` is in the existing set → push trimmed name to `skipped_groups`, `continue` (do not create any of its categories); also add newly created group names to the collision set so a template containing two same-named groups skips the second
  - [x] Otherwise `budget_db::create_budget_group(&tx, &CreateBudgetGroup { name: <trimmed> })?`, increment `groups_created`
  - [x] For each category in that group **in array order**: `budget_db::create_budget_category(&tx, &CreateBudgetCategory { group_id: <new group id>, name: <trimmed>, target_cents: c.target_cents.unwrap_or(DEFAULT_TEMPLATE_TARGET_CENTS) })?`, increment `categories_created`
  - [x] Do **not** set `sort_order` — both existing fns derive it from `MAX(sort_order)+1`, so array order is preserved automatically
  - [x] `tx.commit()?;`
  - [x] After commit: write the audit log (Task 5), then return the result

- [x] **Task 5: Audit hook (post-commit, non-fatal)** (AC: #6, #7)
  - [x] Build the summary with `serde_json::json!({ "groups": result.groups_created, "categories": result.categories_created, "source": source, "template_id": template.id.as_deref() })`
  - [x] `if let Err(e) = audit_db::insert_audit_log(&conn, "budget_template", 0, "apply", None, Some(&summary)) { tracing::error!("Failed to write audit log: {}", e); }`
  - [x] Confirm it uses `&conn` (not `&tx`) and runs strictly after `tx.commit()`

- [x] **Task 6: Public entry points** (AC: #3, #6)
  - [x] `pub fn apply_budget_template_json(conn: &Connection, json: &str) -> Result<ApplyBudgetTemplateResult, AppError>` — `serde_json::from_str::<SystemBudgetTemplate>(json).map_err(|_| AppError::File { message: MSG_INVALID_FILE.to_string() })?` then `apply_template_inner(conn, &template, "import")`
  - [x] `pub fn apply_system_budget_template(conn: &Connection, template: &SystemBudgetTemplate) -> Result<ApplyBudgetTemplateResult, AppError>` — `apply_template_inner(conn, template, "system")` (no JSON round-trip; Story 25.1 calls this)
  - [x] Add `#[allow(dead_code)]` **with a WHY comment** on `apply_system_budget_template` (consumed by Story 25.1) — see Dev Notes §Dead Code

- [x] **Task 7: `#[cfg(test)] mod tests`** (AC: #11)
  - [x] Add the `template_test_db()` helper verbatim from Dev Notes §Test DB Helper (Copy Verbatim) — includes `budget_groups`, `budget_categories`, **and** `audit_log`
  - [x] `const`-constructibility smoke test: declare a `const` `SystemBudgetTemplate` at test-module scope and assert on it (proves Story 25.1's `SYSTEM_TEMPLATES` will compile)
  - [x] `apply_system_template`: `apply_system_budget_template` on an empty budget → counts match, `skipped_groups` empty
  - [x] `import_valid_file`: `apply_budget_template_json` with a valid JSON string incl. `target_cents: null` → succeeds, categories get `DEFAULT_TEMPLATE_TARGET_CENTS`
  - [x] `import_invalid_version`: `format_version: 99` → `AppError::File` with `MSG_VERSION_TOO_NEW`; `format_version: 0` → `MSG_INVALID_FILE`; structurally broken JSON → `MSG_INVALID_FILE`
  - [x] `duplicate_group_skip`: seed group `'Needs'`, apply template containing `'needs'` + a new group → only the new group created, `skipped_groups == ["needs"]` (template casing, trimmed), skipped group's categories absent from DB
  - [x] `rollback_leaves_no_rows`: force a mid-apply DB failure (e.g. category name that trips `create_budget_category`'s own validation but passes template validation is not possible — instead assert that a validation failure produces zero rows, and add a case where a group is created then a later category insert fails, asserting `budget_groups` count is unchanged)
  - [x] `audit_row_written`: after a successful apply, exactly one `audit_log` row with `entity_type = 'budget_template'`, `action = 'apply'`, `entity_id = 0`, and `new_value` containing `"source":"import"`
  - [x] `all_groups_skipped`: every group collides → `Ok` with zeros, all names in `skipped_groups`, audit row still written

- [x] **Task 8: Verification** (AC: #10, #11)
  - [x] `cd apps/desktop/src-tauri && cargo check` → **zero warnings**
  - [x] `cd apps/desktop/src-tauri && cargo test` → all tests pass (pre-existing suite was 165 tests as of Story 23.1)
  - [x] Confirm `db/budget.rs`, `db/audit.rs`, `error.rs`, `lib.rs`, `commands/` and the frontend are untouched

### Review Findings

_Adversarial code review — 2026-08-04. Three parallel layers (Blind Hunter/diff-only, Edge Case Hunter/path-exhaustive, Acceptance Auditor/spec-vs-code) plus independent re-run of `cargo check --all-targets`, `cargo clippy --all-targets`, `cargo test`. Verdict: **PASS**. All 11 ACs independently confirmed satisfied against real code + fresh tool output (not the self-reported log). 2 trivial, non-functional patch suggestions; ~18 raised concerns dismissed as false positives, spec-mandated behavior, or already owned by a named future story (24.2/24.4/25.1) per this story's own Scope Boundary table — see full triage in the review report._

- [x] [Review][Patch] Log the discarded `serde_json` parse error for developer diagnosability before mapping to the generic `invalid_file()` — currently `map_err(|_| invalid_file())` throws away `e` with no `tracing::debug!`/`warn!`, unlike the audit-write failure path just below it which does log. User-facing message must stay generic (AC #9); only the internal log needs the real error. [apps/desktop/src-tauri/src/db/budget_template.rs:199-200] — **Applied 2026-08-04**: `map_err` now logs `tracing::debug!("Template JSON parse failed: {}", e)` before returning `invalid_file()`; user-facing message unchanged.
- [x] [Review][Patch] Scope the doc comment above `validate_budget_template` ("Every rejection is `AppError::File`") to validation-only rejections — DB-layer failures inside `apply_template_inner` (e.g. `target_cents: 0` tripping `create_budget_category`) propagate via `?` as `AppError::Database`/`AppError::Validation`, not `AppError::File`. Doc-only clarification, zero functional change. [apps/desktop/src-tauri/src/db/budget_template.rs:46-50] — **Applied 2026-08-04**: doc comment reworded to "Every rejection **from this function** is `AppError::File`" with a note on how DB-layer failures propagate instead.

**Re-verification after patches (2026-08-04):** `cargo check --all-targets` → zero warnings. `cargo clippy --all-targets` → zero warnings. `cargo test` → 198 passed, 0 failed (unchanged — both patches are non-functional). Scope confirmed still minimal: only `db/mod.rs`, `models/mod.rs`, `db/budget_template.rs` touched.

---

## Dev Notes

### Critical Rules (DO NOT VIOLATE)

1. **`db/budget.rs` is read-only for this story.** Call `create_budget_group` / `create_budget_category` exactly as they exist. No signature change, no relaxed validation. [Source: architecture-budget-templates.md § Files explicitly NOT modified]
2. **`db/audit.rs` and `error.rs` are read-only.** Reuse `insert_audit_log` and `AppError::File` — no new error variant. [Source: architecture-budget-templates.md § Enforcement Guidelines]
3. **All validation before any DB write.** Validate the whole document first, then open the transaction. [Source: Decision 4]
4. **One transaction, all-or-nothing.** `conn.unchecked_transaction()`; on `Err` return early and let `Drop` roll back (the codebase's `db/expense.rs` pattern). NFR11.
5. **Skip at group granularity only.** Never create some of a colliding group's categories. [Source: Decision — Duplicate-group handling]
6. **Audit after commit, non-fatal.** Failure logs via `tracing::error!` and returns `Ok`. [Source: Decision 5]
7. **No `commands/`, no `lib.rs`, no frontend, no migration in this story.**
8. **Zero compilation warnings.** [Source: docs/project-context.md §9, docs/guidelines/warnings.md]

### Three Conflicts Between the Architecture Doc and Actual Code — RESOLVED HERE

The architecture doc makes three assumptions that do **not** hold in the current codebase. These resolutions are binding; do not re-derive them.

**Conflict 1 — `create_budget_category` rejects `target_cents <= 0`.**
`db/budget.rs:78-83` (verbatim):
```rust
if input.target_cents <= 0 {
    return Err(AppError::Validation {
        message: "Target must be greater than 0".to_string(),
        field: Some("target_cents".to_string()),
    });
}
```
An amount-stripped user export has `target_cents: null` (FR96). Passing `0` would fail. **Resolution:** map `None` → `DEFAULT_TEMPLATE_TARGET_CENTS` (`100` = `$1.00`), an intentionally obvious placeholder the user will notice and edit. Do **not** relax `create_budget_category`, do **not** bypass it with a raw `INSERT`. Flag for product/UX: imported amount-stripped templates land at `$1.00` per category.

**Conflict 2 — there is no existing name-length bound to "reuse".**
The architecture says to reuse "`create_budget_category`'s existing bounds". Grep of `db/budget.rs` confirms the only checks are `.trim()` + `.is_empty()` — **no length constant exists anywhere**. **Resolution:** this story introduces `MAX_TEMPLATE_NAME_LEN = 100` (chars, not bytes) as a template-import-only bound. It does not change what the rest of the app accepts.

**Conflict 3 — `pub const SYSTEM_TEMPLATES` cannot hold `String`/`Vec` fields, but AC #1 requires `Deserialize`.**
Architecture Decision 2 wants `pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate]` (const context → no heap types). AC #1 and AC #2 want one serde-round-trippable schema type family. The precedent `maintenance/defaults.rs::TaskBaseline` uses `&'static str` with **no derives at all**, which cannot `Deserialize`. **Resolution:** use `Cow<'static, str>` / `Cow<'static, [T]>`. `Cow::Borrowed(..)` is const-constructible, and serde's blanket `impl<'de, 'a, T: ?Sized> Deserialize<'de> for Cow<'a, T> where T: ToOwned, T::Owned: Deserialize<'de>` gives full owned deserialization. This is the only shape satisfying Story 24.1 and Story 25.1 simultaneously with a single schema (architecture: "single schema, optional field, not two schemas"). Task 7's `const` smoke test proves it compiles before Story 25.1 depends on it.

### Type Definitions (Copy Verbatim)

Into `models/mod.rs`:

```rust
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
```

`format_version` has no `#[serde(default)]` — a missing field must fail deserialization (AC #2).

### Constants (New — Do Not Invent Others)

In `db/budget_template.rs`:
```rust
pub const SUPPORTED_TEMPLATE_FORMAT_VERSION: i32 = 1;
pub const MAX_TEMPLATE_NAME_LEN: usize = 100;
pub const MAX_TEMPLATE_CATEGORIES: usize = 100;
pub const MAX_TEMPLATE_TARGET_CENTS: i64 = 100_000_000;
pub const DEFAULT_TEMPLATE_TARGET_CENTS: i64 = 100;

const MSG_INVALID_FILE: &str = "This file is not a valid Nixus budget template.";
const MSG_VERSION_TOO_NEW: &str =
    "This template was created with a newer version of Nixus. Please update the app.";
```
The two message strings are specified verbatim by architecture § Version-mismatch / invalid-file error messages and are asserted by Story 24.2 — use them exactly.

### Existing Code to Extend (DO NOT REINVENT)

| Item | File:line | Exact signature / fact |
|---|---|---|
| `create_budget_group` | `db/budget.rs:6` | `pub fn create_budget_group(conn: &Connection, input: &CreateBudgetGroup) -> Result<BudgetGroup, AppError>` — trims name, rejects empty, auto-assigns `sort_order = MAX+1`, returns the row (use `.id`) |
| `create_budget_category` | `db/budget.rs:64` | `pub fn create_budget_category(conn: &Connection, input: &CreateBudgetCategory) -> Result<BudgetCategory, AppError>` — trims name, rejects empty, **rejects `target_cents <= 0`**, auto-assigns per-group `sort_order` |
| `get_budget_groups` | `db/budget.rs:46` | `pub fn get_budget_groups(conn: &Connection) -> Result<Vec<BudgetGroup>, AppError>` — use for collision detection |
| `CreateBudgetGroup` | `models/mod.rs` | `{ name: String }` |
| `CreateBudgetCategory` | `models/mod.rs` | `{ group_id: i64, name: String, target_cents: i64 }` |
| `insert_audit_log` | `db/audit.rs:5` | `pub fn insert_audit_log(conn: &Connection, entity_type: &str, entity_id: i64, action: &str, old_value: Option<&str>, new_value: Option<&str>) -> Result<(), AppError>` — note the **positional order: entity_type, entity_id, action** |
| `AppError::File` | `error.rs:9` | `File { message: String }` → serializes as `{ "type": "file", "message": ... }` |
| `From<rusqlite::Error>` | `error.rs:92` | Lets `?` propagate rusqlite errors as `AppError::Database` |
| `TaskBaseline` / `DEFAULT_TASKS` | `maintenance/defaults.rs:4,10` | Const-array precedent Story 25.1 will mirror |

**`&tx` is accepted anywhere `&Connection` is expected** — `rusqlite::Transaction` derefs to `Connection`. `db/expense.rs:59-107` does exactly this (`get_expense_by_id(&tx, id)`), so `budget_db::create_budget_group(&tx, ..)` is correct.

### Transaction Pattern (mirror `db/expense.rs:59-107`)

```rust
let tx = conn.unchecked_transaction()?;
// ...reads and writes through &tx...
tx.commit()?;
```
Early `return Err(..)` before `commit` rolls back via `Transaction`'s `Drop` — no explicit `.rollback()` needed. Do **not** use `db/maintenance.rs`'s closure+`match` style here; the simpler `expense.rs` form is sufficient and is what `db/budget.rs:272` itself uses.

### Audit Pattern (mirror `commands/account.rs:31`)

The non-fatal form used by most of the codebase:
```rust
if let Err(e) = audit_db::insert_audit_log(&conn, "budget_template", 0, "apply", None, Some(&summary)) {
    tracing::error!("Failed to write audit log: {}", e);
}
```
Do **not** copy `commands/import.rs:433`'s `?` form — Decision 5 requires non-fatal.

**Intentional deviation from `docs/project-context.md` §3** ("commands write the audit log"): the audit call lives in the `db/` layer here because AC #6 requires *exactly one* audit row per apply *regardless of source*, and this story ships no commands. Placing it in the shared primitive makes the invariant unforgettable for Stories 24.4 and 25.1. Document this with a WHY comment at the call site.

### Where Types Go

`models/mod.rs` has **no section header comments**; structs are clustered by domain in build order. The budget cluster is lines 3-41 (`BudgetGroup`, `BudgetCategory`, `CreateBudgetGroup`, `CreateBudgetCategory`, `BudgetCategoryStatus`), then `Expense` starts at line 44. **Insert the four new structs between them** (after `BudgetCategoryStatus`, before `Expense`). `use std::borrow::Cow;` goes next to the existing `use serde::{Deserialize, Serialize};` on line 1.

`db/mod.rs`: add `pub mod budget_template;` immediately after `pub mod budget;`.

### Dead Code (AC #10 — this WILL bite you)

`mod db;` is private in `lib.rs`, so `pub fn` items in `db/*.rs` that nothing reachable calls **do** trigger `dead_code`. `#[cfg(test)]` usage does not suppress it in a normal `cargo check`/`cargo build`.

- `apply_system_budget_template` has no non-test caller until Story 25.1 → add `#[allow(dead_code)]` **plus a WHY comment** naming Story 25.1. [Source: docs/guidelines/warnings.md — "If the method is used, you should add an ignore for this warning"]
- `apply_budget_template_json` likewise has no non-test caller until Story 24.4 → same treatment.
- Any constant referenced only from tests needs the same treatment; constants used inside `validate_budget_template` do not.
- Do **not** delete anything to silence a warning — these are all consumed by later stories in this epic.

### Test DB Helper (Copy Verbatim)

Tests hand-roll minimal DDL against an in-memory DB — there is **no** shared migration-based test helper. Pattern copied from `db/budget.rs:384` (`budget_test_db`), extended with `audit_log` (schema from `migrations/006_audit_log.sql`) because AC #6 must be asserted.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

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
}
```

Note: `budget_groups` has **no UNIQUE constraint on `name`** and `create_budget_group` performs **no duplicate check** — case-insensitive collision detection is entirely this story's responsibility (AC #4). Do not assume the DB will reject a duplicate.

### Schema Reference (Decision 3)

```json
{
  "format_version": 1,
  "id": "canadian-starter",
  "name": "My Budget",
  "description": null,
  "groups": [
    { "name": "Housing", "categories": [{ "name": "Rent", "target_cents": null }] }
  ]
}
```
`sort_order` is deliberately absent from the file — it is derived from array order on apply.

### Scope Boundary vs. Story 24.2

Epic AC 24.1 says apply "validates the document (Story 24.2 rules)", while Story 24.2's ACs are all phrased against the `import_budget_template` **command**. Binding split:

- **This story owns** `validate_budget_template` (the full rule set in AC #9) and the two message constants — the transactional guarantee in AC #5 is unachievable without it.
- **Story 24.2 owns** the `commands/budget_template.rs` `import_budget_template` command, file reading, surfacing the messages over IPC, and the exhaustive per-rule negative test matrix at the command boundary.

Do not defer validation to 24.2, and do not build the command here.

### Out of Scope (later stories)

| Item | Story |
|---|---|
| `commands/budget_template.rs`, `lib.rs` `generate_handler!` registration | 24.2 / 24.4 / 25.1 |
| `import_budget_template` command + file read + dialog | 24.2, 24.4 |
| `export_budget_template`, slugified filename, `blocking_save_file` | 24.3 |
| `budget/template_defaults.rs`, `SYSTEM_TEMPLATES`, Canadian starter, `mod budget;` in `lib.rs` | 25.1 |
| `list_system_templates`, `apply_system_template` commands, `SystemBudgetTemplateSummary` | 25.1 |
| `hooks/useBudgetTemplates.ts`, `queryKeys.systemBudgetTemplates`, `lib/types.ts` | 25.2 |
| `YourDataSettings.tsx` wiring, `locales/en.json` / `fr.json`, toasts | 25.3 |
| Onboarding fork starter-template path | 25.4 |
| `tests/budget-templates.spec.ts` Playwright E2E | 24.4 / 25.4 |
| New migration / `budget_templates` table | Never (Decision 1) |

### Naming Collision Warning

`models/mod.rs:352` already defines `RecurringExpenseTemplate` (recurring monthly expense rule: `merchant`, `amount_cents`, `budget_category_id`, `day_of_month`) plus `CreateRecurringExpenseTemplateInput` / `UpdateRecurringExpenseTemplateInput`, backed by table `recurring_expense_templates` and served by `db/recurring.rs` + `commands/recurring.rs`. **Unrelated concept.** Never introduce a bare `Template` type, and never touch the recurring files. [Source: architecture-budget-templates.md § Technical Constraints]

### Project Structure Notes

- Monorepo path: `apps/desktop/src-tauri/` (`@nkbaz/desktop`)
- Registration is in `lib.rs`, not `main.rs`; `mod db;`/`mod commands;` are already declared there — only their inner `mod.rs` files need the new `pub mod` line
- `src/budget/` does **not** exist yet (Story 25.1 creates it as a new top-level module mirroring `src/maintenance/`)
- Money is always `i64` cents with a `_cents` suffix; never `f64` (NFR13)
- Verify: `cd apps/desktop/src-tauri && cargo check && cargo test`. `rustfmt` was unavailable in the Story 23.1 environment — if `cargo fmt` fails for that reason, note it rather than hand-reformatting

### Previous Story Intelligence

First story of Epic 24 — no predecessor in this epic. Transferable learnings from the most recent backend story (23.1, `db/expense.rs` / `db/account.rs` transactional work):

- The `let tx = conn.unchecked_transaction()?; ... tx.commit()?;` form was used throughout and passed review — reuse it
- Audit + post-commit side effects were placed after `commit`, matching AC #6 here
- `cargo test` baseline was 165 tests; `cargo check` was required warning-free
- Story 23.1 needed an approved scope exception when a shared model change rippled into unrelated files. This story adds only **new** types and a **new** module, so no ripple is expected — if you find yourself editing `db/budget.rs`, `db/recurring.rs`, or `commands/*`, stop: that is a scope violation, not a necessity

### Recent Commit Context

Last commits are UI/AI-chat fixes plus `fix(budget): show actionable errors when category delete is blocked` and `fix: where you can't delete a category due to past spending` — both touched `db/budget.rs`'s delete path (soft-delete + `merchant_category_hints` cleanup, `db/budget.rs:244-291`). Read that function before assuming anything about budget-category lifecycle, but do not modify it. No template work exists in history — this is greenfield.

### UX Note

No UX-DR covers budget templates; `ux-design-specification.md` predates the 2026-08-01 FR70 amendment. This story is backend-only with no user-visible surface, so no UX decision is required here. The `$1.00` default target from Conflict 1 is the one downstream-visible consequence and should be raised during Story 24.4 / 25.3 UX review.

### References

- [Source: _bmad-output/planning-artifacts/epics-budget-templates.md — Epic 24, Story 24.1 ACs; Requirements Inventory (Additional Requirements)]
- [Source: _bmad-output/planning-artifacts/architecture-budget-templates.md — Decisions 1/3/4/5; Implementation Patterns & Consistency Rules; Project Structure & Implementation Map]
- [Source: _bmad-output/planning-artifacts/prd.md — FR96 (line 600), FR70 (line 532), FR71 (line 533), NFR11 (line 626), NFR13 (line 628)]
- [Source: docs/project-context.md — §1 integer cents, §3 db/commands separation, §4 model derives, §5 AppError, §9 warnings policy, Rust naming conventions]
- [Source: docs/guidelines/warnings.md — dead-code resolution policy]
- [Source: apps/desktop/src-tauri/src/db/budget.rs:6,46,64,244,384 — create/read fns, `target_cents <= 0` rejection, test-db pattern]
- [Source: apps/desktop/src-tauri/src/db/audit.rs:5 — `insert_audit_log` arg order]
- [Source: apps/desktop/src-tauri/src/db/expense.rs:59-107 — `unchecked_transaction` pattern]
- [Source: apps/desktop/src-tauri/src/error.rs:9,92 — `AppError::File`, `From<rusqlite::Error>`]
- [Source: apps/desktop/src-tauri/src/commands/account.rs:31 — non-fatal audit pattern]
- [Source: apps/desktop/src-tauri/src/maintenance/defaults.rs:4-24 — const-array precedent for Story 25.1]
- [Source: apps/desktop/src-tauri/migrations/006_audit_log.sql — `audit_log` DDL for the test helper]
- [Source: _bmad-output/implementation-artifacts/23-1-transaction-account-linking-backend.md — prior backend story patterns and test baseline]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

Verification output (run in `apps/desktop/src-tauri/`):

```
$ cargo check --message-format=short
    Checking nkbaz-finance v0.3.1 (/Users/nbazinet/projects/nixus/apps/desktop/src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.70s
                                        # zero warnings

$ cargo check --all-targets --message-format=short   # includes #[cfg(test)] code
                                        # zero warnings

$ cargo clippy --all-targets
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 5.74s
                                        # zero warnings

$ cargo test
test result: ok. 198 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
(main.rs unittests: 0 passed · doc-tests: 0 passed)

$ cargo test budget_template
test db::budget_template::tests::const_template_is_constructible_and_valid ... ok
test db::budget_template::tests::apply_system_template_creates_groups_and_categories ... ok
test db::budget_template::tests::import_valid_file_uses_default_target_for_missing_amounts ... ok
test db::budget_template::tests::import_invalid_version_is_rejected_before_any_write ... ok
test db::budget_template::tests::validate_rejects_structural_and_bounds_violations ... ok
test db::budget_template::tests::duplicate_group_skip_excludes_its_categories ... ok
test db::budget_template::tests::duplicate_group_within_template_skips_the_second ... ok
test db::budget_template::tests::rollback_leaves_no_rows ... ok
test db::budget_template::tests::audit_row_written_once_per_apply ... ok
test db::budget_template::tests::all_groups_skipped_still_succeeds_and_audits ... ok
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 188 filtered out
```

Frontend regression gate (no frontend files changed, run for confirmation):

```
$ pnpm --filter @nixus/desktop exec tsc --noEmit
                                        # exit 0, no output
```

`cargo fmt --check` could not be run: `error: 'cargo-fmt' is not installed for the toolchain
'stable-aarch64-apple-darwin'`. Same environment limitation recorded in Story 23.1 — noted per
Dev Notes §Project Structure Notes rather than hand-reformatting. Formatting follows the
surrounding `db/` modules.

Note: the workspace package scope is `@nixus/*` (not `@nkbaz/*` as `docs/project-context.md`
still states); `pnpm --filter @nkbaz/desktop` matches no project. Pre-existing doc drift, not
touched by this story.

### Completion Notes List

**Test baseline:** 188 → **198** tests (10 new, all in `db::budget_template::tests`). No
pre-existing test was modified. Dev Notes cited a 165-test baseline from Story 23.1; the actual
pre-change count on `master` at `baseline_commit` was 188 — other in-flight work landed tests
since. No regressions either way.

**Task 1 — models (AC #1, #2).** Added `use std::borrow::Cow;` and the four structs verbatim from
Dev Notes §Type Definitions, inserted between `BudgetCategoryStatus` and `Expense`. All four derive
exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`. `format_version` carries no
`#[serde(default)]`, so a missing field fails deserialization (asserted in
`import_invalid_version_is_rejected_before_any_write`). Conflict 3's `Cow` resolution holds: the
`const SMOKE_TEMPLATE` in the test module compiles, proving Story 25.1's
`pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate]` will compile against these definitions
unchanged.

**Tasks 2–6 — `db/budget_template.rs` (AC #3–#9).** New module, registered as
`pub mod budget_template;` immediately after `pub mod budget;` in `db/mod.rs`. The five public
constants and the two message constants are declared verbatim. Public surface (documented with
doc comments for the downstream stories):

- `pub fn apply_budget_template_json(conn: &Connection, json: &str) -> Result<ApplyBudgetTemplateResult, AppError>` — deserialize (any serde failure → `MSG_INVALID_FILE`), then apply with `source = "import"`.
- `pub fn apply_system_budget_template(conn: &Connection, template: &SystemBudgetTemplate) -> Result<ApplyBudgetTemplateResult, AppError>` — apply with `source = "system"`, no JSON round-trip (Story 25.1's entry point).

Private internals: `validate_budget_template`, `validate_template_name`, `invalid_file`,
`apply_template_inner`, `write_apply_audit_log`.

Order of operations in `apply_template_inner`: `validate_budget_template(template)?` →
`conn.unchecked_transaction()?` → one `get_budget_groups(&tx)` read into a lowercased/trimmed
collision list → per-group create/skip → `tx.commit()?` → audit → `Ok(result)`. Rollback relies on
`Transaction`'s `Drop` (the `db/expense.rs` form). Newly created group names are pushed onto the
collision list, so a template containing two same-named groups skips the second
(`duplicate_group_within_template_skips_the_second`). `sort_order` is never set — both existing
`db/budget.rs` functions derive it from `MAX(sort_order)+1`, so array order is preserved
(asserted in `apply_system_template_creates_groups_and_categories`).

**Task 5 — audit (AC #6, #7).** One `audit_db::insert_audit_log(conn, "budget_template", 0,
"apply", None, Some(summary))` call after `tx.commit()`, wrapped in `if let Err(e) = ... {
tracing::error!(...) }` so failure never fails or rolls back the apply. The db-layer placement
(deviation from `docs/project-context.md` §3) is documented with a WHY comment at the call site.
One mechanical adjustment to Task 5's snippet: the summary is a `String`, so the argument is
`Some(summary.as_str())` — `Some(&summary)` is `Option<&String>` and does not coerce to
`Option<&str>`.

**Task 6 — dead code (AC #10).** Both public functions carry `#[allow(dead_code)]` with a WHY
comment naming the consuming story (24.2/24.4 and 25.1). Because `#[allow(dead_code)]` items are
live roots for rustc's reachability pass, everything they reach — the four new model structs, all
five public constants, and both message constants — is live, so no other `#[allow]` was needed and
nothing was deleted. `cargo check --all-targets` and `cargo clippy --all-targets` are both clean.

**Task 7 — tests (AC #11).** `template_test_db()` copied verbatim (includes `audit_log`). Ten
tests: `const_template_is_constructible_and_valid` (const smoke + validates),
`apply_system_template_creates_groups_and_categories` (counts, rows, array order, `source":"system"`
+ `template_id`), `import_valid_file_uses_default_target_for_missing_amounts` (explicit `null` **and**
omitted `target_cents` both land on `DEFAULT_TEMPLATE_TARGET_CENTS`, a present value is preserved),
`import_invalid_version_is_rejected_before_any_write` (`99` → `MSG_VERSION_TOO_NEW`; `0`, `-1`,
missing `format_version`, `"{"`, non-JSON → `MSG_INVALID_FILE`; zero rows and zero audit rows
after all six), `validate_rejects_structural_and_bounds_violations` (empty `groups`, empty
`categories`, whitespace group/category names, `target_cents` `-1` and `MAX+1`, over-long group and
category names, `MAX_TEMPLATE_CATEGORIES + 1` rejected **and** exactly `MAX_TEMPLATE_CATEGORIES`
accepted), `duplicate_group_skip_excludes_its_categories` (seeded `'Needs'` vs template
`'  needs  '` → `skipped_groups == ["needs"]`, its category absent),
`duplicate_group_within_template_skips_the_second`, `rollback_leaves_no_rows`,
`audit_row_written_once_per_apply` (exact `entity_type`/`entity_id`/`action`/`old_value IS NULL`
and `new_value` contents), `all_groups_skipped_still_succeeds_and_audits` (AC #7: `Ok` with zeros,
both names skipped, audit row still written with `"groups":0,"categories":0`).

**Rollback test mechanism.** Task 7 noted that a name which passes template validation but trips
`create_budget_category` is impossible. `target_cents: 0` is that lever: it is inside the
AC #9-mandated `0..=MAX_TEMPLATE_TARGET_CENTS` range, so template validation accepts it, while
`db/budget.rs:76` rejects `target_cents <= 0`. `rollback_leaves_no_rows` uses a group whose first
category inserts cleanly and whose second carries `target_cents: 0`, then asserts
`budget_groups`, `budget_categories` and `audit_log` are all still empty — proving AC #5 for a
mid-apply DB failure, not just a pre-transaction validation failure.

**Flagged for Story 24.2 (not a deviation — spec followed literally).** As a consequence of the
above, a template with an explicit `target_cents: 0` surfaces `AppError::Validation { field:
"target_cents" }` from the db layer rather than `AppError::File`. This follows AC #8/#9 exactly
(`unwrap_or(DEFAULT_TEMPLATE_TARGET_CENTS)` applies to `None` only, and `0` is inside the accepted
range), and NFR11 is upheld — the transaction rolls back with zero rows. Story 24.2, which owns the
exhaustive per-rule negative matrix at the command boundary, should decide whether `0` deserves a
`MSG_INVALID_FILE` rejection during validation or a mapping to `DEFAULT_TEMPLATE_TARGET_CENTS`.

**Product/UX flag (Conflict 1, unchanged from Dev Notes).** Amount-stripped imports land at
`$1.00` per category. Raise during Story 24.4 / 25.3 UX review.

**Scope confirmation (Task 8).** Exactly three files touched. `db/budget.rs`, `db/audit.rs`,
`error.rs`, `lib.rs`, `commands/**`, `migrations/**` and all frontend files are untouched
(`git status`/`git diff --stat` verified). No new dependency, no new `AppError` variant, no
migration, no command registration. No commits were made.

### File List

- `apps/desktop/src-tauri/src/models/mod.rs` (modified) — `use std::borrow::Cow;` + `SystemBudgetTemplate`, `TemplateGroupDef`, `TemplateCategoryDef`, `ApplyBudgetTemplateResult`
- `apps/desktop/src-tauri/src/db/mod.rs` (modified) — `pub mod budget_template;`
- `apps/desktop/src-tauri/src/db/budget_template.rs` (new) — constants, `validate_budget_template`, `apply_template_inner`, audit hook, `apply_budget_template_json`, `apply_system_budget_template`, `#[cfg(test)] mod tests`

## Change Log

- 2026-08-04: Story context created (ready-for-dev).
- 2026-08-04: Implemented Tasks 1-8 — template schema types in `models/mod.rs`, new `db/budget_template.rs` (validation, transactional apply, post-commit non-fatal audit, two public entry points), `db/mod.rs` registration, 10 new `#[cfg(test)]` tests. `cargo check`/`cargo check --all-targets`/`cargo clippy --all-targets` warning-free; `cargo test` 198 passed / 0 failed. Status → review.
- 2026-08-04: Adversarial code review (bmad-code-review) — PASS. All 11 ACs independently re-verified against code + a fresh `cargo check --all-targets` / `cargo clippy --all-targets` / `cargo test` run (198 passed, matches self-report exactly). Three parallel review layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) raised ~20 observations; 2 trivial doc/logging patches left as open action items above, the rest dismissed as false positives, spec-mandated behavior, or already owned by Story 24.2/24.4/25.1 per this story's own Scope Boundary table. The self-reported `target_cents: 0` deviation was independently verified: `rollback_leaves_no_rows` empirically proves the transaction leaves zero rows via `rusqlite::Transaction`'s `Drop`-rollback — not a defect. Status → in-progress (2 open patch items pending a decision on auto-apply vs. leave-as-action-items).
- 2026-08-04: Applied both open review patches — logged the discarded `serde_json` parse error (`tracing::debug!`) and scoped the `validate_budget_template` doc comment's `AppError::File` claim to validation-only rejections. Both non-functional. Re-ran `cargo check --all-targets` / `cargo clippy --all-targets` (zero warnings) / `cargo test` (198 passed, 0 failed — unchanged). Scope still minimal: only `db/mod.rs`, `models/mod.rs`, `db/budget_template.rs`. All review findings resolved, no unresolved HIGH/MEDIUM issues. Status → done.
