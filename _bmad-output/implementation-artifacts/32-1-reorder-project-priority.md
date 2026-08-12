# Story 32.1: Reorder project priority

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user with multiple active goals,
I want to rank my projects by priority,
so that the app knows which goal matters most to me when suggesting how to split my savings.

**Scope:** One new write command (`reorder_projects`), one behavioural change to Epic 31's project insert (default priority = end of order), and reorder controls on the existing `/wealth/projects` list. **No allocation math in this story** — Story 32.2 owns `projects/allocation.rs` and is the only place `priority` is consumed for weighting.

## Acceptance Criteria

1. **Given** two or more active projects
   **When** I reorder them (drag, or the keyboard-accessible move-up / move-down controls) on the Projects list
   **Then** each project's `priority` value is persisted and the new order is reflected immediately

2. **Given** a freshly created project with no explicit priority set
   **When** it is created
   **Then** it defaults to the lowest priority — appended to the end of the active order, never inserted at position 0

3. **Given** a reorder is submitted
   **When** the command runs
   **Then** all affected `projects.priority` values are rewritten in a single SQLite transaction, so a failure leaves the previous order fully intact (no partial reorder)

4. **Given** a reorder is submitted with an id list that is not exactly the set of active project ids (a missing id, an unknown id, a duplicate, an archived id, or an empty list)
   **When** the command runs
   **Then** it returns `AppError::Validation` and writes nothing

5. **Given** a reorder succeeds
   **When** the audit log is inspected
   **Then** one entry exists per project whose `priority` value actually changed, with `entity_type = "project"`, `action = "update"`, and old/new JSON — and no entry exists for projects whose priority was unchanged

6. **Given** a reorder succeeds
   **When** the mutation's `onSuccess` runs
   **Then** both the projects list query and the suggested-allocation query are invalidated, because priority order changes the default suggested split (FR9)

7. **Given** I use only the keyboard
   **When** I move a project up or down
   **Then** the controls are reachable and operable without a pointer, each with a translated accessible label, and the reordered row keeps focus

8. **Given** the reorder UI
   **When** the implementation is inspected
   **Then** no new npm package was added — drag support uses native HTML5 drag events and the keyboard path uses the existing `Button` + lucide icons

## Tasks / Subtasks

