---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - _bmad-output/planning-artifacts/prd-savings-projects.md
  - docs/project-context.md
workflowType: 'architecture'
project_name: 'nixus'
user_name: 'dev'
date: '2026-08-11'
lastStep: 8
status: 'complete'
completedAt: '2026-08-11'
---

# Architecture Decision Document: Savings Projects

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:** 10 FRs across 3 clusters — (1) project CRUD (FR1, FR2), (2) contribution ledger + earmark visualization (FR3-FR5), (3) opt-in suggested allocation gated on financial-health state (FR6-FR9), plus a dashboard rollup (FR10). This is a closed, well-bounded feature addition to an existing product, not a new system.

**Non-Functional Requirements:** NFR1 (local CRUD latency) and NFR2 (integer-cents money) are already satisfied by existing conventions — no new work. NFR3 (block/guard account deletion when contributions exist) and NFR4 (suggestions never auto-persist) are the two NFRs that actually shape the design: NFR3 requires a `RESTRICT`-equivalent guard on account deletion; NFR4 requires the allocation-suggestion computation to be a pure read-only function, never a write path.

**Scale & Complexity:**
- Primary domain: Desktop app (Tauri + React + Rust + SQLite), extending an existing, mature codebase — not greenfield.
- Complexity level: **Low-to-medium.** No new external integrations, no auth/security surface changes, no multi-tenancy. The only non-trivial piece is the suggested-allocation weighting algorithm (FR6-FR9), which is a pure deterministic function comparable in shape to the existing `financial_health::evaluator` waterfall logic.
- Estimated architectural components: 2 new DB tables, 1 new Rust command module + 1 new pure logic module, 1 new frontend route + ~4-5 components (mostly composed from existing primitives), 1 new dashboard card.

### Technical Constraints & Dependencies

- Must reuse the existing stack exactly as pinned in `docs/project-context.md` — no new dependencies needed for this feature (no new crates, no new npm packages).
- Hard constraint from `apps/desktop/src/lib/navigation.ts`: Finance's `Wealth` destination has a compile-time cap of 5 sub-surfaces and currently has 4 — exactly one slot remains, which this feature will consume.
- Money-movement constraint (product-level, from PRD): `accounts.balance_cents` must never be mutated by this feature. All earmarking is derived/computed, never stored on the account row.
- Depends on existing `financial_health::evaluator::WaterfallStep` and `SavingsSummary.avg_monthly_surplus_cents` as read-only inputs — this feature adds no new financial-health computation, it only consumes the existing output.

### Cross-Cutting Concerns Identified

- **Audit logging**: every project/contribution create/update/delete must call `audit_db::insert_audit_log` per existing convention — no exception for this feature.
- **Account deletion boundary**: `delete_account` command must be extended to check for existing `project_contributions` rows and block (or cascade-block, decided below) — this is the one place this feature touches existing code outside its own module.
- **i18n**: all new UI strings go through i18next, matching every other feature.
- **Dashboard invalidation**: the new dashboard card's query key must be invalidated by contribution mutations, following the existing TanStack Query `onSuccess` invalidation convention.

---

## Starter Template Evaluation

**Not applicable.** This is a feature addition to an existing, established monorepo (Tauri 2 / React 19 / Rust / SQLite, per `docs/project-context.md`) — there is no starter template decision to make. All technology choices are inherited as-is from the current codebase; no new dependencies are introduced.

---

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
1. Earmarking model: contribution ledger, never mutate `accounts.balance_cents`
2. Schema: two new tables (`projects`, `project_contributions`)
3. Suggested-allocation logic: pure function, read-only, gated on `WaterfallStep`

**Important Decisions (Shape Architecture):**
4. Backend module shape: thin `commands/projects.rs` + `db/projects.rs` + pure `projects/allocation.rs`
5. Frontend placement: `/wealth/projects` sub-surface (not a new top-level module)
6. Account-deletion guard for existing contributions

**Deferred Decisions (Post-MVP, no action needed now):**
- AI-chat awareness of projects (Growth phase per PRD) — deferred because it only needs read access to tables defined now; no schema impact.
- Milestone/gamification visual states — pure frontend polish, deferred to implementation-time UI pass, no architectural dependency.

### Data Architecture

**Schema (migration `025_projects.sql`):**

