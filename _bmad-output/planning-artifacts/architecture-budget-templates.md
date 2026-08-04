---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-08-04'
status: 'in-progress'
scope: 'budget-templates'
parentDocument: architecture-desktop.md
inputDocuments:
  - prd.md
  - architecture-desktop.md
  - project-context.md
  - ux-design-specification.md
workflowType: 'architecture'
project_name: 'nkbaz-finance'
user_name: 'Nbazinet'
date: '2026-08-04'
featureRequest: 'Budget Templates: apply a template to auto-create category/budget structure; system-seeded starter templates; export current category/budget as a shareable template; import a community template'
---

# Budget Templates — Architecture Decision Document

_Scoped architecture addendum for FR96 (Data Portability: versioned budget templates) and the FR70 starter-template onboarding path. Extends [architecture-desktop.md](architecture-desktop.md). Builds collaboratively through step-by-step discovery._

---

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
- FR96 (primary): Versioned budget template documents (schema + `version` field). Import from file. Export as shareable template — amounts stripped by construction (category/group names only). File-based exchange only, no account/server.
- FR70 (onboarding, amended 2026-08-01): Starter-template path in onboarding fork — system-shipped templates with pre-filled categories AND editable target amounts (~12 Canadian categories cited as example).
- FR71: Onboarding redirect when no budget groups exist — apply-template flow must be reachable from this gate.

**Non-Functional Requirements:**
- Local-first, no network/account dependency for template exchange (inherited from platform-wide local-first NFRs).
- Import must validate untrusted community-shared files defensively (schema + bounds checks), mirroring the rigor already applied to backup-file validation.

**Scale & Complexity:**
- Complexity level: Low-medium — two existing precedents to mirror (seed-default pattern from Car Maintenance, file-export pattern from Database Backup/Restore), one new pattern to establish (JSON file-format versioning).
- Primary domain: Desktop (Tauri 2 / React / Rust / rusqlite), no cross-module impact beyond Budget domain.
- Estimated architectural components: new DB tables (budget_templates + 2 child tables OR pure-Rust-const for system templates — decision pending), new Rust models, new db/commands modules, new frontend hook, wiring into the already-scaffolded (but disabled) Settings UI section.

### Technical Constraints & Dependencies

- Must NOT reuse the name `Template` bare — collides with existing `RecurringExpenseTemplate` (a recurring monthly expense rule, unrelated concept). New types must be explicitly `BudgetTemplate`-prefixed.
- `@tauri-apps/plugin-dialog` (frontend) and `tauri-plugin-dialog` (Rust) are already dependencies — no new crate/package needed for file picking.
- `serde_json` already used pervasively — no new dependency for JSON (de)serialization.
- Existing scaffolded UI (`YourDataSettings.tsx`, `settings.sectionTemplates` i18n strings) already commits to the amount-stripping promise in user-facing copy — backend must honor it exactly.

### Cross-Cutting Concerns Identified

- Template schema must support two variants of the same shape: system starter templates (targets present) vs. user-exported community templates (targets absent) — single schema, optional field, not two schemas.
- Audit logging currently absent from budget/category domain; decision needed on whether `apply_budget_template` closes that gap or stays consistent with the existing gap.
- Onboarding (FR70/71) and Settings (existing scaffold) are two separate entry points into the same underlying "apply template" capability — command/hook layer must serve both without duplication.

---

## Starter Template Evaluation

### Primary Technology Domain

Desktop module extension within the existing Tauri 2 + React + Rust monorepo (`apps/desktop/`). Not a standalone application.

### Starter Options Considered

| Option | Verdict |
|--------|---------|
| `pnpm create tauri-app@latest` | **Rejected** — would scaffold a duplicate app; project already initialized |
| Extend existing desktop patterns | **Selected** — follows architecture-desktop.md conventions, mirrors two existing precedents (Car Maintenance seed-default pattern, Database Backup/Restore file-export pattern) |

### Selected Approach: Extend Existing Desktop App

