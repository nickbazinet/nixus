---
baseline_commit: 1bc542762f39223e091c1f9d297fd2b0b8e9cc3e
---

# Story 25.1: Canadian Starter Template Definition & List/Apply Commands

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the Canadian starter template defined as a compiled Rust const and exposed via list/apply commands,
so that the onboarding and Settings flows can offer a system template without any file I/O.

**Scope:** Rust backend only — new top-level module `src/budget/` (`mod.rs` + `template_defaults.rs`) holding `SYSTEM_TEMPLATES` / `CANADIAN_STARTER`, one new model (`SystemBudgetTemplateSummary`), two new Tauri commands appended to `commands/budget_template.rs`, `mod budget;` + two `generate_handler!` lines in `lib.rs`, removal of one now-obsolete `#[allow(dead_code)]` in `db/budget_template.rs`, and `#[cfg(test)]` coverage in two places. **No frontend, no hook, no `lib/types.ts`, no `queryKeys`, no i18n, no onboarding, no Settings UI, no Playwright, no migration, no new dependency.**

**FRs:** FR70 (starter-template fork — backend half) · **NFRs:** NFR11 (never silently lose/corrupt records), NFR13 (accurate to the cent)
**Epic:** [epics-budget-templates.md § Epic 25, Story 25.1](../planning-artifacts/epics-budget-templates.md)
**Architecture:** [architecture-budget-templates.md](../planning-artifacts/architecture-budget-templates.md) — **Decision 1** (no DB table), **Decision 2** (compiled-const system templates), § API & Communication Patterns, § Project Structure & Implementation Map
**Predecessors:** [Story 24.1](24-1-template-schema-models-core-apply-function.md) (**hard**), [Story 24.2](24-2-import-validation-for-untrusted-template-files.md) / [24.3](24-3-export-current-budget-as-shareable-template.md) (**soft** — see Prerequisites)

---

## ⛔ PREREQUISITES — READ FIRST

Verified at story-creation time (2026-08-04): **nothing from Epic 24 is implemented.** All four Epic 24 stories are `ready-for-dev`, `git log` contains zero template commits, and `src/budget/`, `db/budget_template.rs`, `commands/budget_template.rs` do not exist.

**Run this gate before writing any code:**

```bash
cd /Users/nbazinet/projects/nixus
grep -n "ApplyBudgetTemplateResult\|SystemBudgetTemplate" apps/desktop/src-tauri/src/models/mod.rs
grep -n "apply_system_budget_template\|SUPPORTED_TEMPLATE_FORMAT_VERSION" apps/desktop/src-tauri/src/db/budget_template.rs
ls apps/desktop/src-tauri/src/commands/budget_template.rs
```

| Gate | Result | Action |
|---|---|---|
| `models/mod.rs` lacks `SystemBudgetTemplate` / `TemplateGroupDef` / `TemplateCategoryDef` / `ApplyBudgetTemplateResult`, **or** `db/budget_template.rs` lacks `apply_system_budget_template` | **HARD STOP** | Report "Story 24.1 is not done." Do **not** re-implement 24.1 here. |
| `commands/budget_template.rs` missing (24.2 not done) | **SOFT** | Create the file in this story with only the two new commands, and add `pub mod budget_template;` to `commands/mod.rs` between `pub mod budget;` (line 4) and `pub mod chat;` (line 5). See Task 4. |
| `commands/budget_template.rs` exists | **SOFT** | **Append** the two commands to it. Do not touch `import_budget_template` / `export_budget_template`. |

**If 24.1 named anything differently than assumed below, use 24.1's actual names** and record the deviation in Completion Notes.

---

## Acceptance Criteria

1. **Given** `apps/desktop/src-tauri/src/budget/template_defaults.rs` (new file) and `apps/desktop/src-tauri/src/budget/mod.rs` (new file containing exactly `pub mod template_defaults;`)
   **When** this story is implemented
   **Then** `template_defaults.rs` defines `pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate] = &[CANADIAN_STARTER];`
   **And** `CANADIAN_STARTER` is a `const SystemBudgetTemplate` built from the **verbatim** data in Dev Notes §Canadian Starter Content (Copy Verbatim) — **4 groups, exactly 12 categories**
   **And** it reuses Story 24.1's `models::{SystemBudgetTemplate, TemplateGroupDef, TemplateCategoryDef}` with their `Cow<'static, _>` fields — no parallel `&'static str` struct family is introduced

2. **Given** `CANADIAN_STARTER`
   **When** declared
   **Then** `format_version` is written as `crate::db::budget_template::SUPPORTED_TEMPLATE_FORMAT_VERSION` (not a literal `1`), so the const can never drift from the validator's accepted version
   **And** `id` is `Some(Cow::Borrowed(CANADIAN_STARTER_ID))` with `pub const CANADIAN_STARTER_ID: &str = "canadian-starter";`
   **And** **every** one of the 12 categories has `target_cents: Some(n)` where `n > 0` — never `None`, never `Some(0)` (FR70 requires *pre-filled* targets; `None`/`Some(0)` would silently become `DEFAULT_TEMPLATE_TARGET_CENTS` = `$1.00`)

3. **Given** `template_defaults.rs`
   **When** implemented
   **Then** it exposes `pub fn find_system_template(id: &str) -> Option<&'static SystemBudgetTemplate>` doing an exact-match lookup over `SYSTEM_TEMPLATES` (mirroring `maintenance/defaults.rs:25` `baseline_for`)
   **And** the lookup never panics and never indexes by position

4. **Given** `models/mod.rs`
   **When** updated
   **Then** it defines `pub struct SystemBudgetTemplateSummary { pub id: String, pub name: String, pub description: Option<String> }` with `#[derive(Debug, Clone, Serialize, Deserialize)]` and `snake_case` fields
   **And** it is inserted immediately after Story 24.1's `ApplyBudgetTemplateResult` (budget-domain clustering)
   **And** it contains **no** `target_cents`, **no** `groups`, and **no** `format_version` — it is an id/name/description projection only (epic AC: "no target amounts included in this response")

5. **Given** the `list_system_templates` Tauri command in `commands/budget_template.rs`
   **When** invoked
   **Then** its signature is `#[tauri::command(rename_all = "snake_case")] pub fn list_system_templates() -> Result<Vec<SystemBudgetTemplateSummary>, AppError>`
   **And** it takes **no** `State<DbState>` and performs **no** DB access and **no** file I/O — it maps `SYSTEM_TEMPLATES` in declaration order
   **And** for `SYSTEM_TEMPLATES` as shipped it returns exactly one summary: `{ id: "canadian-starter", name: "Canadian Starter Budget", description: Some(..) }`

6. **Given** the `apply_system_template` Tauri command
   **When** invoked with a valid `template_id`
   **Then** its signature is `#[tauri::command(rename_all = "snake_case")] pub fn apply_system_template(state: State<DbState>, template_id: String) -> Result<ApplyBudgetTemplateResult, AppError>`
   **And** it resolves the template via `find_system_template(&template_id)` **before** locking `DbState`
   **And** it applies it via `db::budget_template::apply_system_budget_template(&conn, template)` — the no-JSON-round-trip entry point Story 24.1 built for this story
   **And** it does **not** call `apply_budget_template_json`, does **not** call `serde_json::to_string`, and touches **no** file (epic AC: "no file I/O")
   **And** it contains **no** `insert_audit_log` call of its own — Story 24.1's primitive already writes exactly one row with `"source":"system"`

7. **Given** `apply_system_template`
   **When** invoked with an unknown, empty, or wrong-cased `template_id`
   **Then** it returns `Err(AppError::Validation { message: "That starter template is not available.", field: Some("template_id") })` — **not** a panic, **not** `AppError::File`, **not** `unwrap()`/`expect()`
   **And** the rejected id is recorded only via `tracing::warn!` — never echoed into the user-visible message
   **And** `DbState` is never locked and no DB row is created

8. **Given** a fresh budget with no existing groups
   **When** `apply_system_template("canadian-starter")` succeeds
   **Then** it returns `ApplyBudgetTemplateResult { groups_created: 4, categories_created: 12, skipped_groups: [] }`
   **And** the 12 created `budget_categories` rows carry the exact `target_cents` values from the const — no value equals `DEFAULT_TEMPLATE_TARGET_CENTS` by substitution
   **And** `budget_groups` / `budget_categories` `sort_order` follows const array order (derived by `create_budget_group`/`create_budget_category`; this story sets no `sort_order`)