```sql
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    target_cents INTEGER NOT NULL,
    target_date TEXT,              -- ISO 8601, nullable (no deadline required)
    priority INTEGER NOT NULL DEFAULT 0,  -- lower = higher priority, user-orderable
    icon TEXT,
    color TEXT,
    archived_at TEXT,               -- nullable; soft-delete pattern (matches budget_category_soft_delete precedent from migration 022)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual', 'suggested')),
    date TEXT NOT NULL,             -- ISO 8601
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_project_contributions_project_id ON project_contributions(project_id);
CREATE INDEX idx_project_contributions_account_id ON project_contributions(account_id);
```

**Rationale:** `ON DELETE RESTRICT` on `account_id` directly satisfies NFR3 (deleting an account with contributions is blocked at the DB layer, not just application logic) — this is stronger and cheaper than an application-level check. `ON DELETE CASCADE` on `project_id` means archiving/deleting a project cleans up its own ledger without side effects elsewhere. `source` enum distinguishes manual vs. confirmed-suggestion entries for future analytics without needing a separate table. Soft-delete (`archived_at`) on `projects` mirrors the existing `budget_category_soft_delete` (migration 022) precedent rather than hard-deleting projects with history.

**Data modeling approach:** Ledger-over-balance, matching the `expense_income_account_id` FK pattern (migration 021) exactly — `project_contributions.account_id` is the same shape as `expenses.account_id`. "Earmarked amount for account X" = `SUM(amount_cents) GROUP BY account_id, project_id`, computed on read, never stored redundantly. "Available/unallocated" for an account = `accounts.balance_cents - SUM(all contributions from that account)`, also computed on read.

**Migration approach:** Standard — add `025_projects.sql`, register in `db/mod.rs`'s migration array, no data backfill needed (net-new tables).

**Caching strategy:** None beyond existing TanStack Query cache — data volumes are tiny (dozens of projects/contributions per user, not thousands), no need for anything beyond the standard invalidate-on-mutation pattern already used everywhere else.

### Authentication & Security

Not applicable — Nixus is single-user, local-only, no new auth surface. No decisions needed here.

### API & Communication Patterns

**Commands (Tauri IPC, `commands/projects.rs`):**
- `create_project`, `update_project`, `archive_project` — standard CRUD, `#[tauri::command(rename_all = "snake_case")]`, return `Result<Project, AppError>`
- `get_projects` (active only, default) / `get_all_projects` (including archived, for history views)
- `create_project_contribution`, `delete_project_contribution`
- `get_account_earmark_breakdown(account_id)` → returns unallocated + per-project segments for one account (feeds the breakdown bar)
- `get_suggested_allocation()` → pure read: returns `None`/empty if `WaterfallStep` not in `{ContributeRegisteredAccounts, InvestSurplus}`, otherwise a `Vec<ProjectAllocationSuggestion>` with editable-by-frontend amounts; **writes nothing**
- `confirm_project_allocations(allocations: Vec<ProjectAllocationInput>)` → the only write path for suggestions; creates one `project_contributions` row per entry with `source = "suggested"`

All commands follow existing error/audit conventions exactly (see Implementation Patterns below) — no new API design pattern introduced.

**Error handling:** Standard `AppError` — no new error variants needed; existing `validation`/`database` variants cover all failure modes (e.g., validation error if a contribution's account doesn't exist, or if edited suggestion total exceeds surplus).

### Frontend Architecture

**Route:** New file-based route `wealth.projects.tsx` (list) — this is the one remaining slot in the `Wealth` destination in `navigation.ts`. If the project later grows non-financial goals, promoting it to a standalone rail module (copying the `car.tsx`/`maintenance/` pattern) is the documented escape hatch — not needed for MVP.

**State management:** TanStack Query, same as every other feature — new query keys `projects`, `project(id)`, `accountEarmarks(accountId)`, `suggestedAllocation` added to `queryKeys` in `lib/constants.ts`.

**Component reuse (no new primitives invented):**
- Per-project progress row → adapts `BudgetCategoryRow`'s meter/badge/pacing shape (saved vs. target instead of spent vs. target)
- Account earmark split → reuses `NetWorthBreakdownBar` as-is (unallocated + N project segments, already supports arbitrary named segments)
- Dashboard card → new `SavingsProjectsCard` composed from `DashboardMetricCard` (secondary-row variant, single "total saved across active projects" figure) — matches existing card taxonomy, no new card primitive

**Performance:** No special optimization needed — data volumes are small; standard React Query caching is sufficient.

### Infrastructure & Deployment

Not applicable — ships as part of the existing desktop app build/release pipeline, no new infra.

### Decision Impact Analysis

**Implementation Sequence:**
1. Migration `025_projects.sql` + register in `db/mod.rs`
2. `models/mod.rs`: `Project`, `CreateProjectInput`, `UpdateProjectInput`, `ProjectContribution`, `CreateProjectContributionInput`, `AccountEarmarkBreakdown`, `ProjectAllocationSuggestion`
3. `db/projects.rs`: all SQL (CRUD + earmark aggregation queries)
4. `projects/allocation.rs`: pure `compute_suggested_allocation()` function (mirrors `financial_health/evaluator.rs` shape — takes `WaterfallStep` + `avg_monthly_surplus_cents` + active projects, returns suggestions, no DB access)
5. `commands/projects.rs`: thin orchestration wrapping 3-4, wired into `lib.rs`
6. Extend `commands/account.rs::delete_account` with the contribution-exists guard
7. Frontend: route + components + hooks, in the order list → detail → earmark breakdown → dashboard card → suggestion flow

**Cross-Component Dependencies:** The suggestion flow (step 7, last) depends on everything before it being in place, since it reads projects, surplus, and waterfall step and writes through the same contribution path as manual entries — it's additive, not a parallel path.

---

## Implementation Patterns & Consistency Rules

**Critical Conflict Points Identified:** 4 — all resolved by directly inheriting existing project-wide conventions, no new patterns invented for this feature.