**Rationale:** Budget Templates is FR96 (Data Portability) plus the FR70 starter-template onboarding path — both specified in the PRD, neither implemented. All infrastructure needed already exists: SQLite migrations, Tauri IPC, `tauri-plugin-dialog` (both Rust and frontend sides), `serde_json`, TanStack Query, i18n (strings already scaffolded), and two directly transferable precedents (`maintenance/defaults.rs` const-array seeding, `commands/backup.rs` file I/O). Implementation adds a migration, Rust models/db/commands modules, a frontend hook, and wires the already-scaffolded (but disabled) Settings UI section — no new project scaffolding.

**Implementation entry point (not a starter command):**

```bash
# First story: Rust model + system template consts + db/commands skeleton
# apps/desktop/src-tauri/src/models/mod.rs        (add BudgetTemplate types)
# apps/desktop/src-tauri/src/budget/template_defaults.rs
# apps/desktop/src-tauri/src/db/budget_template.rs
# apps/desktop/src-tauri/src/commands/budget_template.rs
```

**Architectural decisions inherited from existing desktop app:**

| Category | Inherited decision |
|----------|-------------------|
| Language & runtime | TypeScript (strict) frontend; Rust 2021 backend |
| Styling | Tailwind 4 + shadcn/ui via `@nkbaz/shared` |
| Build tooling | Vite 7 (frontend), Cargo (backend), Tauri CLI 2.x bundling |
| Testing | Playwright E2E in `apps/desktop/tests/`; Rust `#[cfg(test)]` in modules |
| Code organization | One `db/` + `commands/` file per domain; models in single `models/mod.rs` |
| State management | TanStack Query for IPC data |
| File I/O | `tauri-plugin-dialog` (Rust-side, per `commands/backup.rs`) + `std::fs` + `serde_json` |
| IPC | Tauri commands (CRUD), `#[tauri::command(rename_all = "snake_case")]` |

**Note:** No new migration required (Decision 1 — no new DB tables). First implementation story is the model/const/db-module skeleton — not project initialization.

---

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Persistence model: file-based, no DB table (Decision 1)
- Template file schema / `format_version` (Decision 3)
- Import validation bounds (Decision 4)

**Important Decisions (Shape Architecture):**
- System template storage as compiled Rust consts (Decision 2)
- Audit logging on apply/import (Decision 5)

**Deferred Decisions (Post-MVP):**
- Remote/S3-hosted public template gallery — explicitly out of scope for this pass, but the core `apply_budget_template_json(json: &str)` function is designed so a future HTTP-fetch adapter can call it unchanged (no DB, no schema rework needed later).

### Data Architecture

**Decision 1 — No `budget_templates` DB table; file-based and compiled-const only.**
Rationale: FR96 mandates "file-based only — no account, no server, ever," and this is a single-user app with no use case for an in-app saved-template library today. A DB table would add a full CRUD surface for a capability not requested. Instead:
- System templates: compiled Rust consts (mirrors `maintenance/defaults.rs::DEFAULT_TASKS`)
- User templates: exported directly from live `budget_groups`/`budget_categories` to a JSON file; imported directly into `budget_groups`/`budget_categories` rows — no intermediate storage.
- Forward-compatible with a future hosted gallery: the core apply logic operates on a JSON string regardless of source (local file today, HTTP fetch later), so no rework needed when that ships.

**Decision 2 — System templates as an extensible compiled array.**
New module `apps/desktop/src-tauri/src/budget/template_defaults.rs` (or co-located near `db/budget.rs`): `pub struct SystemBudgetTemplate { id: &'static str, name: &'static str, description: &'static str, groups: &'static [TemplateGroupDef] }` and `pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate] = &[CANADIAN_STARTER]`. Ships with **one** template at launch (the Canadian starter referenced in FR70, ~12 categories with editable targets). Structure supports adding more without a schema or migration change.

**Decision 3 — Template file schema (`format_version: 1`):**
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
- `format_version`: required integer, starts at `1`
- `id`: optional stable slug — present for system/library templates (future gallery identity), absent for ad-hoc user exports
- `target_cents`: optional per category — `null`/absent for user exports (amount-stripped per FR96), present for system starter templates
- `sort_order` not stored in the file — applied in array order on import

