# Story 31.1: Create and manage savings projects

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user,
I want to create a named savings goal with a target amount and optional date,
so that I have a place to track progress toward a specific big purchase.

## Acceptance Criteria

1. **Given** I am on the Wealth section of the app
   **When** I navigate to the new Projects sub-surface
   **Then** I see a list of my active projects (empty state if none exist)

2. **Given** I am on the Projects list
   **When** I create a project with a name and target amount (target date and priority optional)
   **Then** the project is persisted and appears immediately in the list with $0 saved of the target

3. **Given** an existing project
   **When** I edit its name, target amount, or target date
   **Then** the changes are saved and reflected immediately in the list

4. **Given** an existing project
   **When** I archive it
   **Then** it disappears from the active list but its data is retained (not hard-deleted)

5. **Given** any create/update/archive action succeeds
   **When** the audit log is inspected
   **Then** an entry exists with `entity_type = "project"` for that action

6. **Given** the migration has run
   **When** the schema is inspected
   **Then** both `projects` and `project_contributions` tables exist exactly as specified in the architecture document, including `ON DELETE RESTRICT` on `project_contributions.account_id` and `ON DELETE CASCADE` on `project_contributions.project_id`

7. **Given** the implementation is inspected
   **When** monetary fields are checked
   **Then** every money value is an `i64` / `number` in integer cents with a `_cents`-suffixed field name, and no `f64` appears in any Rust code path of this story

8. **Given** no code path in this story
   **When** the diff is inspected
   **Then** nothing writes to `accounts.balance_cents` — this feature never moves money

## Tasks / Subtasks