### Naming Patterns
- Tables/columns: `snake_case`, `_cents` suffix for all money fields (`target_cents`, `amount_cents`) — per `docs/project-context.md` rule #1
- Commands: `snake_case` function names, `rename_all = "snake_case"` macro attribute — rule #2
- Rust structs: `PascalCase`, inputs named `Create{Domain}Input`/`Update{Domain}Input` — rule #4
- Frontend: routes kebab-case (`wealth.projects.tsx`), components PascalCase (`SavingsProjectsCard.tsx`), hooks `use{Feature}.ts` (`useProjects.ts`)
- Query keys: kebab-case string arrays in `queryKeys` object — never hardcoded in hooks (rule #6)

### Structure Patterns
- `commands/projects.rs` (orchestration only) + `db/projects.rs` (all SQL) — per rule #3, no SQL in commands
- New pure-logic file `projects/allocation.rs` — justified deviation (adds a module dir, like `financial_health/` and `maintenance/`) because the allocation-weighting algorithm is non-trivial deterministic logic that deserves isolation from DB orchestration, exactly mirroring the `financial_health::evaluator` precedent
- Frontend components under `components/projects/`, one file per component, following the flat feature-folder convention used by `budget/`, `accounts/`, `maintenance/`

### Format Patterns
- Dates: ISO 8601 strings everywhere (`target_date`, `date` columns) — rule #4
- API responses: `Result<T, AppError>` — no custom wrapper, matching every other command
- `AppError` JSON shape unchanged — no new error variants required

### Process Patterns
- **Audit logging is mandatory**: `create_project`, `update_project`, `archive_project`, `create_project_contribution`, `delete_project_contribution`, and `confirm_project_allocations` each call `audit_db::insert_audit_log` with `entity_type = "project"` or `"project_contribution"` — no exceptions, per rule "Skipping audit log on mutations" anti-pattern
- **Suggestion flow is read/write-separated**: `get_suggested_allocation` is a pure query (zero writes, satisfies NFR4 directly); only `confirm_project_allocations` writes. This separation is the one process rule specific to this feature and must not be collapsed into a single command.
- **Query invalidation**: every contribution mutation's `onSuccess` invalidates `projects`, `project(id)`, `accountEarmarks(accountId)`, and the dashboard's savings-summary query key — per rule #6 (invalidate ALL affected keys)

### Enforcement Guidelines

**All AI Agents MUST:**
- Never write to `accounts.balance_cents` from any code path in this feature
- Never let `get_suggested_allocation` (or any `get_*` command) perform a DB write
- Always route new SQL through `db/projects.rs`, never inline in `commands/projects.rs`
- Check `@nixus/shared/ui` and existing dashboard/budget/net-worth components before creating any new UI primitive

**Good Example:** `get_account_earmark_breakdown` sums `project_contributions` grouped by project, computes `unallocated = balance_cents - total`, returns a struct — never touches the `accounts` table's write path.

**Anti-Pattern to avoid:** A `confirm_project_allocations` implementation that also updates `accounts.balance_cents` "for convenience" — this would violate the PRD's core no-real-money-movement constraint and NFR2/SC2.

---

## Project Structure & Boundaries

### Complete Project Directory Structure (new/changed files only)

```
apps/desktop/src-tauri/
├── migrations/
│   └── 025_projects.sql                       # new
├── src/
│   ├── models/mod.rs                          # +Project, +ProjectContribution, +input/summary structs
│   ├── db/
│   │   └── projects.rs                        # new — all SQL for projects + contributions + earmark aggregation
│   ├── projects/
│   │   └── allocation.rs                      # new — pure compute_suggested_allocation()
│   ├── commands/
│   │   ├── projects.rs                        # new — CRUD + suggestion commands
│   │   └── account.rs                         # modified — delete_account guard for existing contributions
│   └── lib.rs                                  # modified — register new commands

apps/desktop/src/
├── routes/
│   └── wealth.projects.tsx                    # new
├── components/
│   ├── projects/
│   │   ├── ProjectRow.tsx                     # new — per-project progress (BudgetCategoryRow-shaped)
│   │   ├── ProjectForm.tsx                     # new — create/edit
│   │   ├── ProjectContributionForm.tsx         # new — log a contribution
│   │   ├── SuggestedAllocationPanel.tsx        # new — editable per-project suggestion review
│   │   └── AccountEarmarkBar.tsx               # new — thin wrapper around NetWorthBreakdownBar for one account
│   └── dashboard/
│       └── SavingsProjectsCard.tsx             # new — Today dashboard summary card
├── hooks/
│   └── useProjects.ts                          # new — all project/contribution/suggestion hooks
└── lib/
    └── constants.ts                            # modified — +queryKeys.projects, .project(id), .accountEarmarks(id), .suggestedAllocation
```

### Architectural Boundaries

**API Boundaries:** Frontend calls only through `invoke()` into `commands/projects.rs` — no direct DB access from frontend (unchanged pattern). `commands/account.rs` gains one new internal check (contribution-existence) but its public API surface is unchanged.

**Component Boundaries:** `components/projects/` owns all project-specific UI; it consumes but does not modify `NetWorthBreakdownBar` (net-worth's component, reused read-only) or the `BudgetCategoryRow` shape (referenced as a pattern, not imported cross-feature — a project-specific `ProjectRow` is written using the same meter/badge composition, avoiding a cross-feature import dependency from `projects/` into `budget/`).

**Data Boundaries:** `project_contributions.account_id` is the only foreign touchpoint into the existing `accounts` table — read-only reference, enforced by `ON DELETE RESTRICT` at the schema level, never a write.

### Requirements to Structure Mapping

- FR1, FR2 (create/edit/archive project) → `commands/projects.rs::{create,update,archive}_project`, `db/projects.rs`, `components/projects/ProjectForm.tsx`
- FR3, FR4 (log/delete contribution) → `commands/projects.rs::{create,delete}_project_contribution`, `components/projects/ProjectContributionForm.tsx`
- FR5 (earmark breakdown) → `commands/projects.rs::get_account_earmark_breakdown`, `components/projects/AccountEarmarkBar.tsx`
- FR6-FR8 (suggested allocation) → `projects/allocation.rs`, `commands/projects.rs::{get_suggested_allocation, confirm_project_allocations}`, `components/projects/SuggestedAllocationPanel.tsx`
- FR9 (priority reorder) → `commands/projects.rs::update_project` (priority field), drag-reorder UI in `wealth.projects.tsx`
- FR10 (dashboard card) → `components/dashboard/SavingsProjectsCard.tsx`, wired into `routes/index.tsx`
- NFR3 (account deletion guard) → `commands/account.rs::delete_account` + `ON DELETE RESTRICT` FK

### Integration Points

**Internal Communication:** Pure TanStack Query invalidation, no event bus — consistent with the rest of the app.

**External Integrations:** None.

**Data Flow:** UI → hook → `invoke()` → `commands/projects.rs` → `db/projects.rs` (writes) or `projects/allocation.rs` (pure compute, no DB) → `AppError`-wrapped result → React Query cache → re-render.

---

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** All decisions reuse existing, already-compatible versions (Tauri 2, rusqlite 0.38, React 19, TanStack Query/Router) — no version conflicts possible since nothing new is introduced.

**Pattern Consistency:** Naming, structure, and process patterns are 100% inherited from `docs/project-context.md`; the one net-new structural choice (a dedicated `projects/allocation.rs` module) is justified by direct precedent (`financial_health/evaluator.rs`), not an arbitrary deviation.

**Structure Alignment:** The `commands/` + `db/` + one pure-logic module split supports every functional requirement without needing any additional layer.

### Requirements Coverage Validation ✅

All 10 FRs and all 4 NFRs are mapped to specific files/commands above (see Requirements to Structure Mapping) — no gaps. SC2 and SC5 (the two success criteria most at risk of accidental violation) are enforced at the schema/command-boundary level (`RESTRICT` FK, read/write-separated suggestion commands), not just by convention — this is deliberately stronger than "agents should remember not to."

### Implementation Readiness Validation ✅

**Decision Completeness:** All critical and important decisions documented with concrete schema, command signatures, and file paths — no open questions blocking a first implementation pass.

**Structure Completeness:** Full file tree provided above; every new file has a stated responsibility.

**Pattern Completeness:** All 4 conflict-point categories (naming, structure, format, process) resolved by inheritance from existing project-wide rules, plus one feature-specific process rule (read/write separation for suggestions) called out explicitly.

### Gap Analysis Results

**Critical Gaps:** None.

**Important Gaps:** The exact default-split weighting formula for FR9 (priority + deadline urgency) is specified at the product level (PRD) but not reduced to a precise formula here — left as an implementation detail of `compute_suggested_allocation()` since it's pure, unit-testable logic with no architectural dependency; over-specifying the formula in the architecture doc would constrain a decision better made with test cases during implementation.

**Nice-to-Have Gaps:** AI-chat tie-in and milestone visual states (both explicitly Growth/deferred in the PRD) have no architectural blockers when their time comes — they're additive reads against tables already defined here.

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (low-to-medium)
- [x] Technical constraints identified (navigation cap, no-money-movement rule)
- [x] Cross-cutting concerns mapped (audit log, account-deletion boundary, i18n, query invalidation)

**✅ Architectural Decisions**
- [x] Critical decisions documented (schema, command shapes, allocation module)
- [x] Technology stack fully specified (inherited, no new deps)
- [x] Integration patterns defined (IPC commands, FK boundary)
- [x] Performance considerations addressed (no special handling needed at this scale)

**✅ Implementation Patterns**
- [x] Naming conventions established (inherited)
- [x] Structure patterns defined (`commands`/`db`/`allocation.rs` split)
- [x] Communication patterns specified (TanStack Query invalidation)
- [x] Process patterns documented (audit logging, read/write separation)

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — this is a well-bounded feature addition to a mature codebase with strong existing conventions; nearly every decision was "follow the existing precedent," not a novel choice.

**Key Strengths:** Zero new dependencies; the two riskiest product requirements (no real money movement, suggestions never silently applied) are enforced structurally (DB constraint + command separation), not just documented as a convention agents must remember.

**Areas for Future Enhancement:** If non-financial goals are added later (per the PRD's explicitly-out-of-scope note), Projects should be promoted from a Wealth sub-surface to a standalone top-level module — the Car module's file structure is the template to copy at that time.

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented above
- Use implementation patterns consistently — especially the read/write separation on the suggestion flow and the FK-enforced account-deletion guard
- Respect the `commands/` → `db/` → (`projects/allocation.rs` for pure compute) layering
- Refer to this document and `prd-savings-projects.md` for all architectural questions

**First Implementation Priority:** `migrations/025_projects.sql` + the corresponding `models/mod.rs` structs — everything else depends on the schema existing first.