**Decision 4 — Import validation (defensive, untrusted-file posture):**
Mirrors `validate_backup_file`'s rigor, adapted for JSON:
- `format_version` must be a recognized value — reject missing/`0`/future-unknown versions with an actionable `AppError::File` message
- Group/category `name`: non-empty after trim, capped length (reuse `create_budget_category`'s existing bounds)
- `target_cents` if present: non-negative integer within a sane upper bound (overflow/garbage guard)
- Reject empty `groups`/`categories` arrays and caps at 100 categories total (guard against malformed or adversarial files)
- All validation happens before any DB write — `import_budget_template` either fully succeeds (one transaction) or fully fails, never partial

**Decision 5 — Audit logging added for template application.**
Closes the existing budget-domain audit gap specifically for this bulk-mutation path (not retroactively for `budget.rs`'s existing CRUD). One `audit_db::insert_audit_log` call per apply: `entity_type: "budget_template"`, `action: "apply"`, `entity_id: 0` (bulk, no single owning row — mirrors `import.rs`'s convention), `new_value`: JSON summary `{"groups": N, "categories": N, "source": "system"|"import", "template_id": "..."|null}`. Non-fatal on failure (logged, never blocks the apply), consistent with every other audit call site.

### Authentication & Security

N/A — inherited from platform (local-first, no auth, single-user, encrypted-at-rest DB per NFR6). No new auth/security surface introduced by this feature beyond import validation (Decision 4).

### API & Communication Patterns

Tauri IPC only, no new pattern. New commands:
- `export_budget_template() -> Result<(), AppError>` — Rust-side dialog (`blocking_save_file`, mirrors `backup.rs`), writes JSON via `serde_json::to_string_pretty` + `std::fs::write`
- `import_budget_template() -> Result<ApplyBudgetTemplateResult, AppError>` — Rust-side dialog (`blocking_pick_file`), reads + validates (Decision 4) + applies in one transaction
- `list_system_templates() -> Result<Vec<SystemBudgetTemplateSummary>, AppError>` — returns `id`/`name`/`description` from `SYSTEM_TEMPLATES` (no target amounts, keeps the picker UI lightweight)
- `apply_system_template(template_id: String) -> Result<ApplyBudgetTemplateResult, AppError>` — looks up by `id` in `SYSTEM_TEMPLATES`, applies directly (no file I/O)

Both `import_budget_template` and `apply_system_template` funnel through a shared internal `apply_budget_template_json(conn: &Connection, json: &str) -> Result<ApplyBudgetTemplateResult, AppError>` (or an already-deserialized struct, to avoid double-parsing for the const-array path) — the single core primitive referenced in the Deferred Decisions note above.

### Frontend Architecture

No new pattern. New `apps/desktop/src/hooks/useBudgetTemplates.ts` following `useBudget.ts` conventions: `useSystemTemplates()` (query), `useApplySystemTemplate()`, `useImportBudgetTemplate()`, `useExportBudgetTemplate()` (mutations). New `queryKeys.systemBudgetTemplates` entry in `constants.ts`. Mutations invalidate `budgetGroups`, `allBudgetCategories`, `budgetStatus` (same invalidation set as existing `useCreateBudgetCategory`/`useCreateBudgetGroup`). Wires into the already-scaffolded `YourDataSettings.tsx` `settings.sectionTemplates` block (buttons currently disabled) and the FR70 onboarding fork's starter-template path.

### Infrastructure & Deployment

N/A — no new infrastructure. Ships in the existing desktop app bundle; no new dependencies (all required crates/packages already present).

### Decision Impact Analysis

**Implementation Sequence:**
1. Migration: none needed (Decision 1 — no new tables)
2. Rust: `models::{SystemBudgetTemplate, TemplateGroupDef, TemplateCategoryDef, ApplyBudgetTemplateResult}` + `budget/template_defaults.rs` (`SYSTEM_TEMPLATES` const, starting with the Canadian starter)
3. Rust: `db/budget_template.rs` — `apply_budget_template_json` core function (transactional, calls existing `budget_db::create_budget_group`/`create_budget_category`) + validation (Decision 4)
4. Rust: `commands/budget_template.rs` — 4 commands, registered in `lib.rs`
5. Frontend: `hooks/useBudgetTemplates.ts` + `queryKeys` entries
6. Frontend: wire `YourDataSettings.tsx` scaffolded section + onboarding fork (FR70)

**Cross-Component Dependencies:**
- `apply_budget_template_json` depends on existing `budget_db::create_budget_group`/`create_budget_category` — no changes needed to those functions
- Onboarding (FR70/71) and Settings share the same commands/hook — no duplicated logic between entry points
- Audit logging (Decision 5) depends on existing `audit_db::insert_audit_log` — no changes needed there either

---

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

All naming/structure/format conventions are inherited from `project-context.md` (snake_case Rust/SQL, `AppError` enum, Tauri command registration, TanStack Query key patterns) — no new conflicts there. Four new conflict points specific to this feature, resolved below:

### New Patterns for Budget Templates

**Export filename convention:**
No existing precedent (backup/restore uses a fixed filename). New rule: `budget-template-{slugified-name}-{yyyy-mm-dd}.json`, pre-filled as the save dialog's default filename. Slugify: lowercase, spaces → hyphens, strip non-alphanumeric.

**`ApplyBudgetTemplateResult` shape (shared across all apply paths — system template, import, and any future remote-fetch adapter):**
```rust
pub struct ApplyBudgetTemplateResult {
    pub groups_created: i32,
    pub categories_created: i32,
    pub skipped_groups: Vec<String>,
}
```

**Duplicate-group handling on apply:**
If a group with a matching name (case-insensitive) already exists in the user's budget, the **entire incoming group is skipped** — no merge, no partial application. Skipped group names are collected into `skipped_groups` and surfaced to the user in the result toast/dialog (e.g. "Applied template. Skipped: Housing, Transportation (already exist)."). Simpler mental model than merge-by-name; avoids ambiguous partial states.

**Version-mismatch / invalid-file error messages:**
- `format_version` newer than supported: `AppError::File { message: "This template was created with a newer version of Nixus. Please update the app." }`
- Structurally invalid JSON / failed schema validation: `AppError::File { message: "This file is not a valid Nixus budget template." }`

### Enforcement Guidelines

**All AI Agents implementing this feature MUST:**
- Reuse `AppError::File` for all template-file error cases (not a new error variant)
- Return `ApplyBudgetTemplateResult` from every apply path (system, import) for a consistent frontend contract
- Perform all validation (Decision 4) before any DB write; apply in a single transaction (`conn.unchecked_transaction()`)
- Skip at the group level on name collision — never partially apply a group's categories

---

## Project Structure & Implementation Map

### Files to CREATE

| File | Purpose |
|------|---------|
| `apps/desktop/src-tauri/src/budget/mod.rs` | New module namespace (if not already present) |
| `apps/desktop/src-tauri/src/budget/template_defaults.rs` | `SYSTEM_TEMPLATES` const array (Canadian starter, FR70) |
| `apps/desktop/src-tauri/src/db/budget_template.rs` | `apply_budget_template_json`, validation, export/import file I/O |
| `apps/desktop/src-tauri/src/commands/budget_template.rs` | 4 Tauri commands (export/import/list/apply) |
| `apps/desktop/src/hooks/useBudgetTemplates.ts` | `useSystemTemplates`, `useApplySystemTemplate`, `useImportBudgetTemplate`, `useExportBudgetTemplate` |

### Files to MODIFY

**Rust backend:**

| File | Changes |
|------|---------|
| `models/mod.rs` | Add `SystemBudgetTemplate`, `TemplateGroupDef`, `TemplateCategoryDef`, `ApplyBudgetTemplateResult` |
| `lib.rs` | Register 4 new commands in `tauri::generate_handler!`, register `budget` module if new |
| `error.rs` | No new variant — reuse existing `AppError::File` (confirm message field supports the two new error strings) |

**Frontend:**

| File | Changes |
|------|---------|
| `lib/types.ts` | `SystemBudgetTemplateSummary`, `ApplyBudgetTemplateResult` TS interfaces |
| `lib/constants.ts` | `queryKeys.systemBudgetTemplates` |
| `components/settings/YourDataSettings.tsx` | Wire the existing disabled `settings.sectionTemplates` buttons to the new hooks |
| Onboarding route (FR70 starter-template fork) | Call `useSystemTemplates` + `useApplySystemTemplate` |
| `locales/en.json`, `locales/fr.json` | Result-toast strings (skipped groups, version-mismatch error) — base section strings already exist |

**Tests:**

| File | Changes |
|------|---------|
| `src-tauri/src/db/budget_template.rs` (`#[cfg(test)]`) | Apply-system-template, import-valid-file, import-invalid-version, duplicate-group-skip cases |
| `tests/budget-templates.spec.ts` (new) | E2E: apply starter template from onboarding, export then re-import round-trip |

### Files explicitly NOT modified (first story)

- `db/budget.rs` — existing CRUD functions called as-is, no signature changes
- `db/audit.rs` — existing `insert_audit_log` function reused as-is
- `commands/backup.rs` — pattern referenced, not touched
- Web app (`apps/web`) — desktop-only feature
- No new migration file — Decision 1 (no DB table)

### Requirements → Structure Mapping

| User requirement | Primary implementation |
|---|---|
| System-seeded starter templates (FR70) | `template_defaults.rs::SYSTEM_TEMPLATES`, `apply_system_template` command |
| Export current budget as shareable template (FR96) | `export_budget_template` command, amount-stripped by construction |
| Import a community template (FR96) | `import_budget_template` command, Decision 4 validation |
| Versioned schema (FR96) | `format_version` field, Decision 3 |
| Onboarding starter-template path (FR70/71) | Shared hook/command surface, no duplicated logic vs. Settings entry point |

---

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** All decisions build on each other cleanly — no DB table (D1) → system templates as consts (D2) → JSON schema needed for both consts and files (D3) → validation on the untrusted-file path only (D4) → audit on the bulk-apply operation regardless of source (D5). No contradictions.

**Pattern Consistency:** New patterns (filename convention, result shape, duplicate handling, error messages) all reuse existing primitives (`AppError::File`, `audit_db::insert_audit_log`, `tauri-plugin-dialog`) rather than inventing new infrastructure.

**Structure Alignment:** File list maps 1:1 to the decisions — no orphaned decisions without a corresponding file, no files without a decision driving them.

### Requirements Coverage Validation ✅

| Requirement | Covered by |
|---|---|
| FR96 — versioned template schema | Decision 3 (`format_version`) |
| FR96 — import from file | `import_budget_template` command, Decision 4 |
| FR96 — export, amount-stripped | `export_budget_template`, `target_cents: null` on export |
| FR96 — file-based only, no server | Decision 1 |
| FR70 — starter template w/ editable targets | Decision 2 (`SYSTEM_TEMPLATES` const), `target_cents` present |
| FR71 — reachable from onboarding gate | Shared command/hook surface (structure mapping) |

No NFRs specific to this feature beyond the inherited local-first/encrypted-at-rest posture — satisfied by design (no network calls, no new storage of sensitive data beyond what's already encrypted).

### Implementation Readiness Validation ✅

All critical/important decisions documented with concrete types and file paths. Patterns cover every new conflict point identified. Structure is a complete, specific file list (not generic placeholders).

### Gap Analysis Results

**Critical Gaps:** None.

**Important Gaps:**
- Import confirmation UX not specified — `import_budget_template` is read → validate → apply in one command call. Whether the frontend shows a preview ("this will add 3 groups, skip 1 duplicate — proceed?") before committing is a UX/story-level decision, not architecturally blocked, but worth deciding before implementation starts.
- No epics/stories exist yet for this feature — recommend running the epics/stories workflow against FR96/FR70 before implementation.

**Nice-to-Have Gaps:**
- French i18n strings for new result-toast/error messages not yet drafted (mechanical, low-risk).

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions (`format_version: 1`)
- [x] Technology stack fully specified (inherited, no new deps)
- [x] Integration patterns defined
- [x] Performance considerations addressed (bulk cap at 100 categories, single transaction)

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented (error handling, duplicate handling)

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Zero new dependencies; every pattern mirrors an existing, working precedent in this exact codebase
- Deliberately minimal data model (no new tables) directly serves FR96's "no server, ever" intent instead of fighting it
- Forward-compatible with the stated future S3-hosted gallery without any rework

**Areas for Future Enhancement:**
- Remote/hosted public template gallery (explicitly deferred)
- Merge-instead-of-skip duplicate handling, if user feedback wants it later

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document, and its parent `architecture-desktop.md`, for all architectural questions

**First Implementation Priority:** `models::{SystemBudgetTemplate, TemplateGroupDef, TemplateCategoryDef, ApplyBudgetTemplateResult}` + `budget/template_defaults.rs` with the Canadian starter template — establishes the schema everything else builds on.
