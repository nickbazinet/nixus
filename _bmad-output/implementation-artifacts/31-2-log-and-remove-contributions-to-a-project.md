# Story 31.2: Log and remove contributions to a project

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user,
I want to log money I've set aside toward a project from a specific account,
so that I can track my progress without physically moving money.

## Acceptance Criteria

1. **Given** an existing active project
   **When** I log a contribution specifying a source account, amount, and date
   **Then** the contribution is saved, the project's "saved" total increases by that amount, and the source account's `balance_cents` is unchanged

2. **Given** a project with one or more logged contributions
   **When** I view the project
   **Then** I see saved amount, remaining amount, and percent complete, computed from the sum of its contributions

3. **Given** a logged contribution
   **When** I delete it
   **Then** the project's saved total decreases by that amount and the source account's `balance_cents` remains unchanged

4. **Given** any contribution create or delete succeeds
   **When** the audit log is inspected
   **Then** an entry exists with `entity_type = "project_contribution"` for that action

5. **Given** I try to log a contribution with a non-positive amount, a missing account, or a missing/archived project
   **When** I submit
   **Then** the command returns `AppError::Validation` with the offending `field` set, and no row is written

6. **Given** the diff for this story
   **When** it is inspected for writes to the `accounts` table
   **Then** there are none — no `UPDATE accounts`, no call to `account_db::adjust_account_balance`, `reverse_adjustment`, or `update_account_balance` from any code path added here

## Tasks / Subtasks

