# Story 2.1: Create Budget with Category Groups and Targets

Status: review

## Story

As a user,
I want to create a monthly budget with named category groups and individual categories with spending targets,
So that I can plan my monthly spending.

## Acceptance Criteria

**Given** the user navigates to the Budget page
**When** the user creates a new budget category group (e.g., "Essentials")
**Then** the group is saved to the database with a `budget_groups` table created via migration
**And** the user can add categories to the group (e.g., "Housing", "Food") with monthly targets in dollars
**And** categories are stored in a `budget_categories` table with `group_id`, `name`, and `target_cents` (integer) columns
**And** monetary inputs use the MoneyInput pattern (UX-DR18): monospace font, currency prefix, auto-format with commas on blur
**And** the form uses React Hook Form with validation (name required, target > 0)
**And** a success toast confirms each save (UX-DR16)

**Given** a budget with categories exists
**When** the user views the Budget page
**Then** categories are displayed grouped under their group headings
**And** each category shows the target amount formatted as `$X,XXX.XX` (monospace, UX-DR25)

## Tasks / Subtasks

### [x] Task 1: Database Migration — Budget Tables
Create migration file for `budget_groups` and `budget_categories` tables.

**AC reference:** "group is saved to the database with a `budget_groups` table" + "categories are stored in a `budget_categories` table"

- Create `src-tauri/migrations/002_budget_tables.sql` (number may vary based on existing migrations)
- `budget_groups` table: `id` INTEGER PRIMARY KEY, `name` TEXT NOT NULL, `sort_order` INTEGER NOT NULL DEFAULT 0, `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
- `budget_categories` table: `id` INTEGER PRIMARY KEY, `group_id` INTEGER NOT NULL REFERENCES budget_groups(id), `name` TEXT NOT NULL, `target_cents` INTEGER NOT NULL, `sort_order` INTEGER NOT NULL DEFAULT 0, `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
- Add index: `idx_budget_categories_group_id` on `budget_categories(group_id)`
- Verify: Migration applies on app startup without errors

### [x] Task 2: Rust Models
Define shared structs for budget groups and categories.

**AC reference:** All — these models are the data contract between layers.

- Add to `src-tauri/src/models/mod.rs`:
  - `BudgetGroup { id: i64, name: String, sort_order: i32, created_at: String }`
  - `BudgetCategory { id: i64, group_id: i64, name: String, target_cents: i64, sort_order: i32, created_at: String }`
  - `CreateBudgetGroup { name: String }`
  - `CreateBudgetCategory { group_id: i64, name: String, target_cents: i64 }`
- All structs derive `Serialize`, `Deserialize`, `Debug`, `Clone`

### [x] Task 3: Rust DB Queries
Implement database query functions for budget CRUD.

**AC reference:** "group is saved to the database" + "categories are stored"

- Create/update `src-tauri/src/db/budget.rs`:
  - `create_budget_group(conn: &Connection, input: &CreateBudgetGroup) -> Result<BudgetGroup, AppError>`
  - `get_budget_groups(conn: &Connection) -> Result<Vec<BudgetGroup>, AppError>`
  - `create_budget_category(conn: &Connection, input: &CreateBudgetCategory) -> Result<BudgetCategory, AppError>`
  - `get_budget_categories_by_group(conn: &Connection, group_id: i64) -> Result<Vec<BudgetCategory>, AppError>`
  - `get_all_budget_categories(conn: &Connection) -> Result<Vec<BudgetCategory>, AppError>`
- Validation in db layer: name must not be empty, target_cents must be > 0
- All functions return `Result<T, AppError>` — no `unwrap()` or `expect()`

### [x] Task 4: Tauri Commands
Expose budget operations as Tauri commands.

**AC reference:** Frontend needs to invoke these for create/read operations.

- Create/update `src-tauri/src/commands/budget.rs`:
  - `#[tauri::command] fn create_budget_group(state, name: String) -> Result<BudgetGroup, AppError>`
  - `#[tauri::command] fn get_budget_groups(state) -> Result<Vec<BudgetGroup>, AppError>`
  - `#[tauri::command] fn create_budget_category(state, group_id: i64, name: String, target_cents: i64) -> Result<BudgetCategory, AppError>`
  - `#[tauri::command] fn get_budget_categories(state, group_id: i64) -> Result<Vec<BudgetCategory>, AppError>`
- Register commands in `src-tauri/src/main.rs`
- Commands call db functions — no SQL in command handlers

### [x] Task 5: TypeScript Types
Define frontend types mirroring Rust models.