- [x] **Task 1 — Add migration `025_projects.sql` and register it** (AC: #6, #7)
  - [x] Create `apps/desktop/src-tauri/migrations/025_projects.sql` with the SQL transcribed **verbatim** from Dev Notes → "Migration 025 — exact SQL". Do not rename a column, do not add a column, do not change a constraint.
  - [x] Register it in the `MIGRATIONS` array in `apps/desktop/src-tauri/src/db/mod.rs` (array ends at entry `24` on lines 58–61) by appending `(25, include_str!("../../migrations/025_projects.sql")),`. Let `cargo fmt` decide wrapping — entry 24 is only wrapped because its filename is longer.
  - [x] Add `pub mod projects;` to the module list at the top of `db/mod.rs` (lines 9–30, alphabetical — it goes between `pub mod projection;` and `pub mod recurring;`).
  - [x] Verify the migration applies on a fresh DB and on an existing DB: `run_migrations` (`db/mod.rs:88`) applies anything with `version > current_version`, so no backfill and no data migration is needed — these are net-new tables.
  - [x] Confirm `PRAGMA foreign_keys=ON` is already set for every connection (`db/mod.rs:79`, inside `open_configured`) — this is what makes `ON DELETE RESTRICT` actually enforced at runtime. Do **not** add a second PRAGMA anywhere.
- [x] **Task 2 — Add the Rust models** (AC: #2, #3, #7)
  - [x] In `apps/desktop/src-tauri/src/models/mod.rs`, add `Project`, `CreateProjectInput`, `UpdateProjectInput` and `ProjectContribution` + `CreateProjectContributionInput` exactly as written in Dev Notes → "Rust models to add".
  - [x] `Project` and `ProjectContribution` derive exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`. Input structs derive `#[derive(Debug, Clone, Deserialize)]`, matching the `CreateAccountInput` precedent at `models/mod.rs:155`.
  - [x] All fields `snake_case`; all dates `String` (ISO 8601); nullable columns become `Option<String>` / `Option<i64>`. **No** `#[serde(rename_all = ...)]` on any of these structs — the fields are already `snake_case`.
  - [x] `ProjectContribution` / `CreateProjectContributionInput` are added here (not in Story 31.2) only because the migration creates both tables together; **no db function or command for contributions ships in this story**. If the compiler warns they are unused, that is expected — Story 31.2 consumes them. Prefer landing 31.1 and 31.2 in sequence; if 31.1 must compile warning-free standalone (project rule 9), add `#[allow(dead_code)]` on those two structs with a one-line WHY comment naming Story 31.2, and Story 31.2 removes the attribute.
- [x] **Task 3 — Create `db/projects.rs` with project CRUD (TDD: write the test first for each)** (AC: #2, #3, #4, #7)
  - [x] Create `apps/desktop/src-tauri/src/db/projects.rs` importing `rusqlite::{params, Connection}`, `crate::error::AppError`, and the models — mirroring the file header of `db/account.rs:1-4`.
  - [x] `pub fn insert_project(conn: &Connection, input: &CreateProjectInput) -> Result<Project, AppError>` — trim `name`, reject empty with `AppError::Validation { message: "Project name is required", field: Some("name") }` (mirrors `db/account.rs:132-138`); reject `target_cents <= 0` with `field: Some("target_cents")`; `INSERT`, then `SELECT` the row back by `conn.last_insert_rowid()` and return the full `Project` (mirrors `db/account.rs:162-186`).
  - [x] `priority` is `input.priority.unwrap_or(0)` — the column's `DEFAULT 0`. **Do not** implement "append to the end of the order" here: that behaviour is Story 32.1's acceptance criterion, and inventing it now would ship untested ordering logic this story has no AC for.
  - [x] `pub fn get_active_projects(conn: &Connection) -> Result<Vec<Project>, AppError>` — `WHERE archived_at IS NULL ORDER BY priority, id`, using `stmt.query_map(...).collect::<Result<Vec<_>, _>>()?` exactly as `db/account.rs:188-211` does.
  - [x] `pub fn get_project_by_id(conn: &Connection, id: i64) -> Result<Project, AppError>` — single-row read used by the update/archive paths and by the command layer's audit `old_value` capture (shape: `db/account.rs:297-315`).
  - [x] `pub fn update_project(conn: &Connection, id: i64, input: &UpdateProjectInput) -> Result<Project, AppError>` — same validation as insert, then `UPDATE ... SET name, target_cents, target_date, priority, icon, color, updated_at = datetime('now') WHERE id = ?N`; if `rows == 0` return `AppError::Database { message: "Project not found" }` (mirrors `db/account.rs:273-285`).
  - [x] `pub fn archive_project(conn: &Connection, id: i64) -> Result<Project, AppError>` — soft delete: `UPDATE projects SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1 AND archived_at IS NULL`; `rows == 0` → `AppError::Database { message: "Project not found" }`. The `AND archived_at IS NULL` guard makes a double-archive a no-op error instead of silently rewriting the timestamp — this mirrors `db/budget.rs:278`.
  - [x] Never `DELETE FROM projects` anywhere in this story. Archive is the only removal path (AC #4).
  - [x] Do **not** write `get_all_projects` (documented in the architecture for future history views). No AC in Epic 31 requires it and an unused function is a rule-9 warning; add it in the story that needs it.
- [x] **Task 4 — Create `commands/projects.rs` and register the commands** (AC: #2, #3, #4, #5)
  - [x] Add `pub mod projects;` to `apps/desktop/src-tauri/src/commands/mod.rs` (alphabetical, after `pub mod projection;`).
  - [x] Create `apps/desktop/src-tauri/src/commands/projects.rs` with four commands, each `#[tauri::command(rename_all = "snake_case")]`, each returning `Result<T, AppError>`, each locking state with `state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?` — copy the shape of `commands/account.rs:10-39` line for line.
  - [x] `create_project(state, name: String, target_cents: i64, target_date: Option<String>, priority: Option<i32>, icon: Option<String>, color: Option<String>) -> Result<Project, AppError>`
  - [x] `update_project(state, id: i64, name: String, target_cents: i64, target_date: Option<String>, priority: Option<i32>, icon: Option<String>, color: Option<String>) -> Result<Project, AppError>`
  - [x] `archive_project(state, id: i64) -> Result<Project, AppError>`
  - [x] `get_projects(state) -> Result<Vec<Project>, AppError>` → `projects_db::get_active_projects(&conn)`. Read-only: **zero writes, no audit log** (a `get_*` command must never write — architecture "Enforcement Guidelines").
  - [x] Audit logging on all three mutations via `audit_db::insert_audit_log(&conn, "project", id, action, old_value, new_value)` with `action` ∈ `"create"` / `"update"` / `"archive"`. `old_value` for update/archive is `serde_json::to_string(&projects_db::get_project_by_id(&conn, id)?)` captured **before** the mutation; `new_value` is the returned row serialized. On audit failure, log with `tracing::error!` and still return `Ok` — the exact non-fatal pattern at `commands/account.rs:31-33`.
  - [x] **No SQL in this file** (project rule 3). No `conn.execute`, no `conn.query_row` other than through `db::projects`. The `get_account_json` private helper in `commands/account.rs:134` is a pre-existing violation — do not copy it; use `projects_db::get_project_by_id` instead.
  - [x] Do **not** call `net_worth_db::record_net_worth_snapshot` (as `commands/account.rs` does). Projects do not change net worth — no balance and no asset value moves.
  - [x] Register all four in the `tauri::generate_handler![...]` list in `apps/desktop/src-tauri/src/lib.rs` (list starts at line 171), as `commands::projects::create_project`, `...::update_project`, `...::archive_project`, `...::get_projects`.
- [x] **Task 5 — Frontend types, query keys, and hooks** (AC: #1, #2, #3, #4)
  - [x] Add `Project`, `CreateProjectInput`, `UpdateProjectInput` interfaces to `apps/desktop/src/lib/types.ts`, mirroring the Rust shapes (`number` for `_cents`, `string | null` for nullable text) — follow the `Account` block at `types.ts:91-100`.
  - [x] Add to `queryKeys` in `apps/desktop/src/lib/constants.ts`: `projects: ["projects"] as const` and `project: (id: number) => ["projects", id] as const`. Kebab-case string arrays, never hardcoded in a hook (project rule 6).
  - [x] Create `apps/desktop/src/hooks/useProjects.ts` exporting `useProjects()`, `useCreateProject()`, `useUpdateProject()`, `useArchiveProject()` — one file per feature, shape copied from `hooks/useAccounts.ts:11-73`.
  - [x] Every mutation's `onSuccess` invalidates `queryKeys.projects`. **Do not** invalidate `netWorthCurrent` / `netWorthSnapshotsRecent` / `financialHealth` — none of them change (contrast with `useAccounts.ts:29-34`, which must, because balances move there).
  - [x] `invoke` argument names must be `snake_case` and match the Rust parameter names exactly (project rule 2).
- [x] **Task 6 — Add the `/wealth/projects` sub-surface** (AC: #1)
  - [x] In `apps/desktop/src/lib/navigation.ts`, append `{ to: "/wealth/projects", labelKey: "nav.projects" }` to the `children` array of the `/wealth` destination (currently `navigation.ts:47-55`, 4 entries). This consumes the last of the five documented sub-surface slots.
  - [x] Do **not** add a fifth top-level destination and do **not** widen the `FourDestinations` tuple type (`navigation.ts:28`).
  - [x] Create `apps/desktop/src/routes/wealth.projects.tsx` with `createFileRoute("/wealth/projects")({ component: ProjectsPage })`. Never hand-edit `routeTree.gen.ts`; run dev/build to regenerate it (project rule: TanStack Router).
  - [x] Page composition, mirroring `routes/wealth.accounts.tsx:169-220`: `PageHeader` with title `t("nav.projects")`, subtitle, and an "Add project" `Button`; `Card` + `Skeleton` while `isLoading`; `Card` + `EmptyState` (icon `Target` or `PiggyBank` from `lucide-react`) when the list is empty; otherwise the list of rows.
  - [x] Create `apps/desktop/src/components/projects/ProjectRow.tsx` — per-project progress row mirroring the **composition** of `components/budget/BudgetCategoryRow.tsx` (name + `Money` saved/target pair + `Badge` + `Meter` from `@nixus/shared`). Write a project-specific component; do **not** import `BudgetCategoryRow` across features (architecture "Component Boundaries").
  - [x] `ProjectRow` takes `savedCents: number` as a prop. In this story the page passes `0`: no contribution can exist yet because no contribution command ships until Story 31.2, so `$0 saved` is factually correct here (AC #2) and Story 31.2 replaces the literal with real summed data. Add a one-line WHY comment naming Story 31.2.
  - [x] Render the `Meter` only when `target_cents > 0` (guard copied from `BudgetCategoryRow.tsx:175`), and derive remaining/percent in the component from `savedCents` and `target_cents` — no money math in the backend for display purposes.
- [x] **Task 7 — `ProjectForm.tsx` (create + edit) and archive action** (AC: #2, #3, #4)
  - [x] Create `apps/desktop/src/components/projects/ProjectForm.tsx` using `react-hook-form` with `mode: "onBlur"` and `noValidate` on the `<form>`, mirroring `components/accounts/AddAccountForm.tsx:55-101` including the `noValidate` rationale (styled inline error + `aria-invalid` + `aria-describedby`).
  - [x] One component serves create and edit: an optional `project?: Project` prop selects `defaultValues` and which mutation to call. `onClose` callback prop, as `AddAccountForm` has.
  - [x] Fields: name (`Input`, required), target amount (`MoneyInput` from `@/components/shared/MoneyInput` inside a `Controller` with `rules: { validate: (v) => v > 0 || t("validation.amountPositive") }` — exact pattern at `components/income/AddIncomeEntryForm.tsx:124-146`), target date (`DatePicker` from `@nixus/shared`, **optional** — no `required` rule), priority (`Input type="number"`, optional).
  - [x] `MoneyInput` already converts dollars → integer cents (`MoneyInput.tsx:60`, `Math.round(dollars * 100)`). Never parse a currency string yourself and never send dollars over IPC.
  - [x] Mount the form in a `SlideOver` from `@nixus/shared` on `wealth.projects.tsx`, one for add and one for edit, exactly as `wealth.accounts.tsx:360-382` does.
  - [x] Archive: a `Dialog` confirmation from `@nixus/shared` (pattern: `components/accounts/AccountRow.tsx:196-210`) calling `useArchiveProject()`. Success/failure toasts via `sonner`: `toast.success(t("toast.saveSuccess"))` / `toast.error(t("toast.saveFailed"))`.
  - [x] Icon/color are in the schema but no AC requires a picker. Ship them as pass-through `Option`/`null` on the IPC boundary and add no UI for them — do not invent a colour picker.
- [x] **Task 8 — i18n keys in both locales** (AC: #1, #2, #3, #4)
  - [x] Add every key from Dev Notes → "i18n keys" to `apps/desktop/src/locales/en.json` **and** `apps/desktop/src/locales/fr.json` in the same change. Files are flat dotted-key JSON.
  - [x] Create `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` modelled on `locales/__tests__/recurring-i18n.test.ts`: a `projects.` prefix parity check plus an explicit `REQUIRED_KEYS` list of every key this story's components read.
  - [x] No hardcoded English in JSX anywhere (project rule: i18n).
- [x] **Task 9 — Rust unit tests (write these before the code they cover)** (AC: #2, #3, #4, #6, #7, #8)
  - [x] Add `#[cfg(test)] mod tests` at the bottom of `db/projects.rs` with a `projects_test_db() -> Connection` helper that opens `Connection::open_in_memory()`, executes `PRAGMA foreign_keys=ON;`, then creates `accounts`, `projects` and `project_contributions` — copy the accounts DDL from `db/account.rs:464-480` and paste the projects DDL from the migration verbatim. This is exactly the `budget_test_db()` pattern at `db/budget.rs:385-439`.
  - [x] Test: `insert_project` persists and returns a row whose `target_cents` matches, `archived_at` is `None`, and `priority` is `0` when not supplied.
  - [x] Test: `insert_project` with a blank/whitespace name → `AppError::Validation` with `field == Some("name")`.
  - [x] Test: `insert_project` with `target_cents = 0` and with a negative value → `AppError::Validation` with `field == Some("target_cents")`.
  - [x] Test: `get_active_projects` returns only rows where `archived_at IS NULL`, ordered by `priority`.
  - [x] Test: `update_project` changes name, target and date; `update_project` on a missing id → `Err`.
  - [x] Test: `archive_project` sets `archived_at` to a non-null value, the row still exists (`SELECT COUNT(*) FROM projects` is unchanged — proves soft delete, AC #4), and it disappears from `get_active_projects`.
  - [x] Test: `archive_project` on an already-archived project → `Err` (the `AND archived_at IS NULL` guard).
  - [x] Test (schema guard, AC #6): insert an account and a project, insert a `project_contributions` row, then assert a raw `DELETE FROM projects WHERE id = ?` cascades the contribution away (`ON DELETE CASCADE`), and that a raw `DELETE FROM accounts WHERE id = ?` returns `Err` (`ON DELETE RESTRICT`). This is the cheapest place to prove the constraint that Story 31.5 later depends on.
  - [x] Test (AC #8): read `balance_cents` before and after `insert_project` / `update_project` / `archive_project` and assert it is unchanged. Contrast: `db/income.rs`'s tests (`db/income.rs:439+`) assert balances **do** move — that is income's contract, and it must not be copied here.
- [x] **Task 10 — Playwright / spec-mock audit** (AC: #1)
  - [x] `/wealth/projects` calls `get_projects` on load. Any existing spec that navigates into it will need a mock case, or its `invoke` mock falls through to `Promise.reject("Unknown command")` (project-context.md:295).
  - [x] Add `["wealth-projects", "/wealth/projects"]` to the `SURFACES` list in `apps/desktop/tests/nav-qa.spec.ts:101-119` **and** a `case "get_projects": return Promise.resolve([]);` to that spec's mock switch — nav-qa fails on console errors, so the mock is mandatory if the surface is listed.
  - [x] The sub-surface link now renders inside the Wealth segmented nav on every `/wealth/*` page. Confirm `apps/desktop/tests/navigation.spec.ts` (which asserts the Wealth landing is `/wealth/accounts`, lines 13 and 27) still passes — adding a fifth child does not change the landing target, which is `children[0]` (`components/shared/DestinationNav.tsx:55`).
  - [x] Optional but preferred: a new `apps/desktop/tests/projects.spec.ts` covering empty state → create → appears in list → edit → archive → disappears, with a self-contained mock in the style of `tests/accounts.spec.ts:3-40`.
- [x] **Task 11 — Verification** (AC: all)
  - [x] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` green; `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` introduces **zero** new warnings (project rule 9).
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` clean under `noUnusedLocals` / `noUnusedParameters`.
  - [x] `pnpm --filter @nixus/desktop test` passes, including the new locale-parity spec.
  - [x] Grep the diff for `balance_cents` — the only permitted matches are in tests asserting it did **not** change (AC #8).
  - [x] Grep the diff for `f64` — expect zero matches in Rust (AC #7).
  - [x] Confirm no new Rust crate and no new npm package were added (architecture: "no new dependencies needed for this feature").

## Dev Notes

### What this story is, in one sentence

Two new tables, five model structs, one `db/projects.rs`, four thin commands, one new `/wealth/projects` sub-surface with a list + create/edit form + archive. **No contribution logic, no earmark breakdown, no dashboard card, no allocation suggestions.**

### Migration 025 — exact SQL

Transcribe verbatim into `apps/desktop/src-tauri/migrations/025_projects.sql`. This is copied from the architecture document's Data Architecture section and is authoritative — including the comments.

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

**Why both tables land in this story even though contributions are Story 31.2's feature:** `project_contributions.project_id` references `projects(id)`, so the two tables cannot be created by two independent migrations without ordering them anyway, and the architecture specifies them as one migration (`025_projects.sql`). Splitting them would produce a `025`/`026` pair the architecture does not describe. [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Architecture`]

**Constraint semantics that later stories depend on — do not "simplify" either one:**

- `ON DELETE RESTRICT` on `account_id` is the database-level enforcement of NFR3. Story 31.5 builds a user-facing error on top of it. Deleting an account that funds a project must fail in SQLite, not merely in application code. [Source: `architecture-savings-projects.md#Data Architecture` rationale paragraph]
- `ON DELETE CASCADE` on `project_id` means a hard project delete cleans up its own ledger. This story never hard-deletes a project (archive only), but the constraint must exist as specified.
- The `source` `CHECK` accepts `'manual'` and `'suggested'`. Story 31.2 writes only `'manual'`; `'suggested'` is Epic 32's. Do not narrow the CHECK to a single value.

Precedents this migration follows: `migrations/021_expense_income_account_id.sql` for the `REFERENCES accounts(id)` + per-FK index shape, and `migrations/022_budget_category_soft_delete.sql` for the nullable-timestamp soft-delete column.

Registration site, `db/mod.rs:34-62`:

```rust
const MIGRATIONS: &[(i64, &str)] = &[
    // ...
    (
        24,
        include_str!("../../migrations/024_income_entry_recurring_template.sql"),
    ),
];
```

### Rust models to add

Append to `apps/desktop/src-tauri/src/models/mod.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub target_cents: i64,
    pub target_date: Option<String>,
    pub priority: i32,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub target_cents: i64,
    pub target_date: Option<String>,
    pub priority: Option<i32>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateProjectInput {
    pub name: String,
    pub target_cents: i64,
    pub target_date: Option<String>,
    pub priority: Option<i32>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContribution {
    pub id: i64,
    pub project_id: i64,
    pub account_id: i64,
    pub amount_cents: i64,
    pub source: String,
    pub date: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateProjectContributionInput {
    pub project_id: i64,
    pub account_id: i64,
    pub amount_cents: i64,
    pub source: String,
    pub date: String,
}
```

**Known variance from `docs/project-context.md` rule #4**, which says models derive *exactly* `Debug, Clone, Serialize, Deserialize`: the input structs above omit `Serialize`. That matches the actual shipped precedent for input types — `CreateAccountInput` / `UpdateAccountInput` (`models/mod.rs:155`, `:163`) and `CreateAssetInput` (`:181`) are `#[derive(Debug, Clone, Deserialize)]`, because an input is deserialized from IPC and never serialized back. Output structs (`Project`, `ProjectContribution`) take the full four-derive set, which is what audit logging needs (`serde_json::to_string(&result)`).

`priority` is `i32` in Rust to match the `BudgetCategory.sort_order: i32` precedent (`models/mod.rs:18`) for small ordering integers; money stays `i64` unconditionally.

### The command layer, exactly

Copy `commands/account.rs::create_account` (lines 10–39) and change the nouns:

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn create_account(
    state: State<DbState>,
    name: String,
    /* ... */
) -> Result<Account, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateAccountInput { /* ... */ };
    let result = account_db::insert_account(&conn, &input)?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(&conn, "account", result.id, "create", None, Some(&details)) {
        tracing::error!("Failed to write audit log: {}", e);
    }
    Ok(result)
}
```

Three properties to carry over verbatim:

1. `#[tauri::command(rename_all = "snake_case")]` on every command, `Result<T, AppError>` as the return type, no `panic!`, no `.unwrap()` outside tests. [Source: `docs/project-context.md#2. Tauri IPC Commands`]
2. The lock error maps to `AppError::Database { message: e.to_string() }` — this exact expression, not a custom message.
3. **A failed audit write is logged and swallowed, never propagated.** The mutation already succeeded; returning `Err` would tell the UI the save failed when it did not.

Two properties **not** to carry over: `commands/account.rs` calls `net_worth_db::record_net_worth_snapshot` (irrelevant here — nothing about net worth changes), and it has a private `get_account_json` helper that runs SQL inside a command file (`commands/account.rs:134-153`), which violates project rule 3. Use `projects_db::get_project_by_id` for the audit `old_value` instead.

Audit signature, `db/audit.rs:5-12`:

```rust
pub fn insert_audit_log(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
    action: &str,
    old_value: Option<&str>,
    new_value: Option<&str>,
) -> Result<(), AppError>
```

`entity_type` is the literal `"project"` for all three mutations in this story (`"project_contribution"` is Story 31.2's). Skipping the audit log is a named anti-pattern. [Source: `docs/project-context.md#Anti-Patterns to Avoid`; `architecture-savings-projects.md#Process Patterns`]

### Errors — reuse only

`AppError` (`src-tauri/src/error.rs:5-13`) already covers every failure mode: `Validation { message, field }` for bad input, `Database { message }` for not-found and SQLite failures. `impl From<rusqlite::Error> for AppError` (`error.rs:101`) means `?` on any rusqlite call already produces `AppError::Database`. **Add no new variant** — the architecture states explicitly that none are needed.

### Frontend: navigation is the one hard capacity constraint

`apps/desktop/src/lib/navigation.ts:43-56` today:

```ts
  {
    to: "/wealth",
    exact: false,
    labelKey: "nav.wealth",
    children: [
      { to: "/wealth/accounts", labelKey: "nav.accounts" },
      { to: "/wealth/assets", labelKey: "nav.whatYouOwn" },
      { to: "/wealth/net-worth", labelKey: "nav.netWorth" },
      {
        to: "/wealth/where-to-put-your-money",
        labelKey: "nav.whereToPutYourMoney",
      },
    ],
  },
```

Append the projects entry as the fifth child. Two accuracy notes:

- The file's own header comment states architecture rule D8 as binding: *"no fifth destination, ever. New capability nests inside an existing destination as a sub-surface."* That is why this feature is a Wealth sub-surface and not a new rail module.
- The architecture calls the 5-sub-surface limit a "compile-time cap". **That is only true of the four destinations** — `FourDestinations` (`navigation.ts:28`) is a 4-tuple, so a fifth destination is a type error. The five-*child* limit is a documented convention (`navigation.ts:24`, *"Max five, per the segmented sub-nav rule"*) enforced by review, not by the type system. Either way: this story consumes the last slot, and a sixth Wealth sub-surface is out of the question without a product decision.

Sub-nav rendering needs no change: `components/shared/DestinationNav.tsx:74-80` maps `active.children` into `SegmentedNav`, so the new entry appears automatically once `navigation.ts` and the route file exist.

### Frontend: list page and row composition

`routes/wealth.accounts.tsx` is the closest structural sibling — read it for the loading/empty/loaded three-state shape (lines 196–222), the `PageHeader` + actions block (169–194), and the twin `SlideOver`s for add/edit (360–382).

`ProjectRow` mirrors the *composition* of `components/budget/BudgetCategoryRow.tsx`:

- name on the left; `<Money cents={...} locale={i18n.language} {...maskProps} />` saved/target pair on the right (`BudgetCategoryRow.tsx:143-156`)
- a `Badge` whose variant carries state as well as colour (`:158-160`)
- `Meter` with `label` and `valueText`, rendered only when `target_cents > 0` (`:175-183`)
- masking via `useMaskProps()` from `@/contexts/ValuesVisibilityContext` and `useValuesHidden()` for the `valueText` fallback (`:57-58`, `:180`)

Write it as a new file under `components/projects/`. The architecture is explicit that `BudgetCategoryRow` is *referenced as a pattern, not imported cross-feature*, to avoid a `projects/ → budget/` dependency. [Source: `architecture-savings-projects.md#Architectural Boundaries`]

Check `@nixus/shared/ui` before creating any primitive — `Card`, `CardContent`, `Badge`, `Meter`, `Money`, `Skeleton`, `EmptyState`, `SlideOver`, `Dialog`, `Button`, `Input`, `Label`, `Select`, `DatePicker`, `Stat`, `SubStat`, `Table*` all already exist and are used by the files cited above. [Source: `docs/project-context.md#8. Shared UI Components`]

### Frontend: hooks and invalidation

Shape to copy, `hooks/useAccounts.ts:11-36`:

```typescript
export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => invoke<Account[]>("get_accounts"),
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAccountInput) =>
      invoke<Account>("create_account", { name: input.name, /* ... */ }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      // ...
    },
  });
}
```

In this story every mutation invalidates exactly `queryKeys.projects`. Later stories **add** keys to these same `onSuccess` blocks — Story 31.3 adds `accountEarmarks(accountId)` and Story 31.4 adds the dashboard summary key. Leave the `onSuccess` bodies easy to extend; do not pre-add keys that do not exist yet (a `queryKeys.x` that does not exist is a TypeScript error, and invalidating an unused key is dead code).

### i18n keys

Add to **both** `apps/desktop/src/locales/en.json` and `fr.json` in the same change. Flat dotted keys.

| Key | EN | FR |
| --- | --- | --- |
| `nav.projects` | `Projects` | `Projets` |
| `projects.subtitle` | `Savings goals you are setting money aside for` | `Objectifs d'épargne pour lesquels vous mettez de l'argent de côté` |
| `projects.addProject` | `Add project` | `Ajouter un projet` |
| `projects.addProjectDescription` | `Name your goal and set the amount you are aiming for.` | `Nommez votre objectif et fixez le montant visé.` |
| `projects.editProject` | `Edit project` | `Modifier le projet` |
| `projects.editProjectDescription` | `Change this goal's name, target amount, or target date.` | `Modifiez le nom, le montant visé ou la date cible de cet objectif.` |
| `projects.emptyTitle` | `No savings projects yet` | `Aucun projet d'épargne` |
| `projects.emptyDescription` | `Create a goal to track money you are setting aside. Nothing is moved between your accounts.` | `Créez un objectif pour suivre l'argent que vous mettez de côté. Rien n'est transféré entre vos comptes.` |
| `projects.namePlaceholder` | `Car down payment` | `Mise de fonds pour une voiture` |
| `projects.nameRequired` | `A project name is required` | `Un nom de projet est requis` |
| `projects.targetAmount` | `Target amount` | `Montant visé` |
| `projects.targetDate` | `Target date (optional)` | `Date cible (facultatif)` |
| `projects.priority` | `Priority (optional)` | `Priorité (facultatif)` |
| `projects.saveProject` | `Save project` | `Enregistrer le projet` |
| `projects.archive` | `Archive` | `Archiver` |
| `projects.archiveTitle` | `Archive this project?` | `Archiver ce projet ?` |
| `projects.archiveDescription` | `It disappears from your active goals. Its history is kept and nothing is deleted.` | `Il disparaîtra de vos objectifs actifs. Son historique est conservé et rien n'est supprimé.` |
| `projects.savedOfTarget` | `{{saved}} of {{target}}` | `{{saved}} sur {{target}}` |
| `projects.meterLabel` | `Progress toward {{name}}` | `Progression vers {{name}}` |
| `projects.remainingBadge` | `{{amount}} to go` | `Il reste {{amount}}` |
| `projects.reachedBadge` | `Target reached` | `Objectif atteint` |
| `projects.noMoneyMovedNote` | `Tracking a goal never moves money. Your account balances stay exactly as you entered them.` | `Le suivi d'un objectif ne déplace jamais d'argent. Les soldes de vos comptes restent exactement tels que vous les avez saisis.` |

Reuse existing keys rather than adding near-duplicates: `common.name`, `common.cancel`, `common.amount`, `common.date`, `toast.saveSuccess`, `toast.saveFailed`, `validation.amountPositive`, `validation.dateRequired` are all already present and already used by the forms cited above.

The parity suite pattern is `locales/__tests__/recurring-i18n.test.ts`: it loads both JSON files as `Record<string, string>`, filters by prefix, asserts symmetric key sets, and additionally pins an explicit `REQUIRED_KEYS` array so a rename in a component fails CI instead of silently rendering a raw key name.

### Testing standards

- **Rust:** inline `#[cfg(test)] mod tests` at the bottom of `db/projects.rs`. In-memory SQLite via `Connection::open_in_memory()`, `PRAGMA foreign_keys=ON;`, hand-written DDL in a `*_test_db()` helper. Canonical examples: `db/budget.rs:379-440` (multi-table helper with seed rows) and `db/account.rs:464-480` (minimal single-table helper). Plain `#[test]` fns, `assert_eq!` on concrete values, `.unwrap()` allowed in tests only.
- **The command layer is not unit-tested in this codebase** — commands take `State<DbState>`, which needs a Tauri app handle. There is no `#[cfg(test)]` block in `commands/account.rs`, `commands/budget.rs`, or `commands/expense.rs`. Test the `db/` functions; keep commands thin enough that there is nothing left to test. Do not introduce a Tauri test harness for this story.
- **Frontend:** Vitest covers locale parity (`src/locales/__tests__/`) and hooks (`src/hooks/__tests__/`, using `createRoot`/`act` directly — there is no `@testing-library/react` in the desktop app). A hook test is optional here; the locale spec is not.
- **Playwright:** the E2E suite runs against the Vite dev server with `window.__TAURI_INTERNALS__.invoke` stubbed per spec — there is no real IPC. Any spec that reaches a surface calling a new command must gain a mock case for it. [Source: `docs/project-context.md#Testing Rules`, incl. line 295]
- **Zero new warnings** from `cargo clippy` and `tsc` before commit (project rule 9).

### Explicitly out of scope for this story

No contribution create/delete command, no saved-total aggregation, no earmark breakdown, no dashboard card, no `projects/allocation.rs`, no suggestion commands, no drag-to-reorder priority UI (Story 32.1), no `get_all_projects`, no changes to `commands/account.rs` (Story 31.5), no icon/colour picker UI, no AI-chat integration, no new Rust crate, no new npm package, no `tauri.conf.json` change, no version bump.

### Project Structure Notes

```
apps/desktop/src-tauri/
├── migrations/025_projects.sql          # NEW — projects + project_contributions + 2 indexes
└── src/
    ├── db/mod.rs                        # MODIFIED — + `pub mod projects;`, + MIGRATIONS entry (25, ...)
    ├── db/projects.rs                   # NEW — project CRUD SQL + #[cfg(test)] tests
    ├── models/mod.rs                    # MODIFIED — + Project, CreateProjectInput,
    │                                    #            UpdateProjectInput, ProjectContribution,
    │                                    #            CreateProjectContributionInput
    ├── commands/mod.rs                  # MODIFIED — + `pub mod projects;`
    ├── commands/projects.rs             # NEW — create/update/archive/get, audit-logged
    └── lib.rs                           # MODIFIED — register 4 commands in generate_handler!

apps/desktop/src/
├── routes/wealth.projects.tsx           # NEW — list surface
├── components/projects/ProjectRow.tsx   # NEW — per-project progress row
├── components/projects/ProjectForm.tsx  # NEW — create + edit (one component)
├── hooks/useProjects.ts                 # NEW — useProjects/Create/Update/Archive
├── lib/constants.ts                     # MODIFIED — + queryKeys.projects, queryKeys.project(id)
├── lib/types.ts                         # MODIFIED — + Project, CreateProjectInput, UpdateProjectInput
├── lib/navigation.ts                    # MODIFIED — + 5th Wealth child { /wealth/projects }
├── locales/en.json, fr.json             # MODIFIED — nav.projects + projects.* keys
└── locales/__tests__/projects-i18n.test.ts  # NEW — parity + REQUIRED_KEYS

apps/desktop/tests/
├── nav-qa.spec.ts                       # MODIFIED — + SURFACES entry, + get_projects mock case
└── projects.spec.ts                     # NEW (preferred) — create/edit/archive flow
```

`routeTree.gen.ts` changes as a **generated artifact** of running dev/build — never hand-edited.

**Deliberately not touched:** `db/account.rs`, `commands/account.rs`, `db/net_worth.rs`, `db/audit.rs` (called, not modified), `db/backup.rs`, `db/danger_zone.rs`, `components/net-worth/NetWorthBreakdownBar.tsx`, `components/budget/BudgetCategoryRow.tsx`, `components/shared/OptionalAccountSelect.tsx`, `routes/index.tsx`, `Cargo.toml`, `package.json`, `tauri.conf.json`, `_bmad-output/implementation-artifacts/sprint-status.yaml`.

**Naming conventions satisfied:** table/column `snake_case` with `_cents` money suffix; Rust module `db/projects.rs`, `commands/projects.rs` (`snake_case`); Rust structs `PascalCase` with `Create*Input`/`Update*Input`; route file `wealth.projects.tsx` (dot-delimited kebab, matching `wealth.net-worth.tsx`); components `PascalCase` under a flat feature folder `components/projects/`; hook `useProjects.ts`; query keys kebab-case string arrays. [Source: `architecture-savings-projects.md#Naming Patterns`; `docs/project-context.md#Naming Conventions`]

**Detected variance, with rationale:** the architecture's file tree also lists `src-tauri/src/projects/allocation.rs`, `components/projects/ProjectContributionForm.tsx`, `SuggestedAllocationPanel.tsx`, `AccountEarmarkBar.tsx`, `components/dashboard/SavingsProjectsCard.tsx`, and `hooks/useProjects.ts` suggestion hooks. Those belong to Stories 31.2–31.4 and Epic 32 and are intentionally absent here; the tree above is the subset this story is accountable for.

### References

- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Story 31.1: Create and manage savings projects` — acceptance criteria, copied faithfully]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Requirements Inventory` — FR1, FR2, NFR2]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Additional Requirements` — migration 025 registered in `db/mod.rs`; `/wealth/projects` consumes the last `navigation.ts` Wealth slot; reuse existing UI primitives; audit log on every mutation; invalidate all affected query keys]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements` — FR1 (create with name/target/date/priority), FR2 (edit or archive; archived hidden from active lists but history retained)]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#9. Non-Functional Requirements` — NFR2 integer cents; NFR1 sub-100ms local CRUD]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Architecture` — verbatim schema, FK rationale, soft-delete precedent, migration approach]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#API & Communication Patterns` — `create_project`, `update_project`, `archive_project`, `get_projects`; `rename_all = "snake_case"`; `Result<Project, AppError>`; no new error variants]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Frontend Architecture` — `wealth.projects.tsx`, query keys in `lib/constants.ts`, component reuse without new primitives]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Implementation Patterns & Consistency Rules` — naming, `commands`/`db` split, audit mandate, ISO 8601 dates]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Architectural Boundaries` — `BudgetCategoryRow` is a pattern reference, not a cross-feature import; `accounts` is a read-only touchpoint]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Decision Impact Analysis` — implementation sequence: migration → models → db → commands → frontend]
- [Source: `docs/project-context.md#1. Monetary Values — Always Integers (Cents)`]
- [Source: `docs/project-context.md#2. Tauri IPC Commands` / `#Tauri IPC` — macro attribute, `Result<T, AppError>`, lock mapping, register in `lib.rs`]
- [Source: `docs/project-context.md#3. Database Operations Belong in db/ Only` — no SQL in commands; audit on every mutation]
- [Source: `docs/project-context.md#4. Rust Model Structs` — derives, `snake_case`, ISO 8601 strings, `Create*Input`/`Update*Input`, single `models/mod.rs`]
- [Source: `docs/project-context.md#6. TanStack Query Keys` — keys only in `lib/constants.ts`; invalidate all affected keys]
- [Source: `docs/project-context.md#8. Shared UI Components`; `#9. Compilation Warnings Policy`; `#Testing Rules` (line 295 mock trap); `#Anti-Patterns to Avoid`]
- [Source: `apps/desktop/src-tauri/src/db/mod.rs:9-30`, `:34-62`, `:79`, `:88-121` — module list, MIGRATIONS array, `PRAGMA foreign_keys=ON`, migration runner]
- [Source: `apps/desktop/src-tauri/migrations/021_expense_income_account_id.sql` — `REFERENCES accounts(id)` + per-FK index precedent]
- [Source: `apps/desktop/src-tauri/migrations/022_budget_category_soft_delete.sql` — nullable-timestamp soft-delete precedent]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:131-186`, `:188-211`, `:238-295`, `:297-315`, `:464-480` — insert/select-back, list, update, get-by-id, and test-db helper patterns]
- [Source: `apps/desktop/src-tauri/src/db/budget.rs:278`, `:379-440` — soft-delete UPDATE guard; multi-table `#[cfg(test)]` helper]
- [Source: `apps/desktop/src-tauri/src/db/income.rs:439+` — tests that assert balances DO move; the contract this story must not copy]
- [Source: `apps/desktop/src-tauri/src/db/audit.rs:5-12` — `insert_audit_log` signature]
- [Source: `apps/desktop/src-tauri/src/commands/account.rs:10-39`, `:111-132`, `:134-153` — command shape; non-fatal audit failure; the in-command SQL helper NOT to copy]
- [Source: `apps/desktop/src-tauri/src/commands/mod.rs:1-23` — `pub mod` list]
- [Source: `apps/desktop/src-tauri/src/lib.rs:171-280` — `generate_handler!` registration list]
- [Source: `apps/desktop/src-tauri/src/error.rs:5-13`, `:101-107` — `AppError` variants and `From<rusqlite::Error>`]
- [Source: `apps/desktop/src-tauri/src/models/mod.rs:143-169`, `:12-20` — `Account`/input derive precedent; `sort_order: i32` precedent]
- [Source: `apps/desktop/src/lib/navigation.ts:14-28`, `:43-56`, `:70` — `SubSurface`/`Destination` types, Wealth children, the D8 no-fifth-destination rule]
- [Source: `apps/desktop/src/components/shared/DestinationNav.tsx:35-80` — sub-surface rendering; landing target is `children[0]`]
- [Source: `apps/desktop/src/lib/constants.ts:1-70` — `queryKeys` flat kebab-case shape]
- [Source: `apps/desktop/src/lib/types.ts:91-100` — `Account` interface shape to mirror]
- [Source: `apps/desktop/src/hooks/useAccounts.ts:11-92` — query/mutation hook + invalidation shape]
- [Source: `apps/desktop/src/routes/wealth.accounts.tsx:47-49`, `:169-222`, `:317-382` — route definition, three-state rendering, twin SlideOvers]
- [Source: `apps/desktop/src/components/budget/BudgetCategoryRow.tsx:45-190` — meter/badge/money row composition to mirror]
- [Source: `apps/desktop/src/components/accounts/AddAccountForm.tsx:43-101`, `:205-219` — react-hook-form `mode: "onBlur"`, `noValidate`, submit/cancel footer]
- [Source: `apps/desktop/src/components/accounts/AccountRow.tsx:196-210` — destructive-confirm Dialog pattern]
- [Source: `apps/desktop/src/components/shared/MoneyInput.tsx:5-64` — dollars-in / integer-cents-out]
- [Source: `apps/desktop/src/components/income/AddIncomeEntryForm.tsx:124-175` — `Controller` + `MoneyInput` + `DatePicker` with validation rules]
- [Source: `apps/desktop/src/locales/__tests__/recurring-i18n.test.ts:1-40` — locale parity + `REQUIRED_KEYS` pattern]
- [Source: `apps/desktop/tests/nav-qa.spec.ts:101-119` — `SURFACES` list and console-error gate]
- [Source: `apps/desktop/tests/accounts.spec.ts:3-40` — self-contained Tauri invoke mock pattern]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo build` — clean, zero warnings.
- `cargo test` — 459 passed, 0 failed (10 of them new in `db/projects.rs`).
- `cargo clippy --all-targets` — 1 warning total, the pre-existing `explicit_auto_deref` at
  `commands/backup.rs:106`. Zero new warnings introduced.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` — clean, 0 errors under `noUnusedLocals` /
  `noUnusedParameters`.
- `pnpm --filter @nixus/desktop test` — 12 files, 205 tests passed, including the new
  `projects-i18n.test.ts` (5 tests).
- `pnpm --filter @nixus/desktop exec playwright test` — 417 passed, 0 failed.
- `routeTree.gen.ts` regenerated by `vite build` (the `build` script runs `tsc` first, which cannot
  pass until the route tree exists, so `vite build` was invoked directly to generate it, then `tsc`
  was re-run clean).

### Completion Notes List

- Migration `025_projects.sql` transcribed verbatim (comments included) and registered as entry
  `(25, ...)` in `MIGRATIONS`. `PRAGMA foreign_keys=ON` already set in `open_configured`; no second
  PRAGMA added. Both FK semantics are proven by a test that asserts `ON DELETE CASCADE` on
  `project_id` and `ON DELETE RESTRICT` on `account_id`.
- Zero `f64` anywhere in the story's Rust; all money is `i64` with a `_cents` suffix. Nothing writes
  to `accounts.balance_cents` — the only occurrences in the diff are in the test that asserts it does
  **not** move across insert/update/archive (AC #8).
- **Deviation 1 — `db/danger_zone.rs` was modified**, though the story listed it as "deliberately not
  touched". Its `wipe_list_covers_every_table_in_the_schema` test asserts `WIPE_TABLES +
  PRESERVED_TABLES` covers every table in the live schema, so adding two tables in migration 025
  fails `cargo test` until they are classified. `project_contributions` and `projects` are
  user-generated data, so they belong in `WIPE_TABLES`, inserted child-first (contributions before
  both `projects` and `accounts`) to stay correct under `PRAGMA foreign_keys=ON`. Its sibling
  `wipe_all_empties_every_user_data_table` test also required one seed row per new table.
- **Deviation 2 — three existing Playwright specs updated for the fifth Wealth child.** Adding
  `/wealth/projects` to `navigation.ts` changes the segmented sub-nav's link count, which three specs
  pin: `nav-qa.spec.ts` (4 → 5), `navigation.spec.ts` (`subNavs` Wealth `items` gained `Projects`),
  and `net-worth.spec.ts` (`toHaveText` list gained `Projects`, test name "four" → "five"). The story
  anticipated the landing target staying `/wealth/accounts` — it does — but not these count
  assertions. `nav-qa.spec.ts` also gained the `["wealth-projects", "/wealth/projects"]` SURFACES
  entry and the `case "get_projects": return Promise.resolve([]);` mock, as specified.
- **Deviation 3 — one extra i18n key, `projects.rowActions`** (`Actions for {{name}}` /
  `Actions pour {{name}}`). The row's overflow-menu trigger needs an accessible label; the
  `AccountRow` precedent uses `accounts.rowActions` for exactly this. Added to both locales and to
  the spec's `REQUIRED_KEYS`. No other key deviates from the Dev Notes table.
- **Deviation 4 — `#[allow(clippy::too_many_arguments)]` on `update_project`.** The story's mandated
  signature takes 8 parameters (clippy's threshold is 7). The parameter list is the IPC contract —
  Tauri deserializes each `invoke` argument by name — so grouping them into a struct would change the
  shape the frontend must send. Suppressed at the one call site with a WHY comment, per project
  rule 9 (no unexplained warnings, no unexplained suppressions).
- **Deviation 5 — `cargo fmt` could not be run**: `rustfmt` is not installed for the active
  toolchain (`rustup component add rustfmt` required). Formatting was written to match the
  surrounding files by hand; `cargo clippy` is clean regardless.
- `ProjectContribution` / `CreateProjectContributionInput` carry `#[allow(dead_code)]` with a WHY
  comment naming Story 31.2, per Task 2's standalone-compile option. Story 31.2 removes the attribute.
- `ProjectRow` receives `savedCents` as a prop and the page passes the named constant
  `SAVED_CENTS_UNTIL_STORY_31_2 = 0`, with a WHY comment: no contribution command ships until
  Story 31.2, so `$0 saved` is the only factually correct figure here.
- Icon and colour are pass-through only: the form forwards the existing values (`null` on create) and
  ships no picker, as instructed.
- Every mutation hook invalidates exactly `queryKeys.projects`. No net-worth, financial-health or
  snapshot key is invalidated, and `record_net_worth_snapshot` is never called — this feature moves
  no money.
- `commands/projects.rs` contains no SQL; the audit `old_value` for update/archive comes from
  `projects_db::get_project_by_id`, not a local helper. `get_projects` performs zero writes and no
  audit log. All three mutations audit-log with `entity_type = "project"` and swallow audit failures
  after `tracing::error!`.
- New `tests/projects.spec.ts` covers empty state → create → appears with `$0 of target` → validation
  rejections → edit → archive confirm → disappears. The edit case must `click()` the money field
  before `fill()`: `MoneyInput`'s focus handler rewrites `displayValue` in the same event batch, so a
  single `fill` on a pre-populated money input silently keeps the old amount. This is a pre-existing
  `MoneyInput` quirk, not introduced here, and is documented inline in the spec.
- No new Rust crate, no new npm package, no `tauri.conf.json` change, no version bump.

### File List

**Created**

- `apps/desktop/src-tauri/migrations/025_projects.sql`
- `apps/desktop/src-tauri/src/db/projects.rs`
- `apps/desktop/src-tauri/src/commands/projects.rs`
- `apps/desktop/src/hooks/useProjects.ts`
- `apps/desktop/src/routes/wealth.projects.tsx`
- `apps/desktop/src/components/projects/ProjectRow.tsx`
- `apps/desktop/src/components/projects/ProjectForm.tsx`
- `apps/desktop/src/locales/__tests__/projects-i18n.test.ts`
- `apps/desktop/tests/projects.spec.ts`

**Modified**

- `apps/desktop/src-tauri/src/db/mod.rs`
- `apps/desktop/src-tauri/src/db/danger_zone.rs`
- `apps/desktop/src-tauri/src/models/mod.rs`
- `apps/desktop/src-tauri/src/commands/mod.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/lib/types.ts`
- `apps/desktop/src/lib/constants.ts`
- `apps/desktop/src/lib/navigation.ts`
- `apps/desktop/src/locales/en.json`
- `apps/desktop/src/locales/fr.json`
- `apps/desktop/src/routeTree.gen.ts` (generated artifact of `vite build`)
- `apps/desktop/tests/nav-qa.spec.ts`
- `apps/desktop/tests/navigation.spec.ts`
- `apps/desktop/tests/net-worth.spec.ts`
- `_bmad-output/implementation-artifacts/31-1-create-and-manage-savings-projects.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