- [x] **Task 1 — Saved-total aggregation model** (AC: #1, #2, #3)
  - [x] In `apps/desktop/src-tauri/src/models/mod.rs`, add:
    ```rust
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ProjectSavedTotal {
        pub project_id: i64,
        pub saved_cents: i64,
    }
    ```
  - [x] If Story 31.1 added `#[allow(dead_code)]` to `ProjectContribution` / `CreateProjectContributionInput` to keep the build warning-free, **remove it now** — this story consumes both (project rule 9: the attribute is only permitted while the code is genuinely about to be used).
  - [x] Do not add a `ProjectProgress` struct. Remaining and percent-complete are derived in the UI from `saved_cents` and `target_cents`, exactly as `BudgetCategoryRow` derives `remainingCents` and pacing in TypeScript (`components/budget/BudgetCategoryRow.tsx:29-34`, `:62`).
- [x] **Task 2 — `db/projects.rs`: contribution writes (TDD each)** (AC: #1, #3, #5, #6)
  - [x] `pub fn insert_project_contribution(conn: &Connection, input: &CreateProjectContributionInput) -> Result<ProjectContribution, AppError>`
    - [x] Validate `amount_cents > 0` → else `AppError::Validation { field: Some("amount_cents") }`.
    - [x] Validate `date` is non-empty after trim → else `field: Some("date")`.
    - [x] Validate `source` is `"manual"` or `"suggested"` against a `const VALID_CONTRIBUTION_SOURCES: &[&str] = &["manual", "suggested"];` declared at the top of the file, mirroring `VALID_ACCOUNT_TYPES` at `db/account.rs:6-15`. This story's UI only ever sends `"manual"`; `"suggested"` is Epic 32's write path and must not be rejected here.
    - [x] Validate the project exists **and is active**: `SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1 AND archived_at IS NULL)` → else `AppError::Validation { field: Some("project_id") }`. This is the `db/budget.rs:202` existence-check pattern.
    - [x] Validate the account exists: `SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)` → else `AppError::Validation { field: Some("account_id") }`. Do this in application code even though the FK would also reject it, so the user gets a field-scoped validation error instead of a raw SQLite message.
    - [x] `INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date)`, then select the row back by `conn.last_insert_rowid()` and return it (`db/account.rs:162-186` shape).
  - [x] `pub fn delete_project_contribution(conn: &Connection, id: i64) -> Result<ProjectContribution, AppError>` — read the row **first** (so the command layer has an audit `old_value` and the frontend knows which `account_id`/`project_id` to invalidate), then `DELETE`; `rows == 0` → `AppError::Database { message: "Contribution not found" }` (`db/account.rs:287-295` shape). Returning the deleted row is deliberate: without `account_id` the caller cannot invalidate the right earmark key in Story 31.3.
  - [x] **Nothing in either function may touch the `accounts` table beyond the existence check's `SELECT`.** No `UPDATE accounts`, no import of `crate::db::account`'s balance helpers. [Source: `architecture-savings-projects.md#Enforcement Guidelines`]
- [x] **Task 3 — `db/projects.rs`: contribution reads via SUM aggregation (TDD each)** (AC: #2)
  - [x] `pub fn get_project_contributions(conn: &Connection, project_id: i64) -> Result<Vec<ProjectContribution>, AppError>` — `WHERE project_id = ?1 ORDER BY date DESC, id DESC`, using the `query_map(...).collect::<Result<Vec<_>, _>>()?` idiom.
  - [x] `pub fn get_project_saved_cents(conn: &Connection, project_id: i64) -> Result<i64, AppError>` — `SELECT COALESCE(SUM(amount_cents), 0) FROM project_contributions WHERE project_id = ?1`. `COALESCE(..., 0)` is mandatory: without it the aggregate over zero rows returns `NULL` and the `i64` row-get fails. Precedent: `db/account.rs:106`, `:122`.
  - [x] `pub fn get_project_saved_totals(conn: &Connection) -> Result<Vec<ProjectSavedTotal>, AppError>` — one grouped query for the whole list page, not N per-project queries:
    ```sql
    SELECT p.id, COALESCE(SUM(c.amount_cents), 0) AS saved_cents
    FROM projects p
    LEFT JOIN project_contributions c ON c.project_id = p.id
    WHERE p.archived_at IS NULL
    GROUP BY p.id
    ```
    `LEFT JOIN` (not `JOIN`) so a project with no contributions still returns a `0` row — otherwise the list page has no entry for it and renders a blank instead of `$0`.
  - [x] These are pure reads. No writes, no audit log.
- [x] **Task 4 — Commands + registration** (AC: #1, #2, #3, #4, #5)
  - [x] In `apps/desktop/src-tauri/src/commands/projects.rs` (created by Story 31.1), add four commands, each `#[tauri::command(rename_all = "snake_case")]` returning `Result<T, AppError>`, each locking with `state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?`:
    - [x] `create_project_contribution(state, project_id: i64, account_id: i64, amount_cents: i64, date: String, source: Option<String>) -> Result<ProjectContribution, AppError>` — `source` defaults to `"manual"` via `unwrap_or_else(|| "manual".to_string())`.
    - [x] `delete_project_contribution(state, id: i64) -> Result<ProjectContribution, AppError>`
    - [x] `get_project_contributions(state, project_id: i64) -> Result<Vec<ProjectContribution>, AppError>`
    - [x] `get_project_saved_totals(state) -> Result<Vec<ProjectSavedTotal>, AppError>`
  - [x] Audit both mutations with `entity_type = "project_contribution"`: create → `action = "create"`, `old_value = None`, `new_value = Some(serde_json::to_string(&result))`; delete → `action = "delete"`, `old_value = Some(serialized deleted row)`, `new_value = None`. `entity_id` is the contribution's own `id`. A failed audit write is `tracing::error!`-logged and swallowed, never propagated (`commands/account.rs:124-126`).
  - [x] No SQL in the command file (project rule 3). No `record_net_worth_snapshot` call — nothing about net worth changes.
  - [x] Register all four in the `generate_handler![...]` list in `apps/desktop/src-tauri/src/lib.rs`, next to Story 31.1's four project commands.
- [x] **Task 5 — Frontend types, query keys, hooks** (AC: #1, #2, #3)
  - [x] Add to `apps/desktop/src/lib/types.ts`: `ProjectContribution`, `CreateProjectContributionInput`, `ProjectSavedTotal` — mirroring the Rust shapes.
  - [x] Add to `queryKeys` in `apps/desktop/src/lib/constants.ts`: `projectContributions: (projectId: number) => ["project-contributions", projectId] as const` and `projectSavedTotals: ["project-saved-totals"] as const`.
  - [x] In `apps/desktop/src/hooks/useProjects.ts`, add `useProjectContributions(projectId)`, `useProjectSavedTotals()`, `useCreateProjectContribution()`, `useDeleteProjectContribution()`.
  - [x] Both mutations' `onSuccess` must invalidate **all** affected keys: `queryKeys.projects`, `queryKeys.projectSavedTotals`, and `queryKeys.projectContributions(projectId)` (project rule 6). Take `projectId` from the mutation variables for create, and from the returned deleted row for delete.
  - [x] Do **not** invalidate `queryKeys.accounts`, `netWorthCurrent`, `netWorthSnapshotsRecent`, or `financialHealth`: no account balance, net worth figure, or health input changes. Invalidating them would imply, in code, that this feature moves money.
  - [x] Story 31.3 adds `accountEarmarks(accountId)` and Story 31.4 adds the dashboard summary key to these same `onSuccess` bodies. Do not pre-add keys that do not exist yet.
- [x] **Task 6 — `ProjectContributionForm.tsx`** (AC: #1, #5)
  - [x] Create `apps/desktop/src/components/projects/ProjectContributionForm.tsx` — `react-hook-form`, `mode: "onBlur"`, `noValidate` on the `<form>`, `onClose` prop; structure copied from `components/income/AddIncomeEntryForm.tsx` and `components/accounts/AddAccountForm.tsx:92-101`.
  - [x] Amount: `MoneyInput` inside a `Controller` with `rules: { validate: (v) => v > 0 || t("validation.amountPositive") }` (`AddIncomeEntryForm.tsx:124-146`). `MoneyInput` returns integer cents already — never send dollars over IPC.
  - [x] Date: `DatePicker` from `@nixus/shared` inside a `Controller` with `rules: { required: t("validation.dateRequired") }`, defaulting to today (`AddIncomeEntryForm.tsx:152-175`).
  - [x] Source account: **required** select. Build items from `useAccounts()` ordered with `groupAccountsBySection` from `@/lib/accountUtils`, labelled `` `${account.name} — ${account.institution}` `` — i.e. mirror `components/shared/OptionalAccountSelect.tsx:30-46` but **omit** its leading `{ value: "", label: t("common.none") }` entry, because a contribution must name its source account (`project_contributions.account_id` is `NOT NULL`). Do **not** modify `OptionalAccountSelect` — its empty option is load-bearing for imports and expenses.
  - [x] Include the "no money moves" note (`projects.noMoneyMovedNote`, added in Story 31.1) visibly in the form. This is the product's central promise (PRD SC2) and the form is where a user would otherwise assume a transfer happens.
  - [x] On error, surface `AppError.field`-aware feedback if convenient, otherwise `toast.error(t("toast.saveFailed"))`; on success `toast.success(t("toast.saveSuccess"))` and `onClose()`.
- [x] **Task 7 — Project detail progress display** (AC: #2, #3)
  - [x] On `apps/desktop/src/routes/wealth.projects.tsx`, replace Story 31.1's hardcoded `savedCents={0}` on `ProjectRow` with the real figure from `useProjectSavedTotals()`, matched by `project_id` (fall back to `0` when the row is absent). Delete the Story-31.1 placeholder comment.
  - [x] Project detail: expand the selected `ProjectRow` in place (the `expanded` toggle pattern at `components/budget/BudgetCategoryRow.tsx:99-119`, `:184-188`) or open a `SlideOver` — either is acceptable; do **not** add a `/wealth/projects/$projectId` child route, which would add a sixth Wealth navigation surface's worth of routing for no AC.
  - [x] The detail view shows: saved (`Money`), remaining (`target_cents - saved_cents`, floored at 0 for display), percent complete, a `Meter` with `value={savedCents} max={targetCents}` and a localized `valueText`, and the contribution history list from `useProjectContributions(projectId)` with a delete action per row.
  - [x] Percent complete: integer arithmetic on cents then a single division for display only — `Math.round((savedCents / targetCents) * 100)`, guarded by `targetCents > 0`. Never store or transmit a percentage; never do money math in floats on the Rust side (project rule 1). Precedent for a display-only percentage: `routes/index.tsx:88-91`.
  - [x] Contribution delete uses a `Dialog` confirm (`components/accounts/AccountRow.tsx:196-210`) then `useDeleteProjectContribution()`.
  - [x] Money rendering goes through `<Money cents={...} locale={i18n.language} {...maskProps} />` with `useMaskProps()` from `@/contexts/ValuesVisibilityContext`, and `valueText` falls back to `t("common.amountHidden")` when `useValuesHidden().hidden` — the hide-values feature must keep working (`BudgetCategoryRow.tsx:57-58`, `:180`).
- [x] **Task 8 — i18n keys in both locales** (AC: #1, #2)
  - [x] Add every key from Dev Notes → "i18n keys" to `apps/desktop/src/locales/en.json` **and** `fr.json` in the same change.
  - [x] Extend `REQUIRED_KEYS` in `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` (created in Story 31.1) with the new keys.
- [x] **Task 9 — Rust unit tests (write first)** (AC: #1, #2, #3, #5, #6)
  - [x] Extend the `#[cfg(test)] mod tests` block and `projects_test_db()` helper in `db/projects.rs` (created in Story 31.1) — it already creates `accounts`, `projects` and `project_contributions` with `PRAGMA foreign_keys=ON`. Seed one account with a known `balance_cents` and one active project.
  - [x] Add a local `fn account_balance(conn: &Connection, id: i64) -> i64` test helper (the same idea as `db/income.rs`'s `account_balance`) so the balance-invariance assertions read in one line.
  - [x] Test: `insert_project_contribution` persists a row with `source == "manual"`, and `get_project_saved_cents` goes from `0` to the inserted amount.
  - [x] Test (**the SC2 guard**): `account_balance` is identical before and after `insert_project_contribution`, and identical again after `delete_project_contribution`. Assert the literal seeded value both times so a future balance-mutating "convenience" fails loudly. [Source: `prd-savings-projects.md#2. Success Criteria` SC2]
  - [x] Test: two contributions from two different accounts to the same project sum correctly in `get_project_saved_cents`.
  - [x] Test: `get_project_saved_cents` returns `0` for a project with no contributions (proves the `COALESCE`).
  - [x] Test: `get_project_saved_totals` includes a contribution-free active project with `saved_cents == 0` (proves the `LEFT JOIN`) and **excludes** archived projects.
  - [x] Test: `delete_project_contribution` returns the deleted row (with the correct `account_id` and `project_id`) and lowers the saved total by exactly that amount; deleting a missing id → `Err`.
  - [x] Test: `insert_project_contribution` with `amount_cents = 0` and with a negative amount → `AppError::Validation`, `field == Some("amount_cents")`, and `SELECT COUNT(*) FROM project_contributions` is still `0` (AC #5: no partial write).
  - [x] Test: unknown `account_id` → `Validation` with `field == Some("account_id")`; unknown `project_id` → `field == Some("project_id")`; archived `project_id` → `field == Some("project_id")`.
  - [x] Test: an invalid `source` (e.g. `"auto"`) → `Validation` with `field == Some("source")`, and `"suggested"` is **accepted** (Epic 32 depends on it).
  - [x] Test: `get_project_contributions` returns rows for the requested project only, newest date first.
- [x] **Task 10 — Playwright / spec-mock audit** (AC: #1, #2, #3)
  - [x] `/wealth/projects` now invokes `get_projects`, `get_project_saved_totals`, `get_accounts` (for the source-account select) and, on expand, `get_project_contributions`. Add cases for all of them to the mock in `apps/desktop/tests/nav-qa.spec.ts` (the entry added by Story 31.1) — its console-error gate fails on an unmocked command.
  - [x] Extend `apps/desktop/tests/projects.spec.ts` (or create it) with: log a contribution → saved total increases and the account balance shown on the accounts surface is unchanged; delete a contribution → saved total decreases.
  - [x] The forms live inside the `/wealth/projects` route, not in an always-mounted component, so specs that never visit that route need no change (`docs/project-context.md:295` applies only to always-mounted `invoke` callers).
- [x] **Task 11 — Verification** (AC: all)
  - [x] `cargo test` green; `cargo clippy --all-targets` adds zero new warnings.
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` clean; `pnpm --filter @nixus/desktop test` passes.
  - [x] `git diff` grep for `UPDATE accounts`, `adjust_account_balance`, `reverse_adjustment`, `update_account_balance` → **zero** matches in this story's changes (AC #6).
  - [x] `git diff` grep for `f64` in Rust → zero matches.
  - [x] Confirm `migrations/` and `db/mod.rs`'s `MIGRATIONS` array are untouched — the schema this story needs was created by Story 31.1.

## Dev Notes

### What this story is, in one sentence

A contribution ledger on top of Story 31.1's tables: two write commands, two read commands (one of which is a `SUM ... GROUP BY` aggregation), one form, and a progress display — with the account balance provably untouched.

### The one invariant that outranks everything else in this story

**`accounts.balance_cents` must never be written by any code path added here.** Not on create, not on delete, not "for convenience".

- The PRD states it as a success criterion: *"Account balance never changes as a side effect of project contributions"*, measured by a DB assertion in tests (SC2), and as FR3/FR4 test criteria.
- The architecture states it as a hard constraint and an enforcement rule: *"Never write to `accounts.balance_cents` from any code path in this feature"*, and names the violating implementation as the feature's headline anti-pattern.
- Nixus has no bank connection; there is no money to move. Earmarking is a *label* on money that is already sitting in an account, which is exactly why the per-account split in Story 31.3 is computed as `balance_cents − SUM(contributions)` rather than stored.

The trap is that a very similar-looking module deliberately does the opposite: `db/income.rs` and `db/expense.rs` call `account_db::adjust_account_balance` / `reverse_adjustment` (`db/account.rs:62-100`) on insert, update and delete, and their tests assert the balance moved (`db/income.rs:439+`). **Read those files as a shape reference for insert/delete/return-the-row ergonomics only.** Copying their balance handling breaks the product.

### `db/projects.rs` additions — SQL to write

Saved total for one project:

```sql
SELECT COALESCE(SUM(amount_cents), 0) FROM project_contributions WHERE project_id = ?1
```

Saved totals for every active project, in one round trip:

```sql
SELECT p.id, COALESCE(SUM(c.amount_cents), 0) AS saved_cents
FROM projects p
LEFT JOIN project_contributions c ON c.project_id = p.id
WHERE p.archived_at IS NULL
GROUP BY p.id
```

Two details that are easy to get wrong:

- **`COALESCE(SUM(...), 0)` is not optional.** `SUM` over zero rows is `NULL` in SQLite; reading `NULL` into `i64` is a rusqlite type error, so the "new project with no contributions" case would fail at runtime rather than return `0`. The codebase already treats this as standard: `db/account.rs:106`, `:122`, `db/dashboard.rs:15-22`.
- **`LEFT JOIN`, not `JOIN`.** An inner join silently drops projects with no contributions, which is precisely the state every project is in immediately after creation.

Existence checks use the `SELECT EXISTS(SELECT 1 ...)` idiom already used at `db/budget.rs:202` and `:246`.

### Model addition, and why it is a small extension of the architecture

The architecture's models list is *"`Project`, `CreateProjectInput`, `UpdateProjectInput`, `ProjectContribution`, `CreateProjectContributionInput`, `AccountEarmarkBreakdown`, `ProjectAllocationSuggestion`"*, and its file tree annotates `models/mod.rs` as *"+Project, +ProjectContribution, +input/summary structs"*. `ProjectSavedTotal` is such a summary struct: FR3/FR4 require a saved total per project and the architecture names the aggregation (`SUM(amount_cents)` computed on read, never stored) without naming the struct that carries it. Adding it is inside the documented shape, not a new architectural concept. The same applies to the two new `queryKeys` entries: the architecture lists `projects`, `project(id)`, `accountEarmarks(accountId)` and `suggestedAllocation` for the reads it enumerated; the contribution list and saved-total reads need their own keys, kebab-case, defined in `lib/constants.ts` like every other key. [Source: `architecture-savings-projects.md#Decision Impact Analysis`, `#Data modeling approach`, `#Frontend Architecture`]

What is **not** an acceptable extension: storing `saved_cents` as a column on `projects`. The architecture is explicit that earmark totals are *"computed on read, never stored redundantly"*, and a stored total would drift the moment a contribution is deleted outside the one code path that maintains it.

### Command shapes

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn create_project_contribution(
    state: State<DbState>,
    project_id: i64,
    account_id: i64,
    amount_cents: i64,
    date: String,
    source: Option<String>,
) -> Result<ProjectContribution, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateProjectContributionInput {
        project_id,
        account_id,
        amount_cents,
        source: source.unwrap_or_else(|| "manual".to_string()),
        date,
    };
    let result = projects_db::insert_project_contribution(&conn, &input)?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "project_contribution",
        result.id,
        "create",
        None,
        Some(&details),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}
```

`delete_project_contribution` inverts it: fetch-and-delete in the db layer, then audit with `old_value = Some(serialized row)` and `new_value = None`, mirroring `commands/account.rs:111-132`.

`entity_type` is exactly `"project_contribution"` — the architecture mandates it and Epic 31.2's final AC asserts it. `"suggested"`-source contributions written by `confirm_project_allocations` in Epic 32 use the same `entity_type`.

### Frontend: invalidation is the correctness surface

```typescript
export function useCreateProjectContribution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectContributionInput) =>
      invoke<ProjectContribution>("create_project_contribution", {
        project_id: input.project_id,
        account_id: input.account_id,
        amount_cents: input.amount_cents,
        date: input.date,
      }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({ queryKey: queryKeys.projectSavedTotals });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectContributions(input.project_id),
      });
    },
  });
}
```

`invoke` argument names are `snake_case` and match the Rust parameter names exactly, or the call fails at the IPC boundary (project rule 2). The `onSuccess` block must list **every** affected key (project rule 6) — and this story's list is deliberately short because the earmark and dashboard keys do not exist yet. Stories 31.3 and 31.4 each add one line here; they own that wiring and say so in their own task lists.

For delete, read `project_id` off the returned row (`onSuccess: (deleted) => ...`), which is why `delete_project_contribution` returns `ProjectContribution` rather than `()`.

### Frontend: the required-account select

`components/shared/OptionalAccountSelect.tsx` is the closest thing to what this form needs, and it is deliberately *not* reusable here: its item list begins with `{ value: "", label: t("common.none") }` (`OptionalAccountSelect.tsx:42`) because an expense or income entry may legitimately have no linked account. A contribution may not — `project_contributions.account_id` is `NOT NULL`. Build the select inline in `ProjectContributionForm.tsx` using the same ordering logic:

```typescript
const { data: accounts = [] } = useAccounts();
const { assetGroups, liabilityGroups } = groupAccountsBySection(accounts);
const orderedAccounts = [
  ...assetGroups.flatMap(([, group]) => group),
  ...liabilityGroups.flatMap(([, group]) => group),
];
const items = orderedAccounts.map((account) => ({
  value: String(account.id),
  label: `${account.name} — ${account.institution}`,
}));
```

Convert back with `Number(value)` before invoking. Do not add an "unallocated"/"none" option, and do not filter to asset accounts only — the PRD does not restrict which account a user may earmark from.

### Frontend: progress display, derived not stored

`BudgetCategoryRow` is the shape to mirror, and its arithmetic is already TypeScript-side:

```typescript
const remainingCents = category.target_cents - category.spent_cents;
// ...
<Meter
  value={category.spent_cents}
  max={category.target_cents}
  label={t("budget.categoryMeterLabel", { name: category.name })}
  valueText={hidden ? t("common.amountHidden") : paceSentence}
/>
```

For a savings project, `spent → saved`; `remaining = target_cents - saved_cents`; percent = `Math.round((saved / target) * 100)` guarded by `target > 0`, for display only. One deliberate divergence from `BudgetCategoryRow`: its `getPacing` helper exists because a budget category cannot know whether being at 100% is good or bad (`BudgetCategoryRow.tsx:26-34`). A savings project has no such ambiguity — reaching the target is unambiguously good — so the badge is a two-state affair (`projects.remainingBadge` / `projects.reachedBadge`) and must not import or replicate the four-state `Pacing` union.

The `Meter` renders only when `target_cents > 0`, matching `BudgetCategoryRow.tsx:175`.

### i18n keys

Both `en.json` and `fr.json`, same change. Flat dotted keys, appended to Story 31.1's `projects.*` namespace.

| Key | EN | FR |
| --- | --- | --- |
| `projects.addContribution` | `Log a contribution` | `Enregistrer une contribution` |
| `projects.addContributionDescription` | `Record money you have set aside for this goal. Your account balance does not change.` | `Enregistrez l'argent que vous avez mis de côté pour cet objectif. Le solde de votre compte ne change pas.` |
| `projects.sourceAccount` | `Money is sitting in` | `L'argent se trouve dans` |
| `projects.sourceAccountRequired` | `Choose which account this money is sitting in` | `Choisissez le compte où se trouve cet argent` |
| `projects.saveContribution` | `Log contribution` | `Enregistrer la contribution` |
| `projects.savedLabel` | `Set aside` | `Mis de côté` |
| `projects.remainingLabel` | `Still needed` | `Encore nécessaire` |
| `projects.percentComplete` | `{{percent}}% of the way there` | `{{percent}} % du chemin parcouru` |
| `projects.contributionHistory` | `Contribution history` | `Historique des contributions` |
| `projects.contributionHistoryEmpty` | `Nothing set aside for this goal yet` | `Rien n'a encore été mis de côté pour cet objectif` |
| `projects.deleteContribution` | `Delete contribution` | `Supprimer la contribution` |
| `projects.deleteContributionTitle` | `Delete this contribution?` | `Supprimer cette contribution ?` |
| `projects.deleteContributionDescription` | `The goal's total goes down by this amount. Your account balance is not affected.` | `Le total de l'objectif diminuera de ce montant. Le solde de votre compte n'est pas touché.` |
| `projects.contributionColDate` | `Date` | `Date` |
| `projects.contributionColAccount` | `Account` | `Compte` |
| `projects.contributionColAmount` | `Amount` | `Montant` |

Reuse the existing `common.amount`, `common.date`, `common.cancel`, `common.amountHidden`, `toast.saveSuccess`, `toast.saveFailed`, `toast.deleteSuccess`, `toast.deleteFailed`, `validation.amountPositive`, `validation.dateRequired` keys rather than adding parallel ones. `projects.noMoneyMovedNote` already exists from Story 31.1 — reuse it in the form.

### Dependencies and sequencing

- **Depends on Story 31.1** for: migration 025 (both tables), `ProjectContribution` / `CreateProjectContributionInput` models, `db/projects.rs`, `commands/projects.rs`, `hooks/useProjects.ts`, `routes/wealth.projects.tsx`, `components/projects/ProjectRow.tsx`, the `projects.*` i18n namespace, and the `projects-i18n` locale spec. **This story creates none of those files from scratch — it extends them.**
- **Stories 31.3, 31.4 and 31.5 depend on this story**: 31.3 aggregates the rows this story writes, 31.4 rolls them up on the dashboard, and 31.5 needs at least one contribution to exist in order to be blocked by the FK.

### Testing standards

- **Rust:** extend `db/projects.rs`'s existing inline `#[cfg(test)] mod tests`. In-memory SQLite, `PRAGMA foreign_keys=ON`, DDL in the `projects_test_db()` helper. Multi-table helper precedent: `db/budget.rs:379-440`. Balance-assertion helper precedent: `db/income.rs`'s `account_balance` (`db/income.rs:439+`) — same helper, opposite expectation.
- **The balance-invariance test is the story's most important test.** It is the executable form of SC2 and the only thing that will catch a future refactor that "helpfully" debits the account.
- **Commands are not unit-tested** in this codebase (they need `State<DbState>`); there is no `#[cfg(test)]` block in any `commands/*.rs` CRUD file. Keep the commands thin and test `db/projects.rs`.
- **Frontend:** locale parity spec must be extended (`REQUIRED_KEYS`). A `hooks/__tests__/useProjects.test.tsx` invalidation test is optional but welcome; follow `src/hooks/__tests__/useBudgetTemplates.test.tsx` (`createRoot`/`act`, no `@testing-library/react`).
- **Playwright** stubs `invoke` per spec; a surface reaching a new command needs a new mock case.
- **Zero new warnings** from `cargo clippy` and `tsc`.

### Explicitly out of scope

No migration change (Story 31.1 owns the schema), no per-account earmark breakdown or `AccountEarmarkBreakdown` model (Story 31.3), no dashboard card (Story 31.4), no change to `commands/account.rs` or `db/account.rs` (Story 31.5), no `projects/allocation.rs` and no suggestion commands (Epic 32), no `source = "suggested"` write path from the UI, no contribution *editing* (no AC asks for it — delete-and-relog is the documented flow), no drag-to-reorder, no new npm/Rust dependency, no version bump.

### Project Structure Notes

```
apps/desktop/src-tauri/src/
├── models/mod.rs                              # MODIFIED — + ProjectSavedTotal; drop any
│                                              #            #[allow(dead_code)] from 31.1
├── db/projects.rs                             # MODIFIED — + insert/delete contribution,
│                                              #            + get_project_contributions,
│                                              #            + get_project_saved_cents,
│                                              #            + get_project_saved_totals, + tests
├── commands/projects.rs                       # MODIFIED — + 2 mutations (audited) + 2 reads
└── lib.rs                                     # MODIFIED — register 4 more commands

apps/desktop/src/
├── components/projects/ProjectContributionForm.tsx  # NEW
├── components/projects/ProjectRow.tsx               # MODIFIED — real savedCents; expandable detail
├── routes/wealth.projects.tsx                       # MODIFIED — wire saved totals + contribution UI
├── hooks/useProjects.ts                             # MODIFIED — + 4 hooks, invalidation
├── lib/constants.ts                                 # MODIFIED — + projectContributions(id),
│                                                    #            + projectSavedTotals
├── lib/types.ts                                     # MODIFIED — + ProjectContribution,
│                                                    #            CreateProjectContributionInput,
│                                                    #            ProjectSavedTotal
├── locales/en.json, fr.json                         # MODIFIED — contribution keys, both files
└── locales/__tests__/projects-i18n.test.ts          # MODIFIED — + REQUIRED_KEYS

apps/desktop/tests/
├── nav-qa.spec.ts                             # MODIFIED — mock cases for the new commands
└── projects.spec.ts                           # MODIFIED/NEW — log + delete contribution flow
```

**Nothing new is created in `src-tauri/`** — every backend file this story touches already exists after Story 31.1. The only genuinely new file is `ProjectContributionForm.tsx`.

**Deliberately not touched:** `migrations/` (no new migration), `db/mod.rs`, `db/account.rs`, `commands/account.rs`, `db/net_worth.rs`, `db/dashboard.rs`, `components/net-worth/NetWorthBreakdownBar.tsx`, `components/budget/BudgetCategoryRow.tsx`, `components/shared/OptionalAccountSelect.tsx`, `routes/index.tsx`, `lib/navigation.ts`, `Cargo.toml`, `package.json`, `tauri.conf.json`, `_bmad-output/implementation-artifacts/sprint-status.yaml`.

**Naming conventions satisfied:** `_cents` on every money field; `snake_case` Rust functions and IPC fields; `Create*Input` naming; ISO 8601 date strings; kebab-case query-key arrays; `PascalCase` component in the flat `components/projects/` feature folder.

### References

- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Story 31.2: Log and remove contributions to a project` — acceptance criteria, copied faithfully, incl. the `entity_type = "project_contribution"` audit clause]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Requirements Inventory` — FR3, FR4, NFR2]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Additional Requirements` — audit mandate; invalidate all affected query keys]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements` — FR3 ("source account's `balance_cents` is unchanged"), FR4 ("saved total decreases; account balance unchanged")]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#2. Success Criteria` — SC2, measured by a DB assertion in tests]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Core Architectural Decisions` — earmarking is a contribution ledger; `accounts.balance_cents` is never mutated]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data modeling approach` — totals computed on read via `SUM(amount_cents)`, never stored redundantly]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#API & Communication Patterns` — `create_project_contribution`, `delete_project_contribution`; `Result<T, AppError>`; existing error variants suffice]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Process Patterns` — audit `entity_type = "project_contribution"`; invalidate every affected key on contribution mutations]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Enforcement Guidelines` — never write `accounts.balance_cents`; never let a `get_*` command write; all SQL in `db/projects.rs`; the "convenience balance update" anti-pattern]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Requirements to Structure Mapping` — FR3/FR4 → `commands/projects.rs::{create,delete}_project_contribution` + `ProjectContributionForm.tsx`]
- [Source: `docs/project-context.md#1. Monetary Values — Always Integers (Cents)`; `#2. Tauri IPC Commands`; `#3. Database Operations Belong in db/ Only`; `#4. Rust Model Structs`; `#6. TanStack Query Keys`; `#8. Shared UI Components`; `#9. Compilation Warnings Policy`; `#Testing Rules`; `#Anti-Patterns to Avoid`]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:6-15` — `VALID_*` const allow-list pattern]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:62-100` — `adjust_account_balance` / `reverse_adjustment`: the functions this story must never call]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:106`, `:122` — `COALESCE(SUM(...), 0)` aggregation precedent]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:162-186`, `:287-295` — insert-then-select-back and delete-with-rows-check shapes]
- [Source: `apps/desktop/src-tauri/src/db/budget.rs:202`, `:246` — `SELECT EXISTS(SELECT 1 ...)` existence-check idiom]
- [Source: `apps/desktop/src-tauri/src/db/budget.rs:379-440` — multi-table in-memory `#[cfg(test)]` helper]
- [Source: `apps/desktop/src-tauri/src/db/income.rs:439+` — insert/update/delete tests asserting balances DO move (deliberate contrast) and the `account_balance` helper idea]
- [Source: `apps/desktop/src-tauri/src/db/dashboard.rs:6-31` — `COALESCE`-wrapped aggregate query precedent]
- [Source: `apps/desktop/src-tauri/src/db/audit.rs:5-12` — `insert_audit_log` signature]
- [Source: `apps/desktop/src-tauri/src/commands/account.rs:10-39`, `:111-132` — command shape; audit on create/delete; non-fatal audit failure]
- [Source: `apps/desktop/src-tauri/src/error.rs:5-13`, `:101-107` — `AppError::Validation { message, field }`; `From<rusqlite::Error>`]
- [Source: `apps/desktop/src/hooks/useAccounts.ts:18-36`, `:75-92` — mutation + multi-key invalidation shape]
- [Source: `apps/desktop/src/lib/constants.ts:1-70` — `queryKeys` object; parameterized key precedent (`budgetCategories(groupId)`)]
- [Source: `apps/desktop/src/components/budget/BudgetCategoryRow.tsx:26-34`, `:57-58`, `:62`, `:99-119`, `:143-188` — pacing helper NOT to copy; masking; remaining arithmetic; expand toggle; Money/Badge/Meter composition]
- [Source: `apps/desktop/src/components/income/AddIncomeEntryForm.tsx:109-175` — `Controller` + `MoneyInput` + `DatePicker` with validation rules]
- [Source: `apps/desktop/src/components/shared/MoneyInput.tsx:29-64` — dollars in, integer cents out]
- [Source: `apps/desktop/src/components/shared/OptionalAccountSelect.tsx:30-60` — account ordering and label format; the `common.none` option to omit]
- [Source: `apps/desktop/src/components/accounts/AccountRow.tsx:196-210` — destructive-confirm Dialog]
- [Source: `apps/desktop/src/components/accounts/AddAccountForm.tsx:92-101`, `:205-219` — `noValidate` rationale; submit/cancel footer]
- [Source: `apps/desktop/src/routes/index.tsx:88-91` — display-only percentage arithmetic precedent]
- [Source: `apps/desktop/src/locales/__tests__/recurring-i18n.test.ts:1-40` — parity + `REQUIRED_KEYS` pattern]
- [Source: `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` — desktop hook-test style (`createRoot`/`act`, no `@testing-library/react`)]
- [Source: `apps/desktop/tests/nav-qa.spec.ts:101-119` — surfaces list and console-error gate that requires new mock cases]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo test` (src-tauri): 471 passed, 0 failed — 14 of them new contribution tests in `db::projects::tests`.
- `cargo clippy --all-targets`: 1 warning, pre-existing (`commands/backup.rs:106` `explicit_auto_deref`). Zero new.
- `pnpm --filter @nixus/desktop exec tsc --noEmit`: clean.
- `pnpm --filter @nixus/desktop test` (vitest): 12 files, 205 tests passed.
- `pnpm --filter @nixus/desktop exec playwright test projects.spec.ts`: 10 passed (3 new contribution specs + 1 new validation spec).
- `pnpm --filter @nixus/desktop exec playwright test nav-qa.spec.ts accessibility.spec.ts`: 23 passed.
- AC #6 guard: `git diff` grep for `UPDATE accounts`, `adjust_account_balance`, `reverse_adjustment`, `update_account_balance` → zero added lines. `git diff -- '*.rs'` grep for `f64` → zero added lines.
- `migrations/` and `db/mod.rs` carry only Story 31.1's uncommitted changes; this story added nothing to either.

### Completion Notes List

- **The SC2 invariant is locked by two independent tests.** `db::projects::tests::contribution_writes_never_move_account_balances` asserts the literal seeded balance (`1_234_567`) before insert, after insert and after delete, so a future "convenience" debit fails loudly rather than silently passing a relative comparison. The Playwright specs additionally read `get_accounts` back through the IPC mock after logging and after deleting a contribution, and the mock's `accounts` array is annotated as deliberately frozen so nobody "fixes" it into mutating.
- **`get_project_saved_cents` carries `#[allow(dead_code)]`.** Task 3 mandates the function, but the list surface uses the grouped `get_project_saved_totals` and no command exposes the single-project variant, so its only current caller is the test module (where it is the assertion oracle for every saved-total test). Per project rule 9 the attribute names its upcoming production consumer (Story 31.4's dashboard rollup). Task 1's instruction to strip `#[allow(dead_code)]` was honoured where it applied — both model structs are now genuinely consumed and their attributes are gone.
- **Deviation: the detail view lives in a new `components/projects/ProjectDetail.tsx`, not inline in `ProjectRow.tsx`.** The Project Structure Notes list `ProjectContributionForm.tsx` as the only new file, but folding saved/remaining/percent, the contribution history, the log-a-contribution `SlideOver` and the delete-confirm `Dialog` into `ProjectRow.tsx` would have pushed that file past the project's file-size discipline (`ProjectRow.tsx` is 147 pure LOC and `ProjectDetail.tsx` 195 as split; combined they would exceed 250). The expand-toggle pattern from `BudgetCategoryRow.tsx:99-119`/`:184-188` is used exactly as specified — `ProjectRow` owns the `expanded` state and renders `<ProjectDetail>` when open. No `/wealth/projects/$projectId` child route was added.
- **Deviation: two i18n keys beyond the Dev Notes table.** `projects.expandProject` / `projects.collapseProject` (both `{{name}}`-interpolated) were needed for the expand toggle's `aria-label`; `budget.expandCategory` was not reused because its copy says "category". Both are in `en.json` and `fr.json`, in `REQUIRED_KEYS`, and in the placeholder-parity assertion.
- **The Meter is not duplicated in the detail view.** `ProjectRow` already renders exactly the `Meter value={savedCents} max={targetCents}` with a localized `valueText` that falls back to `t("common.amountHidden")` when values are hidden, and it stays visible while the row is expanded, so the detail view adds the saved / still-needed / percent figures rather than a second progress bar.
- **`delete_project_contribution` reads the row before deleting**, so the `rows == 0` branch the task list specifies is a belt-and-braces guard behind an already-successful read; it was kept because the task list names it explicitly and it costs nothing.
- **Percent complete is display-only**, `Math.round((savedCents / targetCents) * 100)` guarded by `targetCents > 0`, computed in TypeScript. No percentage crosses IPC and no `f64` exists on the Rust side. Remaining is floored at `0` for display via `Math.max(0, ...)`.
- **Invalidation is deliberately narrow.** Both mutations invalidate `projects`, `projectSavedTotals` and `projectContributions(projectId)` through one shared helper, and the helper carries a comment stating why `accounts`, `netWorthCurrent`, `netWorthSnapshotsRecent` and `financialHealth` are absent. Stories 31.3 and 31.4 each add one line to that helper.
- **`db/projects.rs` is 257 pure LOC of production code (698 including its inline test module).** This is inside the codebase's one-db-file-per-domain convention — `db/account.rs` is 412, `db/budget.rs` 489, `db/income.rs` 490, `db/expense.rs` 597 by the same measure — and the architecture names `db/projects.rs` as the sole owner of this SQL, so it was not split.
- `source` is validated against `VALID_CONTRIBUTION_SOURCES = &["manual", "suggested"]`; a test proves `"suggested"` is accepted (Epic 32 depends on it) and `"auto"` is rejected with `field == Some("source")`.

### File List

- `apps/desktop/src-tauri/src/models/mod.rs` — MODIFIED
- `apps/desktop/src-tauri/src/db/projects.rs` — MODIFIED
- `apps/desktop/src-tauri/src/commands/projects.rs` — MODIFIED
- `apps/desktop/src-tauri/src/lib.rs` — MODIFIED
- `apps/desktop/src/lib/types.ts` — MODIFIED
- `apps/desktop/src/lib/constants.ts` — MODIFIED
- `apps/desktop/src/hooks/useProjects.ts` — MODIFIED
- `apps/desktop/src/components/projects/ProjectContributionForm.tsx` — NEW
- `apps/desktop/src/components/projects/ProjectDetail.tsx` — NEW
- `apps/desktop/src/components/projects/ProjectRow.tsx` — MODIFIED
- `apps/desktop/src/routes/wealth.projects.tsx` — MODIFIED
- `apps/desktop/src/locales/en.json` — MODIFIED
- `apps/desktop/src/locales/fr.json` — MODIFIED
- `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` — MODIFIED
- `apps/desktop/tests/projects.spec.ts` — MODIFIED
- `apps/desktop/tests/nav-qa.spec.ts` — MODIFIED
- `_bmad-output/implementation-artifacts/31-2-log-and-remove-contributions-to-a-project.md` — MODIFIED
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED
