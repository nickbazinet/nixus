---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: complete
requirementsConfirmed: true
epicsApproved: true
storiesApproved: true
validated: true
inputDocuments:
  - prd.md
  - architecture-budget-templates.md
scope: budget-templates
parentDocument: architecture-desktop.md
---

# nkbaz-finance - Budget Templates Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the nkbaz-finance Budget Templates feature, decomposing FR96 (versioned budget template data portability) and the FR70/FR71 starter-template onboarding path from the PRD and `architecture-budget-templates.md` into implementable stories. Scoped addendum — parent epics live in `epics.md`; this file follows the same pattern as `epics-income.md` and `epics-car-maintenance.md`.

## Requirements Inventory

### Functional Requirements

- FR96: System ships starter budgets as versioned, human-readable template documents (a defined schema plus a `version` field), not hardcoded application constants. User can import a budget template from a file. User can export a budget as a shareable template; template export strips every dollar amount by construction, keeping only category and group names, so a shared template cannot leak the exporting user's financial figures. Template exchange is file-based only — no account, no server, ever.
- FR70 (starter-template path only — the statement-upload and start-from-scratch forks are out of scope for this document): Onboarding's single fork includes picking a starter template (~12 pre-filled Canadian categories with editable targets). The "a budget is mandatory" rule is satisfied in ~2 clicks via this path.
- FR71: System redirects users to onboarding when no budget groups exist — the apply-template flow must be reachable from this redirect gate.

### NonFunctional Requirements

- NFR6: Financial data is stored encrypted at rest — inherited; no new storage of sensitive data introduced by this feature.
- NFR11: Financial records are never silently lost or corrupted — applies to template apply/import (single-transaction, all-or-nothing per Decision 4).
- NFR13: Balance and net worth calculations are accurate to the cent — applies to `target_cents` handling on apply/import.
- Local-first, no network/account dependency for template exchange (platform-wide local-first posture, reaffirmed by FR96's "no server, ever").

### Additional Requirements

- No new `budget_templates` DB table — file-based (import/export) and compiled-Rust-const (system templates) only (Decision 1). No new migration.
- System templates live in `apps/desktop/src-tauri/src/budget/template_defaults.rs` as `SYSTEM_TEMPLATES: &[SystemBudgetTemplate]`, shipping with one template at launch (Canadian starter, ~12 categories, editable targets) (Decision 2).
- Template file schema is `format_version: 1` — required integer `format_version`, optional `id` (system/library templates only), optional per-category `target_cents` (present for system templates, `null`/absent for user exports) (Decision 3).
- Import validation is defensive (untrusted-file posture): reject unrecognized `format_version`; non-empty/length-capped names; non-negative bounded `target_cents`; reject empty `groups`/`categories`; cap at 100 categories total; all validation precedes any DB write; apply is one transaction (Decision 4).
- Audit logging added for template application: one `audit_db::insert_audit_log` call per apply (`entity_type: "budget_template"`, `action: "apply"`, `entity_id: 0`, `new_value` JSON summary), non-fatal on failure (Decision 5).
- New Rust models: `SystemBudgetTemplate`, `TemplateGroupDef`, `TemplateCategoryDef`, `ApplyBudgetTemplateResult { groups_created, categories_created, skipped_groups }` in `models/mod.rs`.
- New Rust module `db/budget_template.rs`: core `apply_budget_template_json(conn, json) -> Result<ApplyBudgetTemplateResult, AppError>`, validation, export/import file I/O — calls existing `budget_db::create_budget_group`/`create_budget_category` unchanged.
- New Rust module `commands/budget_template.rs`: 4 Tauri commands — `export_budget_template`, `import_budget_template`, `list_system_templates`, `apply_system_template(template_id: String)` — all registered in `lib.rs`.
- Reuse `AppError::File` for all template-file error cases (no new error variant): version-too-new and structurally-invalid-file messages are pre-specified.
- Duplicate-group handling: case-insensitive name match on existing group skips the **entire incoming group** (no merge, no partial apply); skipped names collected into `skipped_groups` and surfaced to the user.
- Export filename convention: `budget-template-{slugified-name}-{yyyy-mm-dd}.json`, pre-filled as the save dialog's default filename.
- New frontend hook `hooks/useBudgetTemplates.ts`: `useSystemTemplates()` (query), `useApplySystemTemplate()`, `useImportBudgetTemplate()`, `useExportBudgetTemplate()` (mutations) — mutations invalidate `budgetGroups`, `allBudgetCategories`, `budgetStatus` (same set as `useCreateBudgetCategory`/`useCreateBudgetGroup`).
- New `queryKeys.systemBudgetTemplates` entry in `constants.ts`.
- Wires into the already-scaffolded but disabled `components/settings/YourDataSettings.tsx` `settings.sectionTemplates` block, and into the FR70 onboarding fork's starter-template path — both entry points share the same commands/hook surface, no duplicated logic.
- New TS interfaces in `lib/types.ts`: `SystemBudgetTemplateSummary`, `ApplyBudgetTemplateResult`.
- New i18n result-toast strings (skipped groups, version-mismatch error) in `locales/en.json` / `locales/fr.json` — base section strings already scaffolded.
- Tests: Rust `#[cfg(test)]` in `db/budget_template.rs` (apply-system-template, import-valid-file, import-invalid-version, duplicate-group-skip); new Playwright `tests/budget-templates.spec.ts` (apply starter template from onboarding, export-then-reimport round-trip).
- Must NOT reuse the bare name `Template` — collides with existing `RecurringExpenseTemplate` (unrelated concept); all new types are explicitly `BudgetTemplate`-prefixed.

### UX Design Requirements

No feature-specific UX design requirements exist. `ux-design-specification.md` predates the 2026-08-01 FR70 amendment and still documents the retired 5-step onboarding wizard — it contains no UX-DRs for the starter-template picker, the import/export dialogs, or the Settings "Templates" section. `architecture-budget-templates.md`'s "Important Gaps" flags the import-confirmation UX (preview vs. direct-apply) as an undecided, story-level design decision. Story acceptance criteria below make a minimal, consistent UX decision (direct apply + result toast, matching the existing scaffolded Settings copy) and flag it explicitly for UX review rather than inventing unstated visual specs.

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR96 | Epic 24 | Versioned template schema, file-based import/export, amount-stripped export |
| FR70 (starter-template fork) | Epic 25 | System starter template with editable targets, reachable from onboarding |
| FR71 | Epic 25 | Apply-template flow reachable from the no-budget-groups redirect gate |

## Epic List

### Epic 24: Budget Template Import & Export
Users can export their current budget as a shareable, amount-stripped template file, and import a community-shared template file into their budget — both validated, transactional, and file-based only.
**FRs covered:** FR96

### Epic 25: System Starter Templates & Onboarding/Settings Integration
Users can apply a system-provided starter template (with editable pre-filled targets) from either the onboarding fork or the Settings "Templates" section, using the same underlying apply logic as import.
**FRs covered:** FR70 (starter-template path), FR71

---

## Epic 24: Budget Template Import & Export

Users can export their current budget as a shareable, amount-stripped template file, and import a community-shared template file into their budget — both validated, transactional, and file-based only.

### Story 24.1: Template Schema, Models & Core Apply Function

As a developer,
I want the `BudgetTemplate` data model, `format_version: 1` schema, and a shared core apply function,
So that both import and system-template application paths build on one validated, transactional primitive.

**Acceptance Criteria:**

**Given** the `models/mod.rs` file
**When** this story is implemented
**Then** it defines `SystemBudgetTemplate`, `TemplateGroupDef`, `TemplateCategoryDef`, and `ApplyBudgetTemplateResult { groups_created: i32, categories_created: i32, skipped_groups: Vec<String> }` with `#[derive(Debug, Clone, Serialize, Deserialize)]` and `snake_case` fields

**Given** a template JSON document
**When** deserialized
**Then** it matches the schema: `format_version` (required integer), `id` (optional string), `name` (string), `description` (optional string), `groups` (array of `{ name, categories: [{ name, target_cents: optional integer }] }`)

**Given** `db/budget_template.rs`
**When** `apply_budget_template_json(conn: &Connection, json: &str)` is called with a valid document
**Then** it validates the document (Story 24.2 rules), and on success creates budget groups/categories via existing `budget_db::create_budget_group`/`create_budget_category` inside a single `conn.unchecked_transaction()`
**And** returns `ApplyBudgetTemplateResult` with accurate `groups_created`/`categories_created` counts

**Given** an incoming group whose name matches an existing group name case-insensitively
**When** `apply_budget_template_json` processes it
**Then** the entire incoming group (and all its categories) is skipped — no partial application
**And** the skipped group's name is added to `skipped_groups` in the result

**Given** any validation or DB failure during apply
**When** the transaction is rolled back
**Then** no partial groups/categories exist in the database afterward

**Given** a successful apply (from any source)
**When** the transaction commits
**Then** exactly one `audit_db::insert_audit_log` call is made with `entity_type: "budget_template"`, `action: "apply"`, `entity_id: 0`, and `new_value` containing a JSON summary `{"groups": N, "categories": N, "source": "system"|"import", "template_id": "..."|null}`
**And** a failure in the audit log call does not fail or roll back the apply

### Story 24.2: Import Validation for Untrusted Template Files

As a developer,
I want defensive validation of imported template files before any database write,
So that malformed or adversarial community-shared files cannot corrupt the user's budget.

**Acceptance Criteria:**

**Given** a template file with a missing, `0`, or unrecognized-future `format_version`
**When** `import_budget_template` processes it
**Then** the command returns `AppError::File { message: "This template was created with a newer version of Nixus. Please update the app." }` for future/unknown versions, or a generic invalid-file message for missing/zero
**And** no database write occurs

**Given** a template file with structurally invalid JSON (fails schema deserialization)
**When** `import_budget_template` processes it
**Then** the command returns `AppError::File { message: "This file is not a valid Nixus budget template." }`

**Given** a template file with an empty or whitespace-only group or category name
**When** validated
**Then** the import is rejected with `AppError::File` before any DB write

**Given** a template file with a group or category name exceeding the existing length bound used by `create_budget_category`
**When** validated
**Then** the import is rejected with `AppError::File`

**Given** a template file with a negative `target_cents` or a value exceeding a sane upper bound
**When** validated
**Then** the import is rejected with `AppError::File`

**Given** a template file with an empty `groups` array, or any group with an empty `categories` array
**When** validated
**Then** the import is rejected with `AppError::File`

**Given** a template file with more than 100 categories in total across all groups
**When** validated
**Then** the import is rejected with `AppError::File`

**Given** all validation checks pass
**When** `import_budget_template` proceeds
**Then** validation completes fully before `apply_budget_template_json` performs any database write

### Story 24.3: Export Current Budget as Shareable Template

As a user,
I want to export my current budget as a template file with all dollar amounts stripped,
So that I can share my category structure without leaking my financial figures.

**Acceptance Criteria:**

**Given** the user's current `budget_groups`/`budget_categories`
**When** the user triggers `export_budget_template` (from the Settings "Templates" section)
**Then** a native save dialog opens via `tauri-plugin-dialog` (`blocking_save_file`), pre-filled with default filename `budget-template-{slugified-name}-{yyyy-mm-dd}.json` (lowercase, spaces → hyphens, non-alphanumeric stripped)

**Given** the user confirms the save dialog
**When** the file is written
**Then** it contains `format_version: 1`, the current groups/categories by name, and every `target_cents` field is `null` or absent — no dollar amount is present anywhere in the file

**Given** the export completes successfully
**When** the user is notified
**Then** a success toast/confirmation is shown consistent with existing Settings section feedback patterns

**Given** the user cancels the save dialog
**When** no file path is chosen
**Then** `export_budget_template` returns without error and without writing a file

### Story 24.4: Import a Community Template File

As a user,
I want to pick a template file from disk and apply it to my budget,
So that I can adopt a category structure someone else shared with me.

**Acceptance Criteria:**

**Given** the user triggers `import_budget_template` (from the Settings "Templates" section)
**Then** a native open dialog opens via `tauri-plugin-dialog` (`blocking_pick_file`) filtered to JSON files

**Given** the user selects a valid template file
**When** `import_budget_template` completes
**Then** the file is read, validated (Story 24.2), applied in one transaction (Story 24.1), and the result is returned to the frontend as `ApplyBudgetTemplateResult`

**Given** the import applied groups and skipped others due to name collisions
**When** the result is shown to the user
**Then** a toast/dialog surfaces the outcome, including skipped group names, e.g. "Applied template. Skipped: Housing, Transportation (already exist)."

**Given** the selected file fails validation
**When** `import_budget_template` returns an error
**Then** the frontend displays the `AppError::File` message to the user without crashing or leaving the budget in a partial state

**Given** the user cancels the open dialog
**When** no file is chosen
**Then** `import_budget_template` returns without error and performs no import

**Given** a successful import
**When** relevant TanStack Query data becomes stale
**Then** `budgetGroups`, `allBudgetCategories`, and `budgetStatus` query keys are invalidated so the UI reflects the new categories immediately

---

## Epic 25: System Starter Templates & Onboarding/Settings Integration

Users can apply a system-provided starter template (with editable pre-filled targets) from either the onboarding fork or the Settings "Templates" section, using the same underlying apply logic as import.

### Story 25.1: Canadian Starter Template Definition & List/Apply Commands

As a developer,
I want the Canadian starter template defined as a compiled Rust const and exposed via list/apply commands,
So that the onboarding and Settings flows can offer a system template without any file I/O.

**Acceptance Criteria:**

**Given** `apps/desktop/src-tauri/src/budget/template_defaults.rs`
**When** this story is implemented
**Then** it defines `pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate] = &[CANADIAN_STARTER];` with `CANADIAN_STARTER` containing ~12 pre-filled Canadian budget categories, each with a non-null `target_cents`

**Given** the `list_system_templates` Tauri command
**When** invoked
**Then** it returns `Vec<SystemBudgetTemplateSummary>` containing only `id`, `name`, and `description` for each entry in `SYSTEM_TEMPLATES` — no target amounts included in this response

**Given** the `apply_system_template(template_id: String)` Tauri command
**When** invoked with a valid `template_id`
**Then** it looks up the matching entry in `SYSTEM_TEMPLATES`, applies it via the shared `apply_budget_template_json` core logic (no file I/O), and returns `ApplyBudgetTemplateResult`

**Given** the `apply_system_template` command
**When** invoked with an unknown `template_id`
**Then** it returns an `AppError` (not a panic) indicating the template was not found

**Given** both new commands
**When** registered
**Then** they, plus `export_budget_template` and `import_budget_template` from Epic 24, appear in `lib.rs`'s `tauri::generate_handler!` macro

### Story 25.2: Frontend Hook for Budget Templates

As a developer,
I want a `useBudgetTemplates.ts` hook exposing system-template listing and all apply/import/export mutations,
So that onboarding and Settings UI can share one data-access layer with no duplicated logic.

**Acceptance Criteria:**

**Given** `apps/desktop/src/hooks/useBudgetTemplates.ts`
**When** implemented
**Then** it exports `useSystemTemplates()` as a TanStack Query hook using a new `queryKeys.systemBudgetTemplates` entry added to `constants.ts`

**Given** the same hook file
**When** implemented
**Then** it exports `useApplySystemTemplate()`, `useImportBudgetTemplate()`, and `useExportBudgetTemplate()` as TanStack Query mutations, each invoking the corresponding Tauri command with `snake_case` argument names

**Given** any of `useApplySystemTemplate`/`useImportBudgetTemplate` succeeds
**When** `onSuccess` runs
**Then** it invalidates `budgetGroups`, `allBudgetCategories`, and `budgetStatus` query keys

**Given** `lib/types.ts`
**When** updated
**Then** it defines `SystemBudgetTemplateSummary` and `ApplyBudgetTemplateResult` TypeScript interfaces matching the Rust structs field-for-field in `snake_case`

### Story 25.3: Settings "Templates" Section Wiring

As a user,
I want to apply a starter template, export my budget, or import a template from the Settings page,
So that I can manage my budget structure without going through onboarding again.

**Acceptance Criteria:**

**Given** `components/settings/YourDataSettings.tsx`'s existing but disabled `settings.sectionTemplates` block
**When** this story is implemented
**Then** the "Export as template" and "Import template" buttons are enabled and wired to `useExportBudgetTemplate()`/`useImportBudgetTemplate()`

**Given** the same Settings section
**When** this story is implemented
**Then** a starter-template picker (using `useSystemTemplates()`) lets the user select and apply the Canadian starter template via `useApplySystemTemplate()`

**Given** any of the three actions completes
**When** the result returns
**Then** a toast confirms the outcome (including skipped-group names on apply/import, per Story 24.4's message format), using i18n strings added to `locales/en.json` and `locales/fr.json`

**Given** any of the three actions fails
**When** an `AppError` is returned
**Then** the error message is surfaced to the user via toast, and no console error is logged in place of user feedback

### Story 25.4: Starter Template Path in Onboarding Fork

As a new user,
I want to pick the system starter template as one of the onboarding fork options, with its category targets editable before I finish,
So that I can get a working budget in about two clicks without manual data entry.

**Acceptance Criteria:**

**Given** a new user reaches the onboarding single-fork screen (statement-upload / starter-template / start-from-scratch)
**When** they choose the starter-template option
**Then** the Canadian starter template (via `useSystemTemplates()`) is presented with its pre-filled categories and editable target amounts before being applied

**Given** the user adjusts one or more target amounts in the starter-template preview
**When** they confirm
**Then** `useApplySystemTemplate()` is called and the adjusted targets are persisted for the created categories (edits are not silently discarded)

**Given** the starter-template path completes successfully
**When** the user is redirected
**Then** they land on the dashboard with budget groups already present — the "a budget is mandatory" gate (FR71) is satisfied

**Given** no budget groups exist for a returning user (FR71's redirect condition)
**When** the router's `beforeLoad` gate fires
**Then** the user is redirected to the onboarding fork screen, from which the starter-template path (this story) remains reachable — no separate/duplicated apply logic exists for this entry point versus the Settings entry point (Story 25.3)

**Given** the starter-template preview/edit UI
**When** implemented
**Then** the interaction flow (preview-then-edit-then-confirm) is flagged for UX review, since no UX-DR specifies this screen's exact layout (see Requirements Inventory — UX Design Requirements gap note)

---
