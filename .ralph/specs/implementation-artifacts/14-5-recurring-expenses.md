# Story 14.5: Recurring Expenses

Status: review

## Story

As a user,
I want to define recurring expense templates and apply them to a month with one click,
so that I stop re-entering the same expenses (rent, subscriptions, gym) manually every month.

## Acceptance Criteria

1. User can create a recurring expense template with: merchant, amount, budget category, day of month.
2. User can view, edit, toggle active/inactive, and delete templates.
3. An "Apply Recurring" button on the Budget page creates expenses for all active templates for the selected month — skipping any that already exist for that month.
4. Applied expenses appear in the expense list with `source = 'recurring'` and the correct date (capped to last day of month for months shorter than the template's day).
5. Deleting a template does NOT delete already-applied expenses.
6. A management interface (dedicated route or modal) exists to create and manage templates.
7. No regression on existing expense CRUD.

## Tasks / Subtasks

- [x] Migration 016 (AC: #3, #4)
  - [x] Create `apps/desktop/src-tauri/migrations/016_recurring_expenses.sql`
  - [x] Register in `apps/desktop/src-tauri/src/db/mod.rs` MIGRATIONS array as entry 16

- [x] Rust models (AC: #1, #2)
  - [x] Add `RecurringExpenseTemplate`, `CreateRecurringExpenseTemplateInput`, `UpdateRecurringExpenseTemplateInput` structs to `apps/desktop/src-tauri/src/models/mod.rs`

- [x] DB layer: `db/recurring.rs` (AC: #1–#5)
  - [x] Create `apps/desktop/src-tauri/src/db/recurring.rs`
  - [x] Implement: `insert_template`, `get_all_templates`, `update_template`, `delete_template`, `apply_recurring_for_month`
  - [x] Register module in `apps/desktop/src-tauri/src/db/mod.rs`

- [x] Commands: `commands/recurring.rs` (AC: #1–#5)
  - [x] Create `apps/desktop/src-tauri/src/commands/recurring.rs`
  - [x] Implement 5 Tauri commands: `create_recurring_template`, `get_recurring_templates`, `update_recurring_template`, `delete_recurring_template`, `apply_recurring_expenses`
  - [x] Register all 5 commands in `apps/desktop/src-tauri/src/lib.rs` invoke_handler

- [x] Frontend types and hooks (AC: #1–#3)
  - [x] Add `RecurringExpenseTemplate`, `CreateRecurringExpenseTemplateInput`, `UpdateRecurringExpenseTemplateInput` interfaces to `apps/desktop/src/lib/types.ts`
  - [x] Add `recurringTemplates` to `queryKeys` in `apps/desktop/src/lib/constants.ts`
  - [x] Create `apps/desktop/src/hooks/useRecurringExpenses.ts` with 5 hooks

- [x] UI components (AC: #1, #2, #6)
  - [x] Create `apps/desktop/src/components/expenses/AddRecurringTemplateForm.tsx`
  - [x] Create `apps/desktop/src/components/expenses/RecurringTemplateList.tsx`
  - [x] Create `apps/desktop/src/routes/recurring-expenses.tsx` (management page)

- [x] Budget page integration (AC: #3)
  - [x] Add "Apply Recurring" button to `apps/desktop/src/routes/budget.tsx`
  - [x] Show toast on success: "Applied N recurring expenses" (or "All recurring already applied")

- [x] Navigation (AC: #6)
  - [x] Add `recurring-expenses` to nav in `apps/desktop/src/components/shared/InnerTabNav.tsx`

- [x] i18n keys
  - [x] Add all new UI strings to locale files in `apps/desktop/src/locales/`

## Dev Notes

### Architecture choice: Template table (not flag on expenses)

Mirrors the **income module pattern** (`income_sources` + `income_entries`). This gives:
- Clean separation: templates are configuration, applied expenses are data
- Explicit user control over when expenses are created
- Easy to modify a template without affecting past applied expenses

Do NOT use an `is_recurring` flag on the `expenses` table — that pollutes the expense data model.

### Migration 016 schema

`apps/desktop/src-tauri/migrations/016_recurring_expenses.sql`:
```sql
CREATE TABLE recurring_expense_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
    day_of_month INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_recurring_templates_active ON recurring_expense_templates(is_active);
```

Register in `apps/desktop/src-tauri/src/db/mod.rs`:
```rust
(16, include_str!("../../migrations/016_recurring_expenses.sql")),
```

**Important:** If story 14-4 (migration 015) is not yet merged when this story is implemented, use migration number 015 here instead. Always check the last migration file in `migrations/` and use the next sequential number.

### Rust model structs (add to `models/mod.rs`)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurringExpenseTemplate {
    pub id: i64,
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub day_of_month: i32,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRecurringExpenseTemplateInput {
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub day_of_month: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRecurringExpenseTemplateInput {
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub day_of_month: i32,
    pub is_active: bool,
}
```

All follow existing patterns: `Serialize + Deserialize + Debug + Clone`, all fields snake_case, amounts as `i64` with `_cents` suffix.

### `db/recurring.rs` — key function: `apply_recurring_for_month`

```rust
pub fn apply_recurring_for_month(
    conn: &Connection,
    year: i32,
    month: u32,
) -> Result<Vec<Expense>, AppError> {
    let templates = get_active_templates(conn)?;
    let mut created = Vec::new();

    for template in templates {
        let actual_day = clamp_day_to_month(year, month, template.day_of_month);
        let date = format!("{:04}-{:02}-{:02}", year, month, actual_day);

        // Idempotency check: skip if this recurring expense already exists for this month
        let already_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM expenses
             WHERE merchant = ?1 AND date = ?2 AND amount_cents = ?3 AND source = 'recurring'",
            params![template.merchant, date, template.amount_cents],
            |row| row.get::<_, i64>(0),
        ).map(|count| count > 0)?;

        if already_exists {
            continue;
        }

        let input = CreateExpenseInput {
            merchant: template.merchant.clone(),
            amount_cents: template.amount_cents,
            budget_category_id: template.budget_category_id,
            date: date.clone(),
        };
        let expense = expense_db::insert_expense_with_source(conn, &input, "recurring")?;
        created.push(expense);
    }

    Ok(created)
}

fn clamp_day_to_month(year: i32, month: u32, day: i32) -> i32 {
    let last_day = last_day_of_month(year, month);
    std::cmp::min(day, last_day as i32)
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if is_leap_year(year) { 29 } else { 28 },
        _ => 30,
    }
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}
```

**Note:** You may need to add `insert_expense_with_source(conn, input, source: &str)` to `db/expense.rs`, or check if the existing insert already supports a source parameter. Look at how `bulk_insert_imported_expenses` sets `source = 'import'` and follow the same pattern.

### Commands in `commands/recurring.rs`

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn create_recurring_template(
    state: State<DbState>,
    merchant: String,
    amount_cents: i64,
    budget_category_id: i64,
    day_of_month: i32,
) -> Result<RecurringExpenseTemplate, AppError>

#[tauri::command(rename_all = "snake_case")]
pub fn get_recurring_templates(
    state: State<DbState>,
) -> Result<Vec<RecurringExpenseTemplate>, AppError>

#[tauri::command(rename_all = "snake_case")]
pub fn update_recurring_template(
    state: State<DbState>,
    id: i64,
    merchant: String,
    amount_cents: i64,
    budget_category_id: i64,
    day_of_month: i32,
    is_active: bool,
) -> Result<RecurringExpenseTemplate, AppError>

#[tauri::command(rename_all = "snake_case")]
pub fn delete_recurring_template(
    state: State<DbState>,
    id: i64,
) -> Result<(), AppError>

#[tauri::command(rename_all = "snake_case")]
pub fn apply_recurring_expenses(
    state: State<DbState>,
    year: i32,
    month: u32,
) -> Result<Vec<Expense>, AppError>
```

Register all 5 in `src/lib.rs` `invoke_handler!` macro. Follow how expense and income commands are registered.

### `queryKeys` addition (`lib/constants.ts`)

```typescript
recurringTemplates: ["recurring-templates"] as const,
```

### `useRecurringExpenses.ts` hook structure

```typescript
export function useRecurringTemplates() {
  return useQuery({
    queryKey: queryKeys.recurringTemplates,
    queryFn: () => invoke<RecurringExpenseTemplate[]>("get_recurring_templates"),
  });
}

export function useCreateRecurringTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecurringExpenseTemplateInput) =>
      invoke<RecurringExpenseTemplate>("create_recurring_template", {
        merchant: input.merchant,
        amount_cents: input.amount_cents,
        budget_category_id: input.budget_category_id,
        day_of_month: input.day_of_month,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recurringTemplates });
    },
  });
}

export function useApplyRecurringExpenses() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) =>
      invoke<Expense[]>("apply_recurring_expenses", { year, month }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
      queryClient.invalidateQueries({ queryKey: ["budget-status"] });
    },
  });
}
// + useUpdateRecurringTemplate, useDeleteRecurringTemplate following same patterns
```

### "Apply Recurring" button on Budget page

In `apps/desktop/src/routes/budget.tsx`, add near the `BudgetSummaryStrip` or month navigator area:

```tsx
const applyRecurring = useApplyRecurringExpenses();

<Button
  variant="outline"
  size="sm"
  onClick={() => applyRecurring.mutate({ year: selectedYear, month: selectedMonth })}
  disabled={applyRecurring.isPending}
>
  Apply Recurring
</Button>
```

On `onSuccess` in the mutation, call `toast.success(...)`:
- If `createdExpenses.length > 0`: `"Applied ${length} recurring expenses"`
- If `createdExpenses.length === 0`: `"All recurring expenses already applied for this month"`

### Recurring Expenses management route (`recurring-expenses.tsx`)

- List all templates via `useRecurringTemplates`
- Each row shows: merchant, formatted amount, category name, day of month, active toggle
- "Add Template" button opens `AddRecurringTemplateForm` (modal or slide-over)
- Edit/delete actions per row
- Empty state when no templates yet
- Add to sidebar navigation (check how other nav items are defined in the nav config or `__root.tsx`)

### AddRecurringTemplateForm

Fields:
- Merchant (text input)
- Amount (currency input — use same pattern as `AddExpenseForm`, store in cents)
- Budget category (Select from `@nkbaz/shared/ui`)
- Day of month (number input, 1–28 safe range; or allow 1–31 with a note about month-end capping)

Follow `AddExpenseForm` structure exactly for consistency.

### Audit logging

Recurring template CRUD should write to the audit log (same as expenses). In `commands/recurring.rs`:
```rust
let details = serde_json::to_string(&template).unwrap_or_default();
if let Err(e) = audit_db::insert_audit_log(&conn, "recurring_template", template.id, "create", None, Some(&details)) {
    tracing::error!("Failed to write audit log: {}", e);
}
```

Applied expenses get individual audit log entries via the existing `insert_expense_with_source` flow (if that function calls the audit log). Verify and add if missing.

### Project Structure Notes

- Mirrors income module architecture exactly: `income_sources` + `income_entries` → `recurring_expense_templates` + `expenses`
- The `apply_recurring_for_month` function is idempotent — calling it twice on the same month is safe
- `source = 'recurring'` on applied expenses distinguishes them from manual entries in the expense list (can add a visual badge later)
- Day-of-month capping to last day of month is mandatory — never use a day that doesn't exist in the target month
- Check migration numbering in `migrations/` dir before writing the new file — if 015 is already taken, use 016

### References

- Income module to mirror: `apps/desktop/src-tauri/src/db/income.rs`, `apps/desktop/src-tauri/src/commands/income.rs`
- Expense DB functions: `apps/desktop/src-tauri/src/db/expense.rs`
- Migration dir: `apps/desktop/src-tauri/migrations/`
- Model structs: `apps/desktop/src-tauri/src/models/mod.rs`
- Command registration: `apps/desktop/src-tauri/src/lib.rs`
- Hook pattern: `apps/desktop/src/hooks/useIncome.ts`
- Form pattern: `apps/desktop/src/components/expenses/AddExpenseForm.tsx` (if it exists) or `apps/desktop/src/components/budget/`
- Budget route (Apply button): `apps/desktop/src/routes/budget.tsx`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None.

### Completion Notes List

- Added `insert_expense_with_source` to `db/expense.rs` to support setting the `source` field when inserting expenses (used by the recurring apply function)
- `EditRecurringTemplateForm.tsx` created as a separate component for editing existing templates (used from within `RecurringTemplateList.tsx`)
- `routeTree.gen.ts` manually updated to include the `/recurring-expenses` route (TanStack Router would normally auto-generate this)
- Navigation added to `InnerTabNav.tsx` in the budget/income group
- All 5 Rust commands registered in `lib.rs` invoke_handler
- Both `cargo build` and `tsc --noEmit` pass with zero errors/warnings

### File List

- `apps/desktop/src-tauri/migrations/016_recurring_expenses.sql` (new)
- `apps/desktop/src-tauri/src/db/mod.rs` (modified)
- `apps/desktop/src-tauri/src/db/expense.rs` (modified — added `insert_expense_with_source`)
- `apps/desktop/src-tauri/src/db/recurring.rs` (new)
- `apps/desktop/src-tauri/src/commands/mod.rs` (modified)
- `apps/desktop/src-tauri/src/commands/recurring.rs` (new)
- `apps/desktop/src-tauri/src/models/mod.rs` (modified)
- `apps/desktop/src-tauri/src/lib.rs` (modified)
- `apps/desktop/src/lib/types.ts` (modified)
- `apps/desktop/src/lib/constants.ts` (modified)
- `apps/desktop/src/hooks/useRecurringExpenses.ts` (new)
- `apps/desktop/src/components/expenses/AddRecurringTemplateForm.tsx` (new)
- `apps/desktop/src/components/expenses/EditRecurringTemplateForm.tsx` (new)
- `apps/desktop/src/components/expenses/RecurringTemplateList.tsx` (new)
- `apps/desktop/src/routes/recurring-expenses.tsx` (new)
- `apps/desktop/src/routeTree.gen.ts` (modified)
- `apps/desktop/src/components/shared/InnerTabNav.tsx` (modified)
- `apps/desktop/src/routes/budget.tsx` (modified)
- `apps/desktop/src/locales/en.json` (modified)
- `apps/desktop/src/locales/fr.json` (modified)