9. **Given** a user who already has a group whose name case-insensitively matches one of the starter groups
   **When** `apply_system_template("canadian-starter")` runs
   **Then** Story 24.1's existing group-granularity skip applies unchanged — the colliding group's name lands in `skipped_groups` and none of its categories are created
   **And** this story adds **no** second collision check and **no** merge logic

10. **Given** `lib.rs`
    **When** updated
    **Then** `mod budget;` is added alphabetically between `mod ai;` (line 1) and `mod commands;` (line 2)
    **And** `commands::budget_template::list_system_templates,` and `commands::budget_template::apply_system_template,` appear in `tauri::generate_handler!`, contiguous with the other budget-template commands
    **And** `export_budget_template` / `import_budget_template` (Epic 24) are also present in `generate_handler!` — if either is absent, that is Epic 24 work, recorded in Completion Notes, **not** implemented here

11. **Given** `db/budget_template.rs`
    **When** this story lands
    **Then** the `#[allow(dead_code)]` + WHY comment that Story 24.1 placed on `apply_system_budget_template` is **removed** — this story is its first real caller
    **And** no other line of `db/budget_template.rs` behaviour is changed (tests are additive only)
    **And** `cd apps/desktop/src-tauri && cargo check` produces **zero warnings**

12. **Given** `budget/template_defaults.rs`'s `#[cfg(test)] mod tests` (pure-data assertions, no DB)
    **When** `cargo test` runs
    **Then** these pass: `canadian_starter_has_four_groups_and_twelve_categories`; `every_category_target_is_prefilled_and_positive`; `system_template_ids_are_present_and_unique`; `find_system_template_round_trips`; `find_system_template_unknown_id_is_none`; `all_names_within_length_bound`