**AC reference:** Data exchange uses snake_case JSON fields.

- Add to `src/lib/types.ts`:
  - `BudgetGroup { id: number, name: string, sort_order: number, created_at: string }`
  - `BudgetCategory { id: number, group_id: number, name: string, target_cents: number, sort_order: number, created_at: string }`
- Add query keys to `src/lib/constants.ts`: `["budget-groups"]`, `["budget-categories", groupId]`

### [x] Task 6: TanStack Query Hooks
Wrap Tauri commands in TanStack Query hooks.

**AC reference:** Frontend state managed via TanStack Query.

- Create/update `src/hooks/useBudget.ts`:
  - `useBudgetGroups()` — query hook for `get_budget_groups`
  - `useCreateBudgetGroup()` — mutation hook, invalidates `["budget-groups"]` on success
  - `useBudgetCategories(groupId)` — query hook for `get_budget_categories`
  - `useCreateBudgetCategory()` — mutation hook, invalidates `["budget-categories", groupId]` on success
- Use the shared `invoke` helper from `src/hooks/useInvoke.ts`

### [x] Task 7: MoneyInput Component
Build the shared monetary input component.

**AC reference:** "monetary inputs use the MoneyInput pattern (UX-DR18): monospace font, currency prefix, auto-format with commas on blur"

- Create `src/components/shared/MoneyInput.tsx`:
  - Currency prefix (`$`) displayed inside the input
  - Monospace font (JetBrains Mono)
  - Accepts user input as dollars (e.g., "700"), stores/returns value as integer cents
  - Auto-format with commas on blur (e.g., "1,234.56")
  - Compatible with React Hook Form via `Controller` or `register`
- If MoneyInput already exists from a prior story, verify it meets these requirements

### [x] Task 8: Budget Page UI — Group Creation Form
Build the form to create budget groups.

**AC reference:** "user creates a new budget category group" + "form uses React Hook Form with validation"

- Update `src/routes/budget.tsx`:
  - Page header: "Budget" (H1) with "Add Group" action button (UX-DR23)
  - "Add Group" opens a form (inline or dialog) with a single field: group name
  - React Hook Form validation: name required
  - On submit: call `useCreateBudgetGroup` mutation
  - Success toast on save (UX-DR16)

### [x] Task 9: Budget Page UI — Category Creation Form
Build the form to add categories within a group.

**AC reference:** "user can add categories to the group with monthly targets in dollars" + "form uses React Hook Form with validation (name required, target > 0)"

- Add to budget page or `src/components/budget/BudgetGroupCard.tsx`:
  - Each group card has an "Add Category" button
  - Form fields: category name (Input), target amount (MoneyInput)
  - React Hook Form validation: name required, target > 0
  - On submit: call `useCreateBudgetCategory` mutation with target converted to cents
  - Success toast on save

### [x] Task 10: Budget Page UI — Display Groups and Categories
Render the budget structure.

**AC reference:** "categories are displayed grouped under their group headings" + "each category shows the target amount formatted as `$X,XXX.XX`"

- `src/components/budget/BudgetGroupCard.tsx`:
  - Card component per group (shadcn Card)
  - Group name as H2 heading
  - List of categories within the group
  - Each category row shows: name + target formatted as `$X,XXX.XX` (monospace, right-aligned)
  - Use `formatCurrency()` from `src/lib/formatCurrency.ts` to format cents to display string

### [x] Task 11: Playwright E2E Tests
Write tests verifying all acceptance criteria.

**AC reference:** All criteria.

- Add to `tests/budget.spec.ts`:
  - Test: User can create a budget group and see it appear on the page
  - Test: User can add a category with a dollar target to a group
  - Test: Category displays with the formatted target amount in monospace
  - Test: Form validation prevents saving without a name or with target <= 0
  - Test: Success toast appears after saving
- Verify: `npx playwright test tests/budget.spec.ts` passes

## Dev Notes

### Architecture Guidance

This is the first budget feature and establishes patterns for all subsequent budget stories (2.2, 2.3, 2.4). The patterns set here — Rust command/db separation, TanStack Query hooks, React Hook Form usage, MoneyInput — will be reused.

**Database:**
- Monetary values stored as integer cents (`target_cents`). Never use floating point.
- `sort_order` column enables future drag-to-reorder. Default to insertion order for now.
- Foreign key: `budget_categories.group_id` references `budget_groups.id`.

**Rust Backend:**
- Commands in `src-tauri/src/commands/budget.rs` — one file for all budget commands.
- Queries in `src-tauri/src/db/budget.rs` — one file for all budget SQL.
- Commands call db functions. No SQL in commands.
- All commands return `Result<T, AppError>`. Use `?` operator, never `unwrap()`.
- Database connection accessed via Tauri managed state.