- [x] **Task 1 — `db/projects.rs`: default new projects to the end of the order** (AC: #2)
  - [x] Write the failing test first: insert three projects with no explicit priority, assert their persisted priorities are `0, 1, 2` in insertion order
  - [x] In `apps/desktop/src-tauri/src/db/projects.rs` (created by Story 31.1), change the project insert so that when the caller supplies no explicit priority the value is resolved as `SELECT COALESCE(MAX(priority), -1) + 1 FROM projects WHERE archived_at IS NULL` before the `INSERT`, mirroring `db/budget.rs:18-19` verbatim in shape. Story 31.1 ships `priority = input.priority.unwrap_or(0)` and explicitly defers this behaviour here, calling it "Story 32.1's acceptance criterion" [Source: `_bmad-output/implementation-artifacts/31-1-create-and-manage-savings-projects.md` Task 3] — so replacing that `unwrap_or(0)` is exactly the intended change, and Story 31.1's test asserting `priority == 0` for the *first* project still holds (`COALESCE(MAX, -1) + 1 == 0` on an empty table)
  - [x] Keep an explicitly-supplied priority honoured as-is (FR1 allows the user to set priority at create time) — only the *absent* case changes
  - [x] Add a test asserting an archived project's priority does not inflate the next assigned priority (the `MAX` is scoped to `archived_at IS NULL`)
  - [x] Do **not** touch `migrations/025_projects.sql` — the column keeps `priority INTEGER NOT NULL DEFAULT 0`; the insert always supplies a value so the SQL default is never exercised

- [x] **Task 2 — `db/projects.rs::reorder_projects` (transactional rewrite)** (AC: #1, #3, #4, #5)
  - [x] Write failing tests first (in-memory SQLite, schema copied from `migrations/025_projects.sql`): happy-path reorder, missing id, unknown id, duplicate id, archived id, empty list, single project (no-op)
  - [x] Add `pub fn reorder_projects(conn: &Connection, project_ids: &[i64]) -> Result<Vec<ProjectPriorityChange>, AppError>`
  - [x] Validate **before** opening the transaction: load `SELECT id FROM projects WHERE archived_at IS NULL`; reject with `AppError::Validation { message, field: Some("project_ids") }` unless `project_ids` is a permutation of that set — same length, no duplicates, no unknown ids, non-empty. Mirror the pre-validation-loop-then-transaction ordering of `db/expense.rs:228-268`
  - [x] Open `conn.unchecked_transaction()?` (the established pattern — `db/expense.rs:255`, `db/budget.rs:272`), then for each `(index, id)` run `UPDATE projects SET priority = ?1, updated_at = datetime('now') WHERE id = ?2 AND archived_at IS NULL`, then `tx.commit()?`
  - [x] Return only the projects whose priority value actually changed, as `ProjectPriorityChange { old_json: String, new_json: String, project_id: i64 }`, so the command can write exactly one audit row per real change (AC #5). Capture the pre-update row JSON inside the same read pass used for validation
  - [x] Priorities are normalised to a dense `0..n-1` range on every reorder — never sparse, never negative. Add a test asserting this after reordering a set whose stored priorities were `0, 5, 9`

- [x] **Task 3 — `commands/projects.rs::reorder_projects` command** (AC: #1, #5)
  - [x] Add to `apps/desktop/src-tauri/src/commands/projects.rs` (created by Story 31.1):
        `#[tauri::command(rename_all = "snake_case")] pub fn reorder_projects(state: State<DbState>, project_ids: Vec<i64>) -> Result<Vec<Project>, AppError>`
  - [x] Body is thin orchestration only — lock state → call `projects_db::reorder_projects` → loop the returned changes writing `audit_db::insert_audit_log(&conn, "project", project_id, "update", Some(&old_json), Some(&new_json))` → return the reordered list via Epic 31's existing `projects_db::get_active_projects(&conn)` (Story 31.1's db function; the *command* Epic 31 exposes is named `get_projects`). No SQL in the command (project rule 3)
  - [x] Log audit-write failures with `tracing::error!` instead of propagating them, matching `commands/maintenance.rs:111-120` and `commands/income.rs:130-139`
  - [x] Register `commands::projects::reorder_projects` in the `tauri::generate_handler![...]` list in `lib.rs` (the flat `commands::{module}::{fn}` list ending at `commands::profile::get_tfsa_accumulated_limit`)

- [x] **Task 4 — Frontend data layer** (AC: #1, #6)
  - [x] Add `useReorderProjects()` to `apps/desktop/src/hooks/useProjects.ts` (created by Story 31.1), shaped exactly like `useSetEmergencyFundTarget` in `src/hooks/useFinancialHealth.ts`: `useMutation({ mutationFn: (project_ids: number[]) => invoke<Project[]>("reorder_projects", { project_ids }), onSuccess: ... })`
  - [x] `onSuccess` invalidates `queryKeys.projects` **and** `queryKeys.suggestedAllocation` (AC #6). If `queryKeys.suggestedAllocation` does not exist yet because Story 32.2 has not landed, add it to `apps/desktop/src/lib/constants.ts` as `suggestedAllocation: ["suggested-allocation"] as const` — 32.2 must then reuse it rather than defining a second key
  - [x] **Deliberately do not invalidate** `queryKeys.savingsProjectsSummary` (Story 31.4), `queryKeys.projectSavedTotals` (Story 31.2), `queryKeys.accountEarmarks(id)` (Story 31.3), or any `financialHealth*` key: a reorder changes no saved total, no target, no active-project count, and no income/expense figure. Invalidating them would imply a data dependency that does not exist
  - [x] Never hardcode the key strings in the hook (project rule 6)
  - [x] Add a hook test in `apps/desktop/src/hooks/__tests__/useProjects.test.tsx` following the `createRoot`/`act` + module-level `invoke` mock pattern of `src/hooks/__tests__/useBudgetTemplates.test.tsx`: assert `invokeMock.mock.calls[0]` equals `["reorder_projects", { project_ids: [3, 1, 2] }]` (exact snake_case wire contract) and that `invalidateQueries` was called for both keys

- [x] **Task 5 — Reorder controls on the projects list** (AC: #1, #7, #8)
  - [x] Add `onMoveUp` / `onMoveDown` / `canMoveUp` / `canMoveDown` optional props to `apps/desktop/src/components/projects/ProjectRow.tsx` (created by Story 31.1) rendering two `Button variant="ghost" size="icon-sm"` controls with `ArrowUp` / `ArrowDown` from `lucide-react` and translated `aria-label`s. Follow the icon-button shape already used for the delete control in `src/components/budget/BudgetCategoryRow.tsx:161-172`
  - [x] Disable (not hide) the up control on the first row and the down control on the last row, so the control column does not shift between rows
  - [x] In `apps/desktop/src/routes/wealth.projects.tsx` (created by Story 31.1), hold the displayed order in local state seeded from the query data, apply a move optimistically, then call `reorderProjects.mutate(orderedIds)`; on error revert to the server order and surface `toast.error(...)` (`sonner` is already a dependency; `src/components/shared/InlineEdit.tsx` is the in-repo toast precedent)
  - [x] Re-seed the local order from query data whenever the query data changes and no reorder is in flight, mirroring the draft-resync `useEffect` in `src/components/shared/InlineEdit.tsx:128-132`
  - [x] Add native HTML5 pointer drag as an enhancement on the same code path: `draggable`, `onDragStart` (store the source index), `onDragOver` with `preventDefault()`, `onDrop` (compute the target index, apply the same move + same `mutate` call). Precedent for native drag handlers in this repo: `src/components/import/UploadZone.tsx:289-290`
  - [x] **Do not add a drag-and-drop library.** `dnd-kit`, `react-beautiful-dnd`, and `sortablejs` are all absent from `apps/desktop/package.json` and from `pnpm-lock.yaml`, and the architecture states this feature introduces no new dependencies (AC #8)
  - [x] Ensure the moved row retains focus after a keyboard move so repeated presses keep working

- [x] **Task 6 — i18n** (AC: #7)
  - [x] Add the reorder keys from Dev Notes → "i18n keys" to **both** `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json` in the same change. Locale files are flat dotted-key JSON — extend Story 31.1's `projects.*` namespace, do not create a new one
  - [x] Add the new keys to `REQUIRED_KEYS` in `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` (created by Story 31.1; if absent, create it from the `src/locales/__tests__/profile-i18n.test.ts` template: `REQUIRED_KEYS` array + `it.each` EN/FR parity + a final "declares every `projects.` key it ships" set-equality test)

- [x] **Task 7 — Playwright coverage** (AC: #1, #7)
  - [x] In `apps/desktop/tests/projects.spec.ts` (Story 31.1 lists this spec as optional and Story 31.2 extends it — **create it from the `apps/desktop/tests/accounts.spec.ts:3-40` self-contained-mock template if it does not exist yet**), add a `reorder_projects` case to the spec's `window.__TAURI_INTERNALS__.invoke` switch mock that mutates the in-memory project array's order and returns it — otherwise the call falls through to `Promise.reject("Unknown command: ...")` (see `docs/project-context.md:295`)
  - [x] Test: click move-down on the first project → the rows render in the new order
  - [x] Test: the move controls are keyboard-focusable and operable via `keyboard.press("Enter")`
  - [x] `reorder_projects` is only ever invoked by a user gesture, never on page load, so `apps/desktop/tests/nav-qa.spec.ts` (whose console-error gate requires a mock case for every command a surface invokes on load) needs **no** new case from this story. No other spec is affected either — the projects list is a route, not an always-mounted shell component

- [x] **Task 8 — Verification** (AC: all)
  - [x] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passes; `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` introduces zero new warnings (project rule 9)
  - [x] `pnpm --filter @nixus/desktop test` passes, including locale parity
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` clean under `noUnusedLocals` / `noUnusedParameters`
  - [x] Confirm no new migration, no `MIGRATIONS` array change, no new npm package, no new Rust crate, and no write to `accounts.balance_cents`

## Dev Notes

### What this story is, in one sentence

One transactional reorder command plus the list controls that call it. **No allocation math, no contribution writes, no schema change.**

### Recommended approach: a dedicated `reorder_projects` command — and why, explicitly

The architecture maps FR9 to "`commands/projects.rs::update_project` (priority field), drag-reorder UI in `wealth.projects.tsx`" [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Requirements to Structure Mapping`]. **Implement a dedicated `reorder_projects` command instead.** This is a deliberate, documented refinement of that mapping, not a deviation from any decision the architecture marked critical (the FR9 row is a mapping line, not a Decision). Rationale:

1. **Atomicity.** A reorder is inherently an N-row rewrite. Driving it through `update_project` means N separate `invoke()` round-trips with no shared transaction; a failure at row 3 of 5 leaves the user with a half-applied order — and because priority directly drives the suggested split (FR9 → Story 32.2), a corrupted order silently produces a wrong money suggestion. AC #3 exists precisely to forbid that.
2. **Set integrity.** Only a whole-list command can validate that the submitted ids are a permutation of the active set (AC #4) and normalise priorities to a dense `0..n-1`. Per-row updates cannot detect duplicates or gaps, so `priority` values would drift sparse over time and the "dense rank" input assumption Story 32.2 relies on would have to be re-derived defensively on every read.
3. **Audit noise and cache churn.** N `update_project` calls produce N full-object update audit rows and N cache invalidation rounds for what the user experienced as one action. One command produces one invalidation and exactly one audit row per *actually changed* project.
4. **`update_project` keeps its priority field regardless.** Story 31.1's `UpdateProjectInput` already carries `priority` (FR1 makes priority user-settable at create/edit time). This story does not remove or repurpose it, and does not route reordering through it. Nothing in Epic 31 is redefined.

Rejected alternative for the audit shape: a single batch audit row with `entity_id = 0` and a JSON id-list summary, as `commands/import.rs:432-433` does for `confirm_import`. Rejected because a project reorder has meaningful per-entity ids to attribute, unlike an import batch, and per-project rows keep `audit_log.entity_id` queryable. AC #5 pins the per-changed-project shape.

### The reorder contract, stated precisely

```
reorder_projects(project_ids: [id₀, id₁, …, idₙ₋₁])

precondition:  { project_ids } == { id : projects.archived_at IS NULL }  as a set,
               with |project_ids| == n and no duplicates
effect:        projects[idᵏ].priority = k   for k in 0..n-1   (single transaction)
postcondition: active priorities are exactly {0, 1, …, n-1}, dense and unique
```

`priority` semantics are fixed by the schema comment: **lower value = higher priority** [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Architecture` — `priority INTEGER NOT NULL DEFAULT 0, -- lower = higher priority, user-orderable`]. Index 0 in the submitted list is therefore the *most* important project. Do not invert this; Story 32.2's weighting depends on it.

### Precedent to mirror: `db/budget.rs` ordering

`db/budget.rs` is the only existing ordering precedent in the repo and it is an exact structural match for Task 1:

```rust
let sort_order: i32 = conn.query_row(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM budget_groups",
    [],
    |row| row.get(0),
)?;
```

and for categories it scopes the `MAX` to live rows: `... FROM budget_categories WHERE group_id = ?1 AND deleted_at IS NULL` (`db/budget.rs:83-84`). Projects use the same soft-delete idea with a different column name — scope to `archived_at IS NULL`.

Note the naming difference deliberately: budget uses `sort_order`, projects use `priority` (the architecture's chosen column name). **Do not rename or add a `sort_order` column to `projects`.**

### There is no drag-reorder precedent in this codebase — read this before designing the UI

A full grep of `apps/desktop/src` for `reorder`, `draggable`, `onDrag`, `moveUp`, `ArrowUp`, and `sort_order` found **no existing list-reorder UI anywhere**. The hits are all unrelated: `sort_order` is a read-only data field (`src/lib/types.ts:4,13`, `src/routes/import.tsx:52`), `onDragOver`/`onDragLeave` in `src/components/import/UploadZone.tsx:289-290` are file-drop handlers, and `ArrowUp` in `src/components/dashboard/DashboardMetricCard.tsx:3,29` is a trend icon. `ExpenseList.tsx:354` mentions reordering only in a comment.

So this story writes the first reorder UI in the app. Two consequences:

- **Keyboard controls are the mandatory path; drag is the enhancement.** Native HTML5 drag-and-drop is not keyboard-operable and is not announced to screen readers, and the epic wording is "(e.g. drag to reorder)" — drag is illustrative, not required. Ship move-up/move-down buttons as the primary, testable, accessible mechanism (AC #7) and layer native drag on the exact same `mutate` call. This also keeps the Playwright test straightforward, since HTML5 drag simulation is unreliable in Playwright.
- **No library.** Adding `dnd-kit` would contradict "no new dependencies needed for this feature (no new crates, no new npm packages)" [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Technical Constraints & Dependencies`]. AC #8 pins this.

### Command shape to mirror

`commands/financial_health.rs` is the reference for the lock-and-delegate shape:

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn get_financial_health_summary(state: State<DbState>) -> Result<FinancialHealthSummary, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?;
    ...
}
```

`commands/maintenance.rs::update_vehicle` (lines 90-123) is the reference for the mutation shape — capture old JSON, call the db function, serialise the new value, write the audit row, log audit failures with `tracing::error!` rather than failing the user's action. Reuse both shapes literally.

### Frontend hook shape to mirror

`src/hooks/useFinancialHealth.ts` in full is the model — a `useMutation` wrapping one `invoke` with an `onSuccess` invalidation block:

```typescript
export function useSetEmergencyFundTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (months: number) => invoke<void>("set_emergency_fund_target", { months }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financialHealth });
    },
  });
}
```

`queryKeys` in `src/lib/constants.ts` is one flat object of kebab-case string arrays (`financialHealth: ["financial-health"] as const`, …). Epic 31 adds `projects`, `project(id)`, `accountEarmarks(id)`; this story ensures `suggestedAllocation` exists and is invalidated here.

**Why `suggestedAllocation` must be invalidated on reorder (AC #6):** FR9's own test criterion is "Suggested split for the same surplus amount changes when priority order changes" [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements`]. A cached suggestion computed under the old order would visibly contradict the new order. This is the cross-story wire between 32.1 and 32.2, and the invalidation is the only thing that makes it true at runtime. Do **not** invalidate `financialHealth*` keys — reordering changes no income, expense, or account figure.

### i18n keys

Flat dotted keys, added to `src/locales/en.json` **and** `src/locales/fr.json` in the same change, inside Story 31.1's `projects.*` namespace.

| Key | EN | FR |
| --- | --- | --- |
| `projects.moveUp` | `Move {{name}} up in priority` | `Déplacer {{name}} vers le haut dans les priorités` |
| `projects.moveDown` | `Move {{name}} down in priority` | `Déplacer {{name}} vers le bas dans les priorités` |
| `projects.reorderHint` | `Highest priority first. Reorder to change how a suggested split is weighted.` | `Priorité la plus élevée en premier. Réorganisez pour modifier la pondération d'une répartition suggérée.` |
| `projects.reorderFailed` | `Could not save the new order. Your previous order was kept.` | `Impossible d'enregistrer le nouvel ordre. Votre ordre précédent a été conservé.` |

The move labels take the project name via `{{name}}` interpolation because an unnamed "Move up" is ambiguous in a list of identical controls. `projects-i18n.test.ts` enforces EN/FR parity and, in the profile-test template, also guards that interpolation placeholders survive translation — keep `{{name}}` present in both locales.

### Dependencies on Epic 31 — the exact names to build against

This story extends, and never redefines, the following Epic 31 artefacts:

| Artefact | Owner | Exact name |
| --- | --- | --- |
| Tables | 31.1 | `projects`, `project_contributions` (migration `025_projects.sql`) |
| Rust models | 31.1 | `Project`, `CreateProjectInput`, `UpdateProjectInput` (`priority: Option<i32>` already present on both inputs) |
| db functions | 31.1 | `insert_project`, `get_active_projects`, `update_project`, `archive_project` |
| Commands | 31.1 | `create_project`, `get_projects`, `update_project`, `archive_project` |
| Hooks | 31.1 | `useProjects`, `useCreateProject`, `useUpdateProject`, `useArchiveProject` |
| Route / components | 31.1 | `routes/wealth.projects.tsx`, `components/projects/ProjectRow.tsx`, `ProjectForm.tsx` |
| Query keys | 31.1-31.4 | `projects`, `project(id)`, `projectSavedTotals`, `projectContributions(id)`, `accountEarmarks(id)`, `savingsProjectsSummary` |
| i18n | 31.1 | flat `projects.*` namespace + `src/locales/__tests__/projects-i18n.test.ts` |

`priority` is `i32` in Rust (matching the `BudgetCategory.sort_order: i32` precedent), and money stays `i64` — do not widen or narrow either.

### Explicitly out of scope

No `projects/allocation.rs` (Story 32.2), no `SuggestedAllocationPanel.tsx` (Story 32.3), no `confirm_project_allocations` (Story 32.4), no contribution writes of any kind, no new migration, no `MIGRATIONS` change, no change to `accounts` or `accounts.balance_cents`, no new npm package, no new Rust crate, no dashboard card change, no archive/unarchive behaviour change, and no reordering of *archived* projects (they are excluded from active lists and from allocation suggestions per FR2).

### Project Structure Notes

```
apps/desktop/src-tauri/src/
├── db/projects.rs              # MODIFIED (created 31.1): + reorder_projects();
│                               #   insert defaults priority to COALESCE(MAX(priority),-1)+1
├── commands/projects.rs        # MODIFIED (created 31.1): + reorder_projects command
└── lib.rs                      # MODIFIED: register commands::projects::reorder_projects

apps/desktop/src/
├── routes/wealth.projects.tsx  # MODIFIED (created 31.1): local order state, move handlers,
│                               #   native HTML5 drag handlers, reorder mutate call
├── components/projects/ProjectRow.tsx  # MODIFIED (created 31.1): move-up/move-down controls
├── hooks/useProjects.ts        # MODIFIED (created 31.1): + useReorderProjects()
├── lib/constants.ts            # MODIFIED: ensure queryKeys.suggestedAllocation exists
├── locales/en.json, fr.json    # MODIFIED: 4 new projects.* keys, both files
└── hooks/__tests__/useProjects.test.tsx  # NEW or MODIFIED: reorder wire-contract test

apps/desktop/src/locales/__tests__/projects-i18n.test.ts  # MODIFIED (or NEW): + REQUIRED_KEYS
apps/desktop/tests/projects.spec.ts                       # MODIFIED (created 31.1): mock + 2 tests
```

**Nothing new is created on the Rust side** — this story only extends Epic 31's `db/projects.rs` and `commands/projects.rs`. `migrations/`, `db/mod.rs`'s `MIGRATIONS`, `models/mod.rs`, `db/account.rs`, `db/audit.rs`, `Cargo.toml`, `package.json`, and `tauri.conf.json` are all untouched.

**Variance from the architecture, with rationale:** the architecture's FR9 mapping names `update_project` as the persistence path; this story adds `reorder_projects` instead, for the atomicity/set-integrity/audit reasons argued above. `update_project` retains its `priority` field and is not modified. The `ProjectPriorityChange` helper struct is a db-layer internal (like `FinancialHealthFiguresInternal` in `db/financial_health.rs:21-33`) and therefore lives in `db/projects.rs`, **not** in `models/mod.rs` — it never crosses the IPC boundary and needs no serde derives.

### References

- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Story 32.1: Reorder project priority` — acceptance criteria]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Epic 32: Smart Allocation Suggestions` — epic scope; builds on Epic 31]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements` — FR9 and its test criterion: the suggested split must change when priority order changes]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#4. User Journeys` — "Projects list → drag to reorder priority"]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Architecture` — `projects.priority INTEGER NOT NULL DEFAULT 0`, lower = higher priority; `archived_at` soft delete]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Requirements to Structure Mapping` — FR9 → priority field + drag-reorder UI in `wealth.projects.tsx`]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Technical Constraints & Dependencies` — no new crates, no new npm packages]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Process Patterns` — audit logging mandatory on `update_project`; invalidate ALL affected query keys]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Structure Patterns` — `commands/projects.rs` orchestration only, `db/projects.rs` owns all SQL]
- [Source: `docs/project-context.md#2. Tauri IPC Commands` — `rename_all = "snake_case"`, `Result<T, AppError>`, `State<DbState>` lock idiom, register in `lib.rs`]
- [Source: `docs/project-context.md#3. Database Operations Belong in db/ Only` — lock → db call → audit log → return]
- [Source: `docs/project-context.md#6. TanStack Query Keys` — keys only in `lib/constants.ts`; invalidate all affected keys]
- [Source: `docs/project-context.md#Testing Rules` — Vitest hook tests via `createRoot`/`act`; Playwright mock-switch trap at line 295]
- [Source: `docs/project-context.md#Anti-Patterns to Avoid` — no SQL in commands, no hardcoded query keys, no skipped audit log]
- [Source: `apps/desktop/src-tauri/src/db/budget.rs:18-26`, `:83-91` — `COALESCE(MAX(sort_order), -1) + 1` insert-ordering precedent, scoped to live rows]
- [Source: `apps/desktop/src-tauri/src/db/budget.rs:272-281` — `conn.unchecked_transaction()` + multi-statement commit pattern]
- [Source: `apps/desktop/src-tauri/src/db/expense.rs:228-272` — validate-everything-before-opening-the-transaction ordering, with `AppError::Validation { field }`]
- [Source: `apps/desktop/src-tauri/src/db/audit.rs:5-18` — `insert_audit_log(conn, entity_type, entity_id, action, old_value, new_value)`]
- [Source: `apps/desktop/src-tauri/src/commands/maintenance.rs:90-123` — update-command shape: old JSON → db call → new JSON → audit, `tracing::error!` on audit failure]
- [Source: `apps/desktop/src-tauri/src/commands/financial_health.rs:8-21` — thin command + `State<DbState>` lock idiom]
- [Source: `apps/desktop/src-tauri/src/commands/import.rs:431-433` — batch audit row with `entity_id = 0` (the rejected alternative)]
- [Source: `apps/desktop/src-tauri/src/lib.rs` — `mod` declarations and the flat `tauri::generate_handler![...]` registration list]
- [Source: `apps/desktop/src/hooks/useFinancialHealth.ts` — query/mutation hook shape to mirror]
- [Source: `apps/desktop/src/lib/constants.ts:1-70` — flat kebab-case `queryKeys` object]
- [Source: `apps/desktop/src/components/budget/BudgetCategoryRow.tsx:161-172` — ghost icon-button with translated `aria-label` inside a list row]
- [Source: `apps/desktop/src/components/shared/InlineEdit.tsx:128-132` — draft-state resync `useEffect`; `toast` usage precedent]
- [Source: `apps/desktop/src/components/import/UploadZone.tsx:289-290` — native HTML5 drag handlers, the only in-repo drag precedent]
- [Source: `apps/desktop/src/lib/navigation.ts:43-56` — Wealth destination children; `/wealth/projects` is Epic 31's addition]
- [Source: `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` — `createRoot`/`act` harness, module-level `invoke` mock, exact `invoke.mock.calls[0]` tuple assertions, `invalidateQueries` spy]
- [Source: `apps/desktop/tests/accounts.spec.ts:3-158` — `page.addInitScript` `__TAURI_INTERNALS__.invoke` switch mock with `default: Promise.reject("Unknown command")`]
- [Source: `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` — `REQUIRED_KEYS` + parity + orphan-key test template]
- [Source: `apps/desktop/package.json` — no `dnd-kit` / `react-beautiful-dnd` / `sortablejs`; `sonner`, `lucide-react` already present]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo test` (apps/desktop/src-tauri): **508 passed, 0 failed** (was 494 before this story; +14 new tests — 3 in Task 1, 11 in Task 2).
- `cargo clippy --all-targets`: 1 warning, `commands/backup.rs:106` `explicit_auto_deref` — **pre-existing**, in a file this story does not touch. Zero new warnings.
- `pnpm --filter @nixus/desktop exec tsc --noEmit`: clean under `noUnusedLocals` / `noUnusedParameters`.
- `pnpm --filter @nixus/desktop test` (vitest): **13 files, 213 passed** (was 210; +3 new `useReorderProjects` tests). Locale parity included.
- `pnpm --filter @nixus/desktop exec playwright test projects.spec.ts`: **13 passed** (was 10; +3 reorder tests).
- Full Playwright suite: 4 failures on run 1 and 1 *different* failure on run 2, all in `expenses.spec.ts` / `maintenance.spec.ts` (delete-dialog and inline-odometer timing). Both specs pass **61/61 in isolation on this tree**, and the failing set is non-deterministic across runs — pre-existing full-suite flake in surfaces this story never touches. `projects.spec.ts` passed in both full runs.

### Completion Notes List

**Task 1 — insert defaults to end of order.** `insert_project` now resolves an absent `priority` via `SELECT COALESCE(MAX(priority), -1) + 1 FROM projects WHERE archived_at IS NULL`, mirroring `db/budget.rs:18-19`. An explicitly-supplied priority is still honoured verbatim. Story 31.1's `insert_project_persists_target_and_defaults` test (asserting `priority == 0` for the first project) still passes unchanged, because `COALESCE(MAX, -1) + 1 == 0` on an empty table. `migrations/025_projects.sql` untouched.

**Task 2 — `reorder_projects` in `db/projects.rs`.** Signature is `pub fn reorder_projects(conn: &Connection, project_ids: &[i64]) -> Result<Vec<ProjectPriorityChange>, AppError>`. All validation (non-empty, exact length match against the active set, no duplicates via `HashSet`, no unknown/archived ids) completes **before** `conn.unchecked_transaction()` opens, mirroring `db/expense.rs:228-268`. Priorities are rewritten to a dense `0..n-1`; a test proves normalisation from stored `0, 5, 9`. `ProjectPriorityChange` is a db-layer internal in `db/projects.rs` (no serde derives, `#[derive(Debug)]` only, needed for `unwrap_err()` in tests) — `models/mod.rs` untouched as the Dev Notes require.

*Implementation refinement:* the validation pass builds an `ordered: Vec<(&Project, i32)>` of pre-update rows paired with their target priority, so the transaction loop needs no second lookup and cannot hit an unreachable "not found" branch. `new_json` is read back from inside the transaction via `get_project_by_id(&tx, id)` rather than being synthesised from the old row, so the audited `updated_at` is the value actually persisted. A test also asserts archived rows' priorities are left untouched by a reorder.

**Task 3 — command.** `commands::projects::reorder_projects` is thin orchestration: lock → `projects_db::reorder_projects` → one `audit_db::insert_audit_log(conn, "project", id, "update", old, new)` per *changed* project → `projects_db::get_active_projects(&conn)`. Audit failures are logged with `tracing::error!` and never propagated. Registered in `lib.rs` immediately after `commands::projects::update_project`.

**Task 4 — data layer.** `useReorderProjects()` added to `hooks/useProjects.ts`, shaped after `useSetEmergencyFundTarget`. `queryKeys.suggestedAllocation: ["suggested-allocation"] as const` added to `lib/constants.ts` (Story 32.2 must reuse it). `onSuccess` invalidates `queryKeys.projects` and `queryKeys.suggestedAllocation` only. Three tests in `hooks/__tests__/useProjects.test.tsx`: the exact wire tuple `["reorder_projects", { project_ids: [3, 1, 2] }]`, both invalidations, and a negative test proving `projectSavedTotals` / `savingsProjectsSummary` / `financialHealth` are **not** invalidated.

**Task 5 — reorder controls.** `ProjectRow.tsx` gained optional `onMoveUp` / `onMoveDown` / `canMoveUp` / `canMoveDown`; the two `ArrowUp` / `ArrowDown` `Button variant="ghost" size="icon-sm"` controls render only when both handlers are supplied, and are **disabled** (not hidden) at the list edges so the control column never shifts. Focus retention is handled in the row: the pressed direction is recorded in a ref and a post-render effect refocuses that control, falling back to the opposite control when the pressed one became disabled — without this, focus falls to `<body>` after moving a row to the first/last slot and repeated presses stop working.

**Task 6 — i18n.** Four `projects.*` keys added to both `en.json` and `fr.json`, with `{{name}}` preserved in both locales. `projects-i18n.test.ts` gained all four in `REQUIRED_KEYS` and `moveUp` / `moveDown` in the placeholder-parity list.

**Task 7 — Playwright.** `projects.spec.ts` mock gained a `reorder_projects` case that validates the permutation, rewrites `priority` by index, and returns the sorted active list. Three tests: pointer move-down reorders the rows; the move controls are keyboard-focusable, operable via `Enter`, disabled at the edges, and the moved row keeps focus; and a rejected reorder reverts to the server order while showing the failure toast. `nav-qa.spec.ts` needed no new case — `reorder_projects` is only ever fired by a user gesture.

**Deviations and decisions**

1. **`reorder_projects` command instead of N `update_project` calls** — followed the story's recommendation exactly; no deviation. Rationale unchanged from Dev Notes (atomicity, set integrity, one audit row per real change).
2. **Native drag handlers live on a wrapper `<div>` in the route, not inside `ProjectRow`.** The story lists the drag handlers under Task 5 without pinning which element owns them. Putting `draggable` / `onDragStart` / `onDragOver` / `onDrop` on the route's per-row wrapper keeps the index-aware drag bookkeeping in the same place as the order state and keeps `ProjectRow` free of index props it does not otherwise need. Drag and keyboard converge on the identical `commitOrder` → `mutate` path.
3. **The reorder state machine was extracted to `hooks/useProjectReorder.ts`.** Inlining it left `routes/wealth.projects.tsx` at 251 pure LOC, over the project's 250-line ceiling. The extracted hook owns exactly one thing — the displayed order and its persistence — and the route drops to 191 pure LOC. No behaviour change; this file is additive to the story's Project Structure Notes.
4. **`db/projects.rs` is ~1348 pure LOC (≈400 production, ≈950 `#[cfg(test)]`).** It exceeds the ceiling, but the story explicitly scopes this change to "extends Epic 31's `db/projects.rs`" with nothing new on the Rust side, so splitting the module is deliberately out of scope for 32.1.
5. **No new dependency of any kind** (AC #8): no npm package, no Rust crate, no migration, no `MIGRATIONS` change, no write to `accounts.balance_cents` (proved by `reorder_projects_never_moves_account_balances`).

### File List

**Modified — Rust**
- `apps/desktop/src-tauri/src/db/projects.rs` — `insert_project` end-of-order default; `reorder_projects` + `ProjectPriorityChange` + `invalid_project_ids`; 14 new tests
- `apps/desktop/src-tauri/src/commands/projects.rs` — `reorder_projects` command
- `apps/desktop/src-tauri/src/lib.rs` — registered `commands::projects::reorder_projects`

**Modified — Frontend**
- `apps/desktop/src/hooks/useProjects.ts` — `useReorderProjects()`
- `apps/desktop/src/lib/constants.ts` — `queryKeys.suggestedAllocation`
- `apps/desktop/src/components/projects/ProjectRow.tsx` — move-up / move-down controls + focus retention
- `apps/desktop/src/routes/wealth.projects.tsx` — reorder hint, drag wrappers, move handlers wired to the hook
- `apps/desktop/src/locales/en.json` — 4 `projects.*` reorder keys
- `apps/desktop/src/locales/fr.json` — 4 `projects.*` reorder keys

**New — Frontend**
- `apps/desktop/src/hooks/useProjectReorder.ts` — displayed-order state, optimistic move, revert-on-error, drag bookkeeping

**Modified — Tests**
- `apps/desktop/src/hooks/__tests__/useProjects.test.tsx` — 3 `useReorderProjects` tests
- `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` — 4 keys in `REQUIRED_KEYS`, 2 in placeholder parity
- `apps/desktop/tests/projects.spec.ts` — `reorder_projects` mock case + 3 tests

**Modified — Process**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `32-1-reorder-project-priority: review`