13. **Given** `db/budget_template.rs`'s **existing** `#[cfg(test)] mod tests` (extended, reusing Story 24.1's `template_test_db()`)
    **When** `cargo test` runs
    **Then** these pass: `system_templates_all_pass_validation` (every entry through the private `validate_budget_template` → `Ok`); `canadian_starter_applies_to_empty_budget` (4/12/empty-skips + stored `target_cents` equal the const values); `canadian_starter_writes_one_system_audit_row` (one `audit_log` row, `entity_type = 'budget_template'`, `action = 'apply'`, `entity_id = 0`, `new_value` contains `"source":"system"` and `"template_id":"canadian-starter"`)
    **And** all pre-existing tests (including Story 24.1–24.3's) still pass

---

## Tasks / Subtasks

- [x] **Task 0: Prerequisite gate** (see ⛔ PREREQUISITES)
  - [x] Run the three gate commands; HARD STOP if 24.1 is missing
  - [x] Read `db/budget_template.rs` end-to-end and record the **actual** names of: `apply_system_budget_template`, `validate_budget_template`, `SUPPORTED_TEMPLATE_FORMAT_VERSION`, `MAX_TEMPLATE_NAME_LEN`, `MAX_TEMPLATE_TARGET_CENTS`, `DEFAULT_TEMPLATE_TARGET_CENTS`, `template_test_db()`
  - [x] Read `models/mod.rs`'s template struct block and confirm the `Cow<'static, _>` field shapes

- [x] **Task 1: Create the `budget/` module** (AC: #1)
  - [x] `mkdir apps/desktop/src-tauri/src/budget`
  - [x] Create `apps/desktop/src-tauri/src/budget/mod.rs` containing exactly one line: `pub mod template_defaults;` (mirrors `maintenance/mod.rs`, which is 4 such lines and nothing else)
  - [x] `lib.rs`: insert `mod budget;` between `mod ai;` (line 1) and `mod commands;` (line 2) — **private**, exactly like `mod maintenance;` (line 7)
  - [x] Do **not** move, re-export, or alias `db/budget.rs` or `commands/budget.rs`. `crate::budget`, `crate::db::budget`, and `crate::commands::budget` are three distinct paths and coexist exactly as `crate::maintenance` / `crate::db::maintenance` / `crate::commands::maintenance` already do

- [x] **Task 2: Author `budget/template_defaults.rs`** (AC: #1, #2, #3)
  - [x] Imports: `use std::borrow::Cow;`, `use crate::db::budget_template::SUPPORTED_TEMPLATE_FORMAT_VERSION;`, `use crate::models::{SystemBudgetTemplate, TemplateCategoryDef, TemplateGroupDef};`
  - [x] Copy the whole const block **verbatim** from Dev Notes §Canadian Starter Content (Copy Verbatim) — do not re-derive the category names or amounts
  - [x] Add `pub fn find_system_template(id: &str) -> Option<&'static SystemBudgetTemplate>` → `SYSTEM_TEMPLATES.iter().find(|t| t.id.as_deref() == Some(id))`
  - [x] If `pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate] = &[CANADIAN_STARTER];` fails to compile on const promotion, apply the documented escape hatch in Dev Notes §Const-Promotion Fallback — do **not** switch to `static`, `Lazy`, or `OnceLock`

- [x] **Task 3: Add `SystemBudgetTemplateSummary` to `models/mod.rs`** (AC: #4)
  - [x] Insert immediately after Story 24.1's `ApplyBudgetTemplateResult`
  - [x] ```rust
        #[derive(Debug, Clone, Serialize, Deserialize)]
        pub struct SystemBudgetTemplateSummary {
            pub id: String,
            pub name: String,
            pub description: Option<String>,
        }
        ```
  - [x] Owned `String` (not `Cow`) — this type is IPC output only and is never `const`-constructed
  - [x] No `impl` block: `models/mod.rs` is plain data. The `SystemBudgetTemplate → Summary` mapping lives in the command (Task 4)
  - [x] This is the **only** edit to `models/mod.rs` in this story

- [x] **Task 4: Add the two commands to `commands/budget_template.rs`** (AC: #5, #6, #7)
  - [x] If the file is absent (24.2 not done): create it and add `pub mod budget_template;` to `commands/mod.rs` between line 4 (`pub mod budget;`) and line 5 (`pub mod chat;`)
  - [x] Ensure these imports exist (add only what is missing; do not duplicate 24.2/24.3's):
        ```rust
        use tauri::State;

        use crate::budget::template_defaults::{self, SYSTEM_TEMPLATES};
        use crate::db::budget_template as budget_template_db;
        use crate::db::DbState;
        use crate::error::AppError;
        use crate::models::{ApplyBudgetTemplateResult, SystemBudgetTemplateSummary};
        ```
  - [x] Append `list_system_templates` verbatim from Dev Notes §Command Bodies (Copy Verbatim)
  - [x] Append `apply_system_template` verbatim from Dev Notes §Command Bodies (Copy Verbatim)
  - [x] Both are **sync** `pub fn` (no `async`) — unlike 24.2/24.3's dialog commands, neither opens a dialog, so the `async` + `AppHandle` shape is unnecessary. Mirror `commands/budget.rs:8-19` instead
  - [x] Add a WHY comment on `apply_system_template` stating that the audit row is written by `db/budget_template.rs`'s primitive, so nobody "fixes" the apparent omission against `project-context.md` §3
  - [x] Do **not** modify `import_budget_template` or `export_budget_template`

- [x] **Task 5: Register both commands in `lib.rs`** (AC: #10)
  - [x] Insert into `tauri::generate_handler!` (starts `lib.rs:91`) keeping the budget-template block contiguous:
        ```rust
        commands::budget::get_all_budget_categories,          // lib.rs:102 (existing)
        commands::budget_template::import_budget_template,    // 24.2, if present
        commands::budget_template::export_budget_template,    // 24.3, if present
        commands::budget_template::list_system_templates,     // <-- add
        commands::budget_template::apply_system_template,     // <-- add
        commands::expense::create_expense,                    // lib.rs:103 (existing)
        ```
  - [x] If the 24.2/24.3 lines are absent, insert this story's two lines directly after `commands::budget::get_all_budget_categories,` (line 102)
  - [x] `generate_handler!` is **domain-grouped, not globally alphabetical** — do not resort the macro
  - [x] Add no plugin, no `Cargo.toml` change, no `main.rs` change

- [x] **Task 6: Remove the obsolete dead-code allowance** (AC: #11)
  - [x] Delete `#[allow(dead_code)]` and its WHY comment from `apply_system_budget_template` in `db/budget_template.rs`
  - [x] Leave every other attribute in that file untouched
  - [x] `cargo check` → zero warnings. If a `dead_code` warning appears for anything new, fix it per Dev Notes §Dead Code — never delete code to silence it

- [x] **Task 7: Tests in `budget/template_defaults.rs`** (AC: #12)
  - [x] Add `#[cfg(test)] mod tests { use super::*; ... }` (mirrors `maintenance/defaults.rs:29`)
  - [x] `canadian_starter_has_four_groups_and_twelve_categories`: `CANADIAN_STARTER.groups.len() == 4`; sum of `g.categories.len() == 12`
  - [x] `every_category_target_is_prefilled_and_positive`: for every category, `matches!(c.target_cents, Some(n) if n > 0)` — assert with a message naming the offending category
  - [x] `system_template_ids_are_present_and_unique`: every entry `t.id.as_deref()` is `Some(s)` with `!s.trim().is_empty()`; collect and assert no duplicates
  - [x] `find_system_template_round_trips`: `find_system_template(CANADIAN_STARTER_ID)` is `Some`, and its `id.as_deref() == Some(CANADIAN_STARTER_ID)`
  - [x] `find_system_template_unknown_id_is_none`: `""`, `"nope"`, and `"CANADIAN-STARTER"` all return `None` (lookup is exact and case-sensitive)
  - [x] `all_names_within_length_bound`: every group and category name is non-empty after `trim()` and `trim().chars().count() <= 100`. Reference `crate::db::budget_template::MAX_TEMPLATE_NAME_LEN` rather than the literal `100`

- [x] **Task 8: Tests in `db/budget_template.rs`** (AC: #13)
  - [x] Extend the **existing** `#[cfg(test)] mod tests`. Reuse Story 24.1's `template_test_db()` — do **not** define a second helper
  - [x] Add `use crate::budget::template_defaults::{find_system_template, CANADIAN_STARTER_ID, SYSTEM_TEMPLATES};`
  - [x] `system_templates_all_pass_validation`: loop `SYSTEM_TEMPLATES`, `assert!(validate_budget_template(t).is_ok(), "{:?}", t.id)` — this test is the guardrail that a future added template cannot ship invalid (the private validator is reachable here via `use super::*`)
  - [x] `canadian_starter_applies_to_empty_budget`: on a fresh `template_test_db()`, `apply_system_budget_template(&conn, find_system_template(CANADIAN_STARTER_ID).unwrap())` → `groups_created == 4`, `categories_created == 12`, `skipped_groups.is_empty()`; then `SELECT name, target_cents FROM budget_categories ORDER BY id` and assert every row's `target_cents` matches the const **and** that no row equals `DEFAULT_TEMPLATE_TARGET_CENTS` unless the const says so (it never does)
  - [x] `canadian_starter_writes_one_system_audit_row`: after the apply, `SELECT COUNT(*) FROM audit_log` is `1`; `entity_type = 'budget_template'`, `action = 'apply'`, `entity_id = 0`; `new_value` contains `"source":"system"` and `"template_id":"canadian-starter"`
  - [x] Assert errors by matching the variant, per `db/budget.rs:511-517`: `match err { AppError::Validation { message, field } => ..., other => panic!("...{other:?}") }`

- [x] **Task 9: Verification** (AC: #11, #12, #13)
  - [x] `cd apps/desktop/src-tauri && cargo check` → **zero warnings**
  - [x] `cd apps/desktop/src-tauri && cargo test` → all pass; record the new total in Completion Notes (do **not** hardcode an expected count — the Epic 24 stories add tests too)
  - [x] Confirm untouched: `db/budget.rs`, `db/audit.rs`, `error.rs`, `db/mod.rs`, `main.rs`, `Cargo.toml`, `migrations/`, all of `apps/desktop/src/**`, `apps/desktop/src/locales/*.json`, `apps/desktop/tests/**`
  - [x] `git diff --stat` should show exactly: `src/budget/mod.rs` (new), `src/budget/template_defaults.rs` (new), `src/models/mod.rs`, `src/commands/budget_template.rs`, `src/lib.rs`, `src/db/budget_template.rs`, and `src/commands/mod.rs` **only if** 24.2 had not already added its line
  - [x] Do **not** commit

### Review Findings

**Patch (fixed by reviewer):**
- [x] [Review][Patch] AC #5 coverage gap: `list_system_templates`'s field mapping (id/name/description) was unasserted — `SYSTEM_TEMPLATES` being a single-element const only proves cardinality, not that the mapping is correct [src/commands/budget_template.rs]. Added `list_system_templates_returns_exactly_one_canadian_starter_summary`; `cargo test` 250 → 251, all passing; `cargo check --all-targets` / `cargo clippy --all-targets -- -D warnings` remain clean.

**Dismissed (1, not a coverage hole):**
- AC #7's "`DbState` is never locked" / error-shape claim is unit-tested only at the `find_system_template` lookup half. Reviewed and judged **not** a gap: no file in this codebase unit-tests a `#[tauri::command]` function that takes `State<DbState>` directly (`commands/backup.rs` and `commands/import.rs` are the only command files with `#[cfg(test)] mod tests`, and both test only pure helper functions, never the command fn itself). The `apply_system_template` body is 15 straight-line statements with no branching complexity; this review confirmed by direct inspection that `state.0.lock()` occurs strictly after the `None` arm's early `return`. Consistent with codebase-wide convention — not a 25-1-specific regression risk.

**Notes for product/follow-up (informational — no code change; not a 25-1 defect):**
- The 12 targets sum to exactly $5,000.00/month (`500_000` cents), one hardcoded suggested total applied identically regardless of the user's actual income. This is mandated verbatim by this story's Dev Notes (itself following Architecture Decision 2 — single compiled template) and the story's own §UX/i18n Note already flags it for Stories 25.3/25.4 ("must present them as editable"). Recorded here again for the PM/architect: confirm 25.3/25.4 make "these are editable suggestions" unmissable, since a user who applies-and-doesn't-edit silently commits to a generic $5,000 Canadian budget.
- Re-applying `apply_system_template("canadian-starter")` onto a budget that already has groups named `Housing`/`Transportation`/`Living`/`Savings` (whether from a prior apply or the user's own naming) returns a normal `Ok(ApplyBudgetTemplateResult { groups_created: 0, categories_created: 0, skipped_groups: [the 4 names] })` — 24.1's inherited group-granularity skip, unchanged and out of 25-1's scope. Flagging for 25.2/25.3: the mutation "succeeds" with zero effect, so the UI should distinguish "applied" from "nothing new was added" rather than showing a generic success toast.

---

## Dev Notes

### Critical Rules (DO NOT VIOLATE)

1. **Reuse Story 24.1's types and apply core. Do not fork them.** `SystemBudgetTemplate` / `TemplateGroupDef` / `TemplateCategoryDef` / `ApplyBudgetTemplateResult` already exist in `models/mod.rs`; `apply_system_budget_template` already exists in `db/budget_template.rs` and was built specifically for this story. [Source: 24-1 §Out of Scope, Task 6]
2. **`db/budget.rs`, `db/audit.rs`, `error.rs` are read-only.** No new `AppError` variant, no relaxed `create_budget_category`, no raw `INSERT`. [Source: architecture § Files explicitly NOT modified]
3. **`db/budget_template.rs` gets exactly two edits:** remove one `#[allow(dead_code)]`, and add tests. No behavioural change. Story 24.2's `Some(0)` normalization and Story 24.1's validator stay as written.
4. **No file I/O anywhere in this story.** A system template is a compiled const. `apply_system_template` must not serialize to JSON, must not touch the filesystem, must not open a dialog. [Source: epic AC 25.1; architecture Decision 1]
5. **Zero compilation warnings.** [Source: docs/project-context.md §9, docs/guidelines/warnings.md]
6. **No frontend, no `lib/types.ts`, no `queryKeys`, no i18n, no onboarding, no Settings UI, no Playwright, no migration.**
7. **Never introduce a bare `Template` type.** See §Naming Collision Warning.

### Validation: What Runs, What Is Skippable (explicit — do not guess)

A system template is **trusted input** (compiled Rust const, not an untrusted file), but that does **not** mean validation is bypassed. `apply_system_budget_template` → `apply_template_inner` → `validate_budget_template` runs **unconditionally**. Do not add a "trusted, skip validation" path.

| Check (Story 24.2's untrusted-file posture) | Runs for a system template? | Why |
|---|---|---|
| `validate_budget_template` full rule set | **YES — runs, unchanged** | Inside `apply_template_inner`; not conditional on source. The const **must satisfy it by construction** — Task 8's `system_templates_all_pass_validation` is the guardrail |
| `format_version == SUPPORTED_TEMPLATE_FORMAT_VERSION` | Runs; **can never fail** | AC #2 makes the const reference the same symbol, so drift is impossible |
| `MSG_VERSION_TOO_NEW` branch | **Unreachable** | A const at the supported version can never be "too new". Do not write a test for it here (24.2 owns it) |
| Non-empty / ≤ `MAX_TEMPLATE_NAME_LEN` names | Runs; satisfied by construction | Longest authored name is 29 chars. Locked by `all_names_within_length_bound` |
| `target_cents` in `0..=MAX_TEMPLATE_TARGET_CENTS` | Runs; satisfied by construction | Largest authored target is `180_000` |
| Total categories ≤ `MAX_TEMPLATE_CATEGORIES` (100) | Runs; satisfied by construction | 12 |
| Non-empty `groups`, non-empty `categories` per group | Runs; satisfied by construction | 4 groups × ≥2 categories |
| `serde_json::from_str` + `MSG_INVALID_FILE` on parse failure | **SKIPPED — correctly** | Only `apply_budget_template_json` deserializes. Call `apply_system_budget_template` instead; there is no JSON to parse |
| `MAX_TEMPLATE_FILE_BYTES` size guard (`std::fs::metadata`) | **SKIPPED — N/A** | `import_budget_template_from_path` only; no file exists |
| UTF-8 / `ErrorKind::InvalidData` mapping | **SKIPPED — N/A** | Same: file-boundary layer only |
| BOM (`\u{feff}`) stripping | **SKIPPED — N/A** | Same |
| Dialog + cancel → `Ok(None)` | **SKIPPED — N/A** | No dialog. `apply_system_template` returns a non-`Option` `ApplyBudgetTemplateResult` |
| Group-collision skip → `skipped_groups` | **YES — runs, unchanged** | Source-agnostic (AC #9). Add no second check |
| `DEFAULT_TEMPLATE_TARGET_CENTS` (`$1.00`) substitution for `None`/`Some(0)` | Runs, but **must never trigger** | AC #2 mandates every target is `Some(n > 0)`. If it triggers, the const is wrong — that is the failure mode `every_category_target_is_prefilled_and_positive` catches |
| Exactly one `insert_audit_log`, post-commit, non-fatal | **YES — runs, unchanged** | Written by 24.1's primitive with `"source":"system"`. The command adds none (AC #6) |

**One-line summary for the implementer:** *skip the file layer, never skip the validator.*

### Canadian Starter Content (Copy Verbatim)

Nothing upstream specifies the category list — PRD FR70, the epic, and the architecture doc all say only "~12 categories". This story is the sole source of truth. Copy it exactly; do not "improve" the names or amounts.

Design intent: 4 groups × 12 categories, Canadian-specific vocabulary (`Hydro`, `TFSA`, `RRSP`), totalling exactly **$5,000.00/month** (`500_000` cents) so the sum is memorable and obviously a starting point the user will edit.

```rust
use std::borrow::Cow;

use crate::db::budget_template::SUPPORTED_TEMPLATE_FORMAT_VERSION;
use crate::models::{SystemBudgetTemplate, TemplateCategoryDef, TemplateGroupDef};

/// Stable identifier. Also the i18n key stem Stories 25.2/25.3 can use to
/// localize the display name without changing this const.
pub const CANADIAN_STARTER_ID: &str = "canadian-starter";

const HOUSING: &[TemplateCategoryDef] = &[
    TemplateCategoryDef { name: Cow::Borrowed("Rent / Mortgage"),               target_cents: Some(180_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Utilities (Hydro, Gas, Water)"), target_cents: Some(20_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Home & Tenant Insurance"),       target_cents: Some(5_000) },
];

const TRANSPORTATION: &[TemplateCategoryDef] = &[
    TemplateCategoryDef { name: Cow::Borrowed("Car Payment & Insurance"), target_cents: Some(45_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Gas & Transit"),           target_cents: Some(25_000) },
];

const LIVING: &[TemplateCategoryDef] = &[
    TemplateCategoryDef { name: Cow::Borrowed("Groceries"),               target_cents: Some(60_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Phone & Internet"),        target_cents: Some(15_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Health & Pharmacy"),       target_cents: Some(10_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Dining & Entertainment"),  target_cents: Some(25_000) },
];

const SAVINGS: &[TemplateCategoryDef] = &[
    TemplateCategoryDef { name: Cow::Borrowed("TFSA Contribution"), target_cents: Some(50_000) },
    TemplateCategoryDef { name: Cow::Borrowed("RRSP Contribution"), target_cents: Some(40_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Emergency Fund"),    target_cents: Some(25_000) },
];

const CANADIAN_STARTER_GROUPS: &[TemplateGroupDef] = &[
    TemplateGroupDef { name: Cow::Borrowed("Housing"),        categories: Cow::Borrowed(HOUSING) },
    TemplateGroupDef { name: Cow::Borrowed("Transportation"), categories: Cow::Borrowed(TRANSPORTATION) },
    TemplateGroupDef { name: Cow::Borrowed("Living"),         categories: Cow::Borrowed(LIVING) },
    TemplateGroupDef { name: Cow::Borrowed("Savings"),        categories: Cow::Borrowed(SAVINGS) },
];

const CANADIAN_STARTER: SystemBudgetTemplate = SystemBudgetTemplate {
    // Referenced, not literal `1`, so this const can never drift from the
    // version validate_budget_template accepts.
    format_version: SUPPORTED_TEMPLATE_FORMAT_VERSION,
    id: Some(Cow::Borrowed(CANADIAN_STARTER_ID)),
    name: Cow::Borrowed("Canadian Starter Budget"),
    description: Some(Cow::Borrowed(
        "Common Canadian household categories with suggested monthly targets. Adjust every target to match your situation.",
    )),
    groups: Cow::Borrowed(CANADIAN_STARTER_GROUPS),
};

pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate] = &[CANADIAN_STARTER];

pub fn find_system_template(id: &str) -> Option<&'static SystemBudgetTemplate> {
    SYSTEM_TEMPLATES.iter().find(|t| t.id.as_deref() == Some(id))
}
```

Amount check (do not change without updating AC #8 and the tests): `180_000 + 20_000 + 5_000 + 45_000 + 25_000 + 60_000 + 15_000 + 10_000 + 25_000 + 50_000 + 40_000 + 25_000 = 500_000` cents = **$5,000.00**.

Group names were chosen to **avoid** colliding with the seed data in `db/budget.rs:384`'s `budget_test_db()` (`'Needs'`) — unrelated helper, but it keeps the two test worlds independent.

### Const-Promotion Fallback

`pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate] = &[CANADIAN_STARTER];` relies on rvalue static promotion of an array built from a const whose type carries `Cow` drop glue. Story 24.1's AC #11 includes a `const`-constructibility smoke test precisely to prove this compiles before this story depends on it.

If it nonetheless fails to promote, use this — and **only** this:

```rust
const CANADIAN_STARTER_ARRAY: [SystemBudgetTemplate; 1] = [CANADIAN_STARTER];
pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate] = &CANADIAN_STARTER_ARRAY;
```

`&CONST_ITEM` is always promotable. Do **not** reach for `static`, `lazy_static`, `once_cell`, or `OnceLock` — Decision 2 specifies a `pub const`, and no such crate is a dependency.

### Command Bodies (Copy Verbatim)

Append to `commands/budget_template.rs`:

```rust
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

    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    // No insert_audit_log here: db::budget_template's shared primitive writes
    // exactly one row per apply (source: "system"). Adding one here would double
    // it. Intentional deviation from project-context.md §3.
    budget_template_db::apply_system_budget_template(&conn, template)
}
```

`t.id.as_deref().unwrap_or_default()` cannot silently ship an empty id: `system_template_ids_are_present_and_unique` (Task 7) fails the build first. This is deliberately panic-free rather than `.expect()` (project-context.md §2: never panic in a command).

### Existing Code to Extend (DO NOT REINVENT)

| Item | File:line | Exact fact |
|---|---|---|
| `apply_system_budget_template` | `db/budget_template.rs` (24.1 Task 6) | `pub fn apply_system_budget_template(conn: &Connection, template: &SystemBudgetTemplate) -> Result<ApplyBudgetTemplateResult, AppError>` — no JSON round-trip; **built for this story**; carries the `#[allow(dead_code)]` this story removes |
| `apply_budget_template_json` | `db/budget_template.rs` (24.1 Task 6) | Import path only. **Do not call it here** |
| `validate_budget_template` | `db/budget_template.rs` (24.1 Task 3) | Private `fn`; reachable from that file's own `mod tests` via `use super::*`. That is why Task 8's validation test lives there, not in `template_defaults.rs` |
| `SUPPORTED_TEMPLATE_FORMAT_VERSION` | `db/budget_template.rs` (24.1) | `pub const … : i32 = 1` — referenced by `CANADIAN_STARTER` (AC #2) |
| `MAX_TEMPLATE_NAME_LEN` / `MAX_TEMPLATE_TARGET_CENTS` / `MAX_TEMPLATE_CATEGORIES` / `DEFAULT_TEMPLATE_TARGET_CENTS` | `db/budget_template.rs` (24.1) | `100` (chars) / `100_000_000` / `100` / `100`. Reference the symbols in tests, never the literals |
| `template_test_db()` | `db/budget_template.rs` (24.1 Task 7) | In-memory `Connection` with `budget_groups`, `budget_categories`, `audit_log`. **Reuse; do not define a second helper.** No migration-based test harness exists anywhere |
| `SystemBudgetTemplate` etc. | `models/mod.rs` (24.1) | `Cow<'static, str>` / `Cow<'static, [T]>` fields, `#[derive(Debug, Clone, Serialize, Deserialize)]`. `id`/`description` are `Option<Cow<'static, str>>` → use `.as_deref()` |
| `AppError` | `error.rs:5-13` | Hand-rolled enum: `Validation { message, field: Option<String> }`, `Database { message }`, `AiService { message, recoverable }`, `File { message }`, `NotConfigured`, `InvalidCredentials`, `Unavailable`. **No `thiserror`**; manual `Display` (`:15-27`) + manual `Serialize` (`:31-90`). `Validation` → `{"type":"validation","message":…,"field":…}` |
| `From<rusqlite::Error>` | `error.rs:92-98` | `?` converts to `AppError::Database`. `Mutex` poison has **no** `From` — always `.map_err` inline |
| Sync command shape | `commands/budget.rs:8-19` | `#[tauri::command(rename_all = "snake_case")] pub fn f(state: State<DbState>, …) -> Result<T, AppError>` + `state.0.lock().map_err(\|e\| AppError::Database { message: e.to_string() })?`. **Mirror this**, not `backup.rs`'s async/`AppHandle` dialog shape |
| `DbState` | `db/mod.rs`, `lib.rs:56` | `DbState(Mutex<Connection>)`, managed via `app.manage(DbState(Mutex::new(conn)))` |
| `create_budget_group` | `db/budget.rs:6-44` | `(conn, &CreateBudgetGroup) -> Result<BudgetGroup, AppError>`; trims, rejects empty, auto `sort_order = MAX+1`. **No length cap, no duplicate check** |
| `create_budget_category` | `db/budget.rs:64-111` | `(conn, &CreateBudgetCategory) -> Result<BudgetCategory, AppError>`; **rejects `target_cents <= 0`**, auto per-group `sort_order` |
| Const-array precedent | `maintenance/defaults.rs:4-27` | `pub struct TaskBaseline { … }` + `pub const DEFAULT_TASKS: &[TaskBaseline] = &[…]` + `pub fn baseline_for(key) -> Option<&'static TaskBaseline>` + `#[cfg(test)] mod tests` at `:29`. **`find_system_template` mirrors `baseline_for` exactly** |
| Module-folder precedent | `maintenance/mod.rs` | Four bare `pub mod …;` lines, nothing else. `budget/mod.rs` gets one |
| `mod` block | `lib.rs:1-8` | `ai, commands, credentials, db, error, financial_health, maintenance, models` — all private, alphabetical. Insert `mod budget;` after `mod ai;` |
| `generate_handler!` | `lib.rs:91-182` | 91 commands, budget block `:93-102`, `expense` starts `:103`. **Domain-grouped, not alphabetical** |
| `commands/mod.rs` | `commands/mod.rs:1-19` | 19 alphabetical `pub mod` lines; `budget` at `:4`, `chat` at `:5` |
| Non-fatal audit idiom | `commands/account.rs:30-33` | `if let Err(e) = … { tracing::error!(…); }`. **Not used by this story** — the primitive owns it |

`&tx` is accepted anywhere `&Connection` is expected (`rusqlite::Transaction: Deref<Target = Connection>`), per `db/expense.rs:59-107`. Not needed here — this story never opens a transaction.

### Module-Path Collision (read before you panic)

Three distinct `budget` paths will coexist:

| Path | File | Role |
|---|---|---|
| `crate::budget::template_defaults` | `src/budget/template_defaults.rs` (**new**) | Compiled const data |
| `crate::db::budget` | `src/db/budget.rs` (existing, read-only) | Budget SQL |
| `crate::db::budget_template` | `src/db/budget_template.rs` (24.1) | Template validate/apply |
| `crate::commands::budget` | `src/commands/budget.rs` (existing, untouched) | Budget commands |
| `crate::commands::budget_template` | `src/commands/budget_template.rs` (24.2/this story) | Template commands |

This is not a conflict: `crate::maintenance`, `crate::db::maintenance`, and `crate::commands::maintenance` already coexist identically. Always use absolute `crate::…` paths; the codebase's alias convention is `use crate::db::budget_template as budget_template_db;`.

### Architecture Doc vs. Reality — RESOLVED HERE (do not re-derive)

**Conflict A — Decision 2's struct shape is superseded.**
Architecture Decision 2 specifies `pub struct SystemBudgetTemplate { id: &'static str, name: &'static str, description: &'static str, groups: &'static [TemplateGroupDef] }`. That shape cannot `Deserialize`, which Story 24.1 AC #1/#2 require for the shared import path. **Story 24.1's `Cow<'static, _>` resolution is binding.** Consequences for this story: `id`/`description` are `Option<Cow<…>>` (so `Some(Cow::Borrowed(..))`, not a bare `&str`), and `groups` is `Cow::Borrowed(CONST_SLICE)`. Do **not** define a second `&'static str` struct family "for the consts".

**Conflict B — Decision 2 says `template_defaults.rs` may live "co-located near `db/budget.rs`".**
The epic (line 39) and the architecture Files-to-CREATE table both name `src/budget/template_defaults.rs`, and Story 24.1 §Project Structure Notes states "Story 25.1 creates it as a new top-level module mirroring `src/maintenance/`". **Resolution: `src/budget/{mod.rs,template_defaults.rs}`.** Do not put it in `db/`. Rationale: it is pure domain data with no SQL, exactly like `maintenance/defaults.rs`, and `project-context.md` reserves `db/` for "all SQL queries".

**Conflict C — architecture § API says both commands funnel through `apply_budget_template_json`.**
Story 24.1 Task 6 instead added `apply_system_budget_template` "(no JSON round-trip; Story 25.1 calls this)". **Resolution: call `apply_system_budget_template`.** Serializing a const to JSON only to re-parse it would waste work and, worse, route a trusted const through the untrusted-file error copy (`MSG_INVALID_FILE`), producing a nonsensical "This file is not a valid Nixus budget template." for a compiled-in template. AC #6 forbids it.

**Conflict D — the epic's `SYSTEM_TEMPLATES` declaration and the `Vec<SystemBudgetTemplateSummary>` return type imply a Rust `SystemBudgetTemplateSummary`, but the epic lists it only under "New TS interfaces in `lib/types.ts`".**
**Resolution:** the **Rust** struct is defined here (AC #4, required by `list_system_templates`'s signature); the **TypeScript** interface is Story 25.2's. This is the one edit this story makes to `models/mod.rs` — and it is why `models/mod.rs` is *not* on this story's read-only list even though 24.2/24.3 both froze it.

### Dead Code (this WILL bite you)

`mod db;` and `mod budget;` are **private** in `lib.rs`, so unreferenced `pub` items inside them still trigger `dead_code`, and `#[cfg(test)]` usage does **not** suppress it under plain `cargo check`.

- `apply_system_budget_template` → gains its first real caller here → **remove** 24.1's allowance (AC #11).
- `SYSTEM_TEMPLATES` and `find_system_template` → called by `commands/budget_template.rs` → no allowance needed.
- `CANADIAN_STARTER_ID` → referenced inside `CANADIAN_STARTER`'s own initializer → used → no allowance needed. (This is why AC #2 requires the named const rather than an inline `"canadian-starter"` literal.)
- `CANADIAN_STARTER`, `CANADIAN_STARTER_GROUPS`, `HOUSING`/`TRANSPORTATION`/`LIVING`/`SAVINGS` → all reachable from `SYSTEM_TEMPLATES` → no allowance needed.
- `SystemBudgetTemplateSummary` → constructed in `list_system_templates`, which `generate_handler!` counts as a use → no allowance needed even though no frontend calls it until Story 25.2.
- Never delete code to silence a warning. Never add a blanket `#![allow(dead_code)]`.

### Scope Boundary vs. Stories 25.2 / 25.3 / 25.4 (binding)

Epic Story 25.1's ACs are entirely backend. Downstream stories consume this surface and must not be pre-built:

| Item | Story |
|---|---|
| `useSystemTemplates()`, `useApplySystemTemplate()` appended to the existing `hooks/useBudgetTemplates.ts` | 25.2 |
| `SystemBudgetTemplateSummary` **TypeScript** interface in `lib/types.ts`; `queryKeys.systemBudgetTemplates` in `constants.ts` | 25.2 |
| Starter-template picker in `YourDataSettings.tsx`, toasts, `locales/en.json` + `fr.json` | 25.3 |
| Onboarding fork starter-template path, editable-target preview, FR71 redirect gate | 25.4 |
| `tests/budget-templates.spec.ts` Playwright E2E (apply starter template from onboarding) | 25.4 (with 24.4) |
| Localizing the template `name` / `description` | 25.3 (keyed off `CANADIAN_STARTER_ID`) |
| A second system template | Future — `SYSTEM_TEMPLATES` is already extensible; ships with one at launch (Decision 2) |
| `hooks/useBudgetTemplates.ts` **created**, `ApplyBudgetTemplateResult` TS interface | 24.4 (already reassigned there) |
| New migration / `budget_templates` table | **Never** (Decision 1) |

### Naming Collision Warning

`models/mod.rs:351-361` already defines `RecurringExpenseTemplate` (a recurring monthly expense rule — `merchant`, `amount_cents`, `budget_category_id`, `day_of_month`), backed by `recurring_expense_templates` + `db/recurring.rs` + `commands/recurring.rs`, with `queryKeys.recurringTemplates` on the frontend. **Unrelated concept.** Never introduce a bare `Template` type; never touch the recurring files. Every new identifier here is `SystemBudgetTemplate*` / `budget_template*` / `SYSTEM_TEMPLATES` / `CANADIAN_STARTER*`. [Source: architecture § Technical Constraints]

### Project Structure Notes

- Monorepo path `apps/desktop/src-tauri/` (`@nkbaz/desktop`). Registration lives in `lib.rs`, **not** `main.rs`
- `src/budget/` does not exist today — this story creates it. Existing precedent for a domain folder holding non-SQL logic: `src/maintenance/` (`mod.rs`, `catalog.rs`, `defaults.rs`, `display.rs`, `evaluator.rs`) and `src/financial_health/` (`mod.rs`, `constants.rs`, `evaluator.rs`)
- Money is always `i64` cents with a `_cents` suffix; never `f64` (NFR13, project-context.md §1)
- All models derive exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`, all fields `snake_case`, and live in `models/mod.rs` (project-context.md §4)
- No `clippy.toml`, no `#![deny(warnings)]`, no `rust-toolchain.toml`, and **no `cargo test`/`cargo clippy` step in CI** — the zero-warning rule is procedural, so run it yourself
- If `cargo clippy` is run manually and flags `clippy::unnecessary_wraps` on `list_system_templates`, **keep the `Result`** (project-context.md §2 mandates it) and add `#[allow(clippy::unnecessary_wraps)]` with a WHY comment. Do not change the signature
- Verify with `cd apps/desktop/src-tauri && cargo check && cargo test` (CONTRIBUTING.md:190-212). If `cargo fmt` is unavailable in the environment, note it rather than hand-reformatting (as in Story 23.1)
- Latest migration is `022_budget_category_soft_delete.sql`; this story adds none

### Previous Story Intelligence

**First story of Epic 25**, but it is the *fifth* story in the budget-templates arc. Carry-forwards from Epic 24 (all four still `ready-for-dev` — treat them as specification, not verified code):

- **From 24.1:** the `Cow` struct shapes (§Conflict 3), the five validation constants, both message strings, the `template_test_db()` helper, and `apply_system_budget_template`'s existence + its `#[allow(dead_code)]` marked "consumed by Story 25.1". `budget_groups` has **no `UNIQUE` constraint on `name`** and `create_budget_group` does **no** duplicate check — collision handling is entirely 24.1's Rust-side logic; add none here.
- **From 24.2:** `target_cents: Some(0)` is normalized to `DEFAULT_TEMPLATE_TARGET_CENTS` via `.filter(|c| *c > 0).unwrap_or(..)`. Irrelevant for a correct system template (all targets positive) but it is why AC #2 forbids `Some(0)`: it would silently become `$1.00`.
- **From 24.2/24.3:** `commands/budget_template.rs` + `commands/mod.rs`'s `pub mod budget_template;` + the `lib.rs` budget-template `generate_handler!` block are theirs. This story appends and does not duplicate. Both explicitly left `apply_system_budget_template`'s allowance in place "Story 25.1 owns it" — **removing it is this story's job.**
- **From 24.4:** `hooks/useBudgetTemplates.ts` and `ApplyBudgetTemplateResult` in `lib/types.ts` were reassigned from 25.2 to 24.4. Story 25.2 now only *appends* `useSystemTemplates`/`useApplySystemTemplate` and adds `SystemBudgetTemplateSummary` + `queryKeys.systemBudgetTemplates`. Nothing frontend belongs here regardless.
- **From 23.1 (last shipped backend story):** the `let tx = conn.unchecked_transaction()?; … tx.commit()?;` form passed review; post-commit side effects go after `commit`; `cargo test` baseline was 165 tests; `cargo check` had to be warning-free. 23.1 also needed an approved scope exception when a shared model change rippled — this story adds one **new** struct and one **new** module, so no ripple is expected. **If you find yourself editing `db/budget.rs`, `db/audit.rs`, `error.rs`, `db/recurring.rs`, or anything under `apps/desktop/src/`, stop: that is a scope violation, not a necessity.**

### Recent Commit Context

`git log` head is UI/AI-chat work and version bumps (`1bc5427`, `9cadcad`, `ea5d9f8`, `f86f300`, `1e9560e`). A case-insensitive search of all history for "template" matches only `e758710 fix(budget): show actionable errors when category delete is blocked` (false positive — it touched `db/budget.rs`'s soft-delete path, `db/budget.rs:244-291`; read it but do not modify it). **Zero Epic 24/25 commits exist — this is 100% greenfield.** The most recent budget/AI fixes establish the current direction: *friendly canned user-facing copy instead of raw error text* — which is why AC #7 uses a fixed message plus `tracing::warn!` rather than interpolating `template_id`. Working tree currently holds untracked planning artifacts only; **do not commit anything.**

### Latest Tech Information

- `serde` 1.0.228 / `serde_json` 1.0.150, `rusqlite` 0.38.0 (bundled SQLite), `tauri` 2, Rust edition **2021**. **No new crates**, no `Cargo.toml` change.
- `Cow<'static, str>`: `Cow::Borrowed` is `const`-constructible; serde's blanket `impl<'de, 'a, T: ?Sized> Deserialize<'de> for Cow<'a, T>` yields `Cow::Owned` on deserialization. `.as_deref()` on `Option<Cow<'static, str>>` gives `Option<&str>` — that is the idiom for comparing `id` and for building the summary.
- `SYSTEM_TEMPLATES.iter().find(..)` returns `Option<&'static SystemBudgetTemplate>` because the slice is `'static`. No lifetime annotations or clones are required to pass it into `apply_system_budget_template(&conn, template)`.
- Tauri dispatches commands off the main thread, so a **sync** `pub fn` command is correct here. `async` is only needed for the blocking dialogs in `backup.rs` / 24.2 / 24.3.
- `State<DbState>` is injected by Tauri; `list_system_templates` taking **no** parameters is valid and `generate_handler!` handles it fine.

### UX / i18n Note (flag, do not resolve here)

No UX-DR covers budget templates — `ux-design-specification.md` predates the 2026-08-01 FR70 amendment (see epic § Requirements Inventory — UX Design Requirements). This story is backend-only with no user-visible surface, but it creates two items for the Story 25.3 / 25.4 UX review:

1. **`name` / `description` are English-only Rust consts.** The app ships EN + FR (i18next). `CANADIAN_STARTER_ID` (`"canadian-starter"`) is deliberately a stable slug so 25.3 can localize the *display* strings via an i18n key (e.g. `settings.templates.canadian-starter.name`) without touching this const. Decide there, not here.
2. **The 12 authored targets total $5,000/month.** These are suggestions, not advice — the FR70 flow must present them as editable (Story 25.4's preview/edit step), and copy should make "adjust these" obvious.

Contrast worth recording: the `$1.00` `DEFAULT_TEMPLATE_TARGET_CENTS` fallback flagged by 24.1/24.2 for amount-stripped **imports** never applies to system templates, because AC #2 requires every target pre-filled and positive.

### References

- [Source: _bmad-output/planning-artifacts/epics-budget-templates.md — Epic 25 (lines 218-248), **Story 25.1 all 5 ACs (lines 222-248)**, Stories 25.2/25.3/25.4 (scope boundary), Requirements Inventory § Additional Requirements (lines 38-55), FR Coverage Map (lines 63-67), UX Design Requirements gap note (line 59)]
- [Source: _bmad-output/planning-artifacts/architecture-budget-templates.md — **Decision 1** (no DB table, compiled consts, lines 122-126), **Decision 2** (`SYSTEM_TEMPLATES`, `CANADIAN_STARTER`, one template at launch, lines 128-129), Decision 3 (schema), Decision 4 (validation), Decision 5 (audit), § API & Communication Patterns (lines 168-171 command contracts), § Project Structure & Implementation Map (lines 82-84, Files-to-CREATE 241-245), § Testing Strategy (267-272), § Important Gaps (325-330), § Technical Constraints, § Files explicitly NOT modified]
- [Source: _bmad-output/implementation-artifacts/24-1-template-schema-models-core-apply-function.md — §Type Definitions (Copy Verbatim), §Constants, §Three Conflicts (esp. Conflict 3 `Cow`), Task 6 (`apply_system_budget_template`), §Dead Code, §Test DB Helper, §Out of Scope (25.1 row), §Project Structure Notes (`src/budget/` created by 25.1)]
- [Source: _bmad-output/implementation-artifacts/24-2-import-validation-for-untrusted-template-files.md — §Conflict B (`Some(0)` normalization), §Conflict C (`MAX_TEMPLATE_FILE_BYTES` file layer), §Serde Behaviours, §Registration — Exact Insertion Points, §Command Attribute Decision, §Dead Code (keep 25.1's allowance), §Existing Code to Extend]
- [Source: _bmad-output/implementation-artifacts/24-3-export-current-budget-as-shareable-template.md — §Registration — Exact Insertion Points (budget-template block contiguity), §Dead Code (`apply_system_budget_template` allowance is 25.1's to remove)]
- [Source: _bmad-output/implementation-artifacts/24-4-import-a-community-template-file.md — §Scope Boundary (hook + `ApplyBudgetTemplateResult` TS moved to 24.4; `useSystemTemplates`/`SystemBudgetTemplateSummary`/`queryKeys.systemBudgetTemplates` remain 25.2)]
- [Source: _bmad-output/planning-artifacts/prd.md — FR70 (line 532, "~12 pre-filled Canadian categories with editable targets"), FR71 (line 533), FR96 (line 600), NFR11 (line 626), NFR13 (line 628)]
- [Source: docs/project-context.md — §1 integer cents, §2 Tauri IPC (`rename_all`, `Result<T, AppError>`, `State<DbState>` lock idiom, register in `lib.rs`), §3 db/commands separation + audit, §4 model derives + `models/mod.rs` location, §5 `AppError` variants, §9 warnings policy, Rust naming conventions, Rust Backend Structure]
- [Source: docs/guidelines/warnings.md — dead-code resolution policy ("if the method is used, add an ignore")]
- [Source: apps/desktop/src-tauri/src/lib.rs:1-8 — private alphabetical `mod` block, `mod budget;` insertion point; :56 `app.manage(DbState(..))`; :91-182 `generate_handler!`, budget block :93-102, `expense` block starts :103]
- [Source: apps/desktop/src-tauri/src/commands/mod.rs:1-19 — alphabetical `pub mod` list, `budget` :4 / `chat` :5 insertion point]
- [Source: apps/desktop/src-tauri/src/commands/budget.rs:8-19 — canonical sync command shape + `State<DbState>` lock idiom, repeated 9×]
- [Source: apps/desktop/src-tauri/src/error.rs:5-13,15-27,31-90,92-98 — full `AppError` enum, `Validation { message, field }`, hand-rolled `Display`/`Serialize` (no `thiserror`), `From<rusqlite::Error>`]
- [Source: apps/desktop/src-tauri/src/models/mod.rs:3-41 — budget struct cluster + derive convention; :351-361 `RecurringExpenseTemplate` collision]
- [Source: apps/desktop/src-tauri/src/db/budget.rs:6-44,64-111,244-291,384,511-517 — `create_budget_group` / `create_budget_category` (no length cap, `target_cents <= 0` rejection, auto `sort_order`), soft-delete path, `budget_test_db()`, error-assertion style]
- [Source: apps/desktop/src-tauri/src/maintenance/defaults.rs:4-27,29 — `TaskBaseline` / `DEFAULT_TASKS` / `baseline_for` const-array precedent and its `#[cfg(test)] mod tests`]
- [Source: apps/desktop/src-tauri/src/maintenance/mod.rs:1-4 — bare `pub mod` folder-module precedent for `budget/mod.rs`]
- [Source: apps/desktop/src-tauri/src/db/expense.rs:59-107 — `unchecked_transaction` + `&tx` as `&Connection` (context only; not used here)]
- [Source: apps/desktop/src-tauri/src/commands/account.rs:30-33 — non-fatal audit idiom (not used by this story)]
- [Source: _bmad-output/implementation-artifacts/23-1-transaction-account-linking-backend.md — prior shipped backend story: transaction pattern, 165-test baseline, scope-exception precedent]
- [Source: CONTRIBUTING.md:190-212 — `cd apps/desktop/src-tauri && cargo check`; no Rust step in .github/workflows/release.yml]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

**Prerequisite gate (run before any code, 2026-08-04) — the story's PREREQUISITES section is STALE.**
It was authored assuming "nothing from Epic 24 is implemented." That is no longer true: all four Epic 24 stories are implemented and reviewed (uncommitted on `master`, baseline `1bc5427`). Gate results:

| Gate | Actual result | Path taken |
|---|---|---|
| `models/mod.rs` has `SystemBudgetTemplate` (:45) / `TemplateGroupDef` / `TemplateCategoryDef` / `ApplyBudgetTemplateResult` (:68) | **PRESENT** | No HARD STOP |
| `db/budget_template.rs` has `apply_system_budget_template` (:273) + `SUPPORTED_TEMPLATE_FORMAT_VERSION` (:15) | **PRESENT** | No HARD STOP |
| `commands/budget_template.rs` | **EXISTS** (24.2/24.3, 121 lines) | SOFT → **appended** the two commands; `commands/mod.rs` already carried `pub mod budget_template;` at :5, so it was **not** modified |

Every name assumed by the story matched 24.1's actual implementation — no renames, no deviations to record. Verified verbatim: `apply_system_budget_template`, `validate_budget_template` (private), `SUPPORTED_TEMPLATE_FORMAT_VERSION = 1`, `MAX_TEMPLATE_NAME_LEN = 100`, `MAX_TEMPLATE_TARGET_CENTS = 100_000_000`, `MAX_TEMPLATE_CATEGORIES = 100`, `DEFAULT_TEMPLATE_TARGET_CENTS = 100`, `template_test_db()`.

**Red-green-refactor trace.** A genuine RED was established before any const data existed: `budget/template_defaults.rs` was first written containing only `find_system_template` plus Task 7's six tests, and Task 8's three tests were added to `db/budget_template.rs` at the same time. `cargo test` then failed to compile with 11 errors — `error[E0432]: unresolved imports crate::budget::template_defaults::CANADIAN_STARTER_ID, ...SYSTEM_TEMPLATES` and 8× `error[E0425]: cannot find value CANADIAN_STARTER / CANADIAN_STARTER_ID / SYSTEM_TEMPLATES in this scope`. Adding the const block turned all nine green in one step.

**Intermediate dead-code state (expected, per §Dead Code).** With the const block present but the commands not yet written, `cargo test` emitted exactly 9 `never used` warnings (`CANADIAN_STARTER_ID`, `HOUSING`, `TRANSPORTATION`, `LIVING`, `SAVINGS`, `CANADIAN_STARTER_GROUPS`, `CANADIAN_STARTER`, `SYSTEM_TEMPLATES`, `find_system_template`). All nine cleared themselves once Task 4/5 added the real callers — no `#[allow]` was needed anywhere, exactly as the story predicted. No code was deleted to silence a warning.

**Const promotion — fallback NOT needed.** `pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate] = &[CANADIAN_STARTER];` compiled on the first attempt. The documented §Const-Promotion Fallback (`CANADIAN_STARTER_ARRAY`) was therefore left unused; 24.1's `const_template_is_constructible_and_valid` smoke test had already proven the `Cow` schema is const-constructible.

**`cargo clippy --all-targets -- -D warnings` passed with no findings on `list_system_templates`.** `clippy::unnecessary_wraps` is a `pedantic`-group lint and is not enabled by default, so it never fired. Per §Project Structure Notes the `Result` return was kept unconditionally (project-context.md §2) and **no** `#[allow(clippy::unnecessary_wraps)]` was added, since adding an allowance for a lint that does not fire would itself be dead configuration. Clippy was forced to re-analyze (it caches) by `touch`-ing all six changed sources before each run.

### Completion Notes List

**Amount arithmetic re-verified against the const, not the story prose:** `180_000 + 20_000 + 5_000 + 45_000 + 25_000 + 60_000 + 15_000 + 10_000 + 25_000 + 50_000 + 40_000 + 25_000 = 500_000` cents = **$5,000.00/month** across 4 groups / 12 categories. Canadian vocabulary preserved verbatim (`Utilities (Hydro, Gas, Water)`, `TFSA Contribution`, `RRSP Contribution`, `Home & Tenant Insurance`, `Gas & Transit`). No name or amount was re-derived.

**Test count:** Rust went from a **241**-test baseline to **250** — the 9 tests this story adds, with zero pre-existing tests modified, weakened, or deleted. Explicitly re-confirmed green: `rollback_leaves_no_rows`, `export_json_strips_all_amounts`, `export_json_round_trips_through_apply`, `const_template_is_constructible_and_valid`, `duplicate_group_skip_excludes_its_categories`.

**AC #5's "exactly one summary" is guaranteed structurally, not by a test — deliberately.** `SYSTEM_TEMPLATES` is a single-element source literal (`&[CANADIAN_STARTER]`), so cardinality is compile-time evident, and `list_system_templates` is a pure projection over it. AC #12/#13 enumerate the required tests exhaustively and place none in `commands/`, so no `#[cfg(test)] mod tests` was introduced into `commands/budget_template.rs`. Flagging for the reviewer rather than silently widening scope.

**AC #7's error path is unit-tested only at its lookup half.** `find_system_template_unknown_id_is_none` locks the `""` / `"nope"` / `"CANADIAN-STARTER"` cases returning `None`. The `AppError::Validation { field: Some("template_id") }` mapping and the "`DbState` is never locked" ordering live inside a `#[tauri::command]` taking `State<DbState>`, which this repo has no harness to construct — consistent with every other command file, none of which carries unit tests. The ordering guarantee is enforced structurally: the `match` returns before `state.0.lock()` is ever reached.

**`MSG_INVALID_FILE` / `MSG_VERSION_TOO_NEW` were left private.** The story permitted making them `pub` "only if you actually need them." Nothing in this story needs them — a system template never traverses the file layer, and AC #7's copy is a distinct, purpose-written string. No visibility was widened.

**Zero-warning compilation confirmed on the real toolchain** (`docs/guidelines/warnings.md`, project-context.md §9): `cargo check --all-targets` and `cargo clippy --all-targets -- -D warnings` both finish clean.

**Scope discipline.** No frontend file, locale file, migration, dependency, or `Cargo.toml` entry was touched. `docs/project-context.md`'s read-only set held: `db/budget.rs`, `db/audit.rs`, `error.rs`, `db/mod.rs`, `commands/mod.rs`, `main.rs`, `migrations/` are all unmodified. Stories 25.2 (hook + TS types + `queryKeys`), 25.3 (Settings section + i18n), and 25.4 (onboarding fork) were **not** pre-built. `apps/desktop/src/locales/{en,fr}.json` were independently re-verified at **1129 keys each, identical key set and identical key order** — untouched by this story, no i18n regression. Front-end non-regression proven anyway: `tsc --noEmit` exits 0 with no output and vitest reports **51/51**, matching the baseline exactly.

**Uncommitted Epic 24 work was preserved, not reverted.** `git diff` against `1bc5427` legitimately shows 24.x's `YourDataSettings.tsx`, `useBudget.ts`, `lib/types.ts`, `locales/*.json`, `hooks/useBudgetTemplates.ts`, `deferred-work.md` and the `commands/mod.rs` + `db/mod.rs` module lines. None of that is this story's, and none of it was modified. Nothing was committed, staged, stashed, or branched.

**Known pre-existing unrelated failure, not attributable here:** `apps/desktop/tests/chat.spec.ts:250 › money in an answer is tabular Inter`. Left untouched per instruction; this story adds no Playwright coverage (that is 25.4's).

### File List

**Created**
- `apps/desktop/src-tauri/src/budget/mod.rs`
- `apps/desktop/src-tauri/src/budget/template_defaults.rs`

**Modified**
- `apps/desktop/src-tauri/src/models/mod.rs` — added `SystemBudgetTemplateSummary` immediately after `ApplyBudgetTemplateResult` (the only edit)
- `apps/desktop/src-tauri/src/commands/budget_template.rs` — appended `list_system_templates` + `apply_system_template`; widened the `tauri` import to `{AppHandle, Manager, State}` and added the three `crate::` imports. `import_budget_template` / `export_budget_template` untouched
- `apps/desktop/src-tauri/src/lib.rs` — `mod budget;` between `mod ai;` and `mod commands;`; two `generate_handler!` entries appended to the budget-template block
- `apps/desktop/src-tauri/src/db/budget_template.rs` — removed the now-obsolete `#[allow(dead_code)]` + its WHY comment from `apply_system_budget_template`; added 3 tests and one test-module `use`. No behavioural change
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `25-1` → `review`
- `_bmad-output/implementation-artifacts/25-1-canadian-starter-template-definition-list-apply-commands.md` — this record

**Not modified (verified):** `db/budget.rs`, `db/audit.rs`, `db/mod.rs`, `error.rs`, `commands/mod.rs`, `main.rs`, `Cargo.toml`, `migrations/`, all of `apps/desktop/src/**`, `apps/desktop/src/locales/*.json`, `apps/desktop/tests/**`.

## Change Log

- 2026-08-04: Story context created (ready-for-dev).
- 2026-08-04: Implemented Canadian starter template (`src/budget/{mod,template_defaults}.rs`, 4 groups / 12 categories / $5,000.00 total), `SystemBudgetTemplateSummary` model, `list_system_templates` + `apply_system_template` commands, `lib.rs` registration, and removal of `apply_system_budget_template`'s dead-code allowance. Added 9 tests (Rust 241 → 250, all passing); `cargo check --all-targets` and `cargo clippy --all-targets -- -D warnings` clean; `tsc --noEmit` clean; vitest 51/51 unchanged. Status → review.
- 2026-08-04: Code review (adversarial + edge-case + acceptance-criteria, bmad-code-review workflow). All 13 ACs verified against actual code; validation guardrail mutation-tested (proved `system_templates_all_pass_validation` / `every_category_target_is_prefilled_and_positive` genuinely fail on an injected invalid target, then reverted clean). 1 patch applied (AC #5 field-mapping test, Rust 250 → 251); 1 test-gap claim reviewed and dismissed as consistent with codebase convention; 2 non-blocking product notes recorded for 25.3/25.4. Re-ran `cargo check --all-targets`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (251 passed), `tsc --noEmit`, vitest (51/51) — all clean. `en.json`/`fr.json` re-confirmed at 1129 identical keys, identical order. Status → done.