**Frontend:**
- TanStack Query wraps all IPC calls. Mutations invalidate related query keys.
- React Hook Form for the create group/category forms. Validation on blur, not keystroke.
- `formatCurrency(cents: number): string` converts integer cents to `$X,XXX.XX`.
- JSON fields are `snake_case` — TypeScript types match Rust serde output directly.
- Toast notifications via shadcn Toast component (bottom-right, auto-dismiss 4s).

**IPC Pattern:**
- Frontend calls `invoke("create_budget_group", { name })` via TanStack Query mutation.
- Rust returns the created object on success, structured error on failure.
- Error format: `{ error: { type: "validation", message: "...", field?: "..." } }`

### Scope Boundaries

**In scope:**
- `budget_groups` and `budget_categories` database tables (migration)
- Rust models, db queries, and Tauri commands for creating and reading groups/categories
- Budget page with group/category creation forms and display
- MoneyInput shared component
- TanStack Query hooks for budget data
- Playwright E2E tests

**Out of scope (handled by later stories):**
- Editing or deleting groups/categories (Story 2.2)
- Progress bars and spent amounts (Story 2.3)
- Month navigation (Story 2.4)
- Expenses table and linking expenses to categories (Epic 3)
- Inline editing of target amounts (Story 2.2)

### Project Structure Notes

**Files to create:**
- `src-tauri/migrations/002_budget_tables.sql` (migration number may vary)
- `src-tauri/src/db/budget.rs`
- `src-tauri/src/commands/budget.rs`
- `src/components/budget/BudgetGroupCard.tsx`
- `src/components/shared/MoneyInput.tsx` (if not already created)
- `src/hooks/useBudget.ts`

**Files to modify:**
- `src-tauri/src/models/mod.rs` — add BudgetGroup, BudgetCategory structs
- `src-tauri/src/db/mod.rs` — register budget module
- `src-tauri/src/commands/mod.rs` — register budget module
- `src-tauri/src/main.rs` — register budget Tauri commands
- `src/lib/types.ts` — add TypeScript types
- `src/lib/constants.ts` — add query keys
- `src/routes/budget.tsx` — build budget page
- `tests/budget.spec.ts` — add E2E tests

### References

- Epic 2 stories: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/epics.md` (lines 290-323)
- Architecture — data layer, IPC patterns, naming: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/architecture.md`
- UX — MoneyInput (UX-DR18), toast (UX-DR16), page header (UX-DR23), financial display (UX-DR25): `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/ux-design-specification.md`
- BudgetCategoryRow component spec: UX spec lines 703-719

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Rust compiles with `cargo check` (2 pre-existing warnings only)
- All 15 Playwright tests pass (6 new budget tests + 9 existing)
- TypeScript compiles clean with `tsc --noEmit`

### Completion Notes List
- Sonner toast component modified to remove next-themes dependency (not applicable in Tauri app), hardcoded to light theme
- Tauri IPC mocked in Playwright tests via `window.__TAURI_INTERNALS__` since tests run against Vite dev server, not Tauri runtime
- `get_all_budget_categories` DB function included per story spec but not exposed as a command (generates unused warning)
- Tauri 2.x invoke args use snake_case matching Rust parameter names

### File List
- `src-tauri/migrations/002_budget_tables.sql` (new)
- `src-tauri/src/models/mod.rs` (new)
- `src-tauri/src/db/budget.rs` (new)
- `src-tauri/src/db/mod.rs` (modified - added budget module, migration 2)
- `src-tauri/src/commands/budget.rs` (new)
- `src-tauri/src/commands/mod.rs` (modified - added budget module)
- `src-tauri/src/lib.rs` (modified - added models module, registered budget commands)
- `src/lib/types.ts` (new)
- `src/lib/constants.ts` (new)
- `src/lib/formatCurrency.ts` (new)
- `src/hooks/useBudget.ts` (new)
- `src/components/shared/MoneyInput.tsx` (new)
- `src/components/budget/BudgetGroupCard.tsx` (new)
- `src/components/ui/card.tsx` (new - shadcn)
- `src/components/ui/input.tsx` (new - shadcn)
- `src/components/ui/label.tsx` (new - shadcn)
- `src/components/ui/sonner.tsx` (new - shadcn, modified)
- `src/routes/budget.tsx` (modified)
- `src/main.tsx` (modified - added Toaster)
- `tests/budget.spec.ts` (new)
