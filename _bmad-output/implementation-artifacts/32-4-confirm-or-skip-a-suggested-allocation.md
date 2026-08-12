# Story 32.4: Confirm or skip a suggested allocation

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user reviewing a suggested allocation,
I want to explicitly confirm or skip it,
so that money is only ever earmarked with my direct approval.

**Scope:** The one and only write path for suggested allocations — `confirm_project_allocations` — plus its pure pre-flight guard, its audit trail, and the frontend wiring (mutation hook, source-account selector, cache invalidation). Skipping is implemented by *not calling anything*, and this story proves that with a test.

## Acceptance Criteria

1. **Given** a reviewed (possibly edited) suggested allocation
   **When** I confirm it
   **Then** exactly one `project_contributions` row is created per non-zero entry with `source = "suggested"`, each project's saved total increases by its confirmed amount, and one audit log entry with `entity_type = "project_contribution"` and `action = "create"` is written per created row

2. **Given** a reviewed suggested allocation
   **When** I skip it instead of confirming
   **Then** no command is invoked, no `project_contributions` row is created, and no project's saved total changes

3. **Given** any confirmation
   **When** the rows are written
   **Then** every source account's `accounts.balance_cents` is byte-for-byte unchanged (SC2) — no code path in this story writes to the `accounts` table

4. **Given** a confirmation whose entries are all zero, or an empty allocation list
   **When** the command runs
   **Then** it succeeds with zero rows created and zero audit entries written — a confirmation of nothing is a no-op, not an error

5. **Given** an invalid confirmation — a negative amount, a duplicate `project_id`, an unknown or archived `project_id`, an unknown `account_id`, or a non-ISO-8601 date
   **When** the command runs
   **Then** it returns `AppError::Validation` and **no rows at all are created**, including for the entries that were individually valid (all-or-nothing)

6. **Given** a confirmation whose total exceeds my current `avg_monthly_surplus_cents`
   **When** the command runs
   **Then** it returns `AppError::Validation` and writes nothing — the FR7 cap is enforced server-side with the same inclusive boundary the UI uses (equal to the surplus is allowed)

7. **Given** my waterfall step is not `ContributeRegisteredAccounts` or `InvestSurplus`
   **When** the command runs
   **Then** it returns `AppError::Validation` and writes nothing — a `source = "suggested"` row can only ever exist for an allocation the app was actually willing to suggest

8. **Given** `get_suggested_allocation` is called any number of times
   **When** the database is inspected before and after
   **Then** the `project_contributions` row count and contents are identical — the read command is not, and can never become, a write path (NFR4, regression tie-back to Story 32.2)

9. **Given** a confirmation succeeds
   **When** the mutation's `onSuccess` runs
   **Then** it invalidates exactly the same query keys as a manual contribution from Story 31.2, plus `suggestedAllocation`, so the project list, the affected accounts' earmark breakdowns, and the dashboard summary card all reflect the change with no manual refresh

10. **Given** the confirm path
    **When** the implementation is inspected
    **Then** `source` is hard-coded to `"suggested"` inside the db layer and is not a field on the IPC input type, so no caller can forge a different source value through this command

## Tasks / Subtasks

- [x] **Task 1 — `ProjectAllocationInput` model** (AC: #1, #10)
  - [x] In `apps/desktop/src-tauri/src/models/mod.rs`, add:
        `pub struct ProjectAllocationInput { pub project_id: i64, pub account_id: i64, pub amount_cents: i64, pub date: String }`
        deriving exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`, `snake_case` fields, ISO 8601 date as `String`
  - [x] **No `source` field.** `source` is set to `"suggested"` by the db layer only (AC #10). The schema's `CHECK (source IN ('manual', 'suggested'))` is the backstop, not the primary control
  - [x] Place it beside Story 31.2's `CreateProjectContributionInput` — this type is structurally that type minus `source`, and the similarity is intentional so the two write paths share validation semantics

- [x] **Task 2 — Pure pre-flight guard in `projects/allocation.rs`, test-first** (AC: #6, #7)
  - [x] Write the failing tests first, in the existing `#[cfg(test)] mod tests` of `apps/desktop/src-tauri/src/projects/allocation.rs` (created by Story 32.2)
  - [x] Add `pub fn guard_confirmable(current_step: &WaterfallStep, avg_monthly_surplus_cents: i64, total_cents: i64) -> Result<(), AppError>` — pure, no `Connection`, no clock
  - [x] Returns `Err(AppError::Validation { .., field: None })` when `current_step` is `BuildEmergencyFund` or `PayHighInterestDebt`; returns `Err(AppError::Validation { .., field: Some("amount_cents") })` when `total_cents > avg_monthly_surplus_cents`; returns `Ok(())` otherwise
  - [x] Tests: gated-out step with a valid total → error; `total == surplus` → **Ok** (inclusive boundary, must match `validateAllocationTotal` in `src/lib/allocation.ts` from Story 32.3); `total == surplus + 1` → error; `total == 0` with a gated-out step → error (the step gate is checked first and independently); allowed step with `total < surplus` → Ok
  - [x] `total_cents == 0` on an allowed step → `Ok(())`; the zero-row no-op of AC #4 is decided in the db layer, not here

- [x] **Task 3 — `db/projects.rs::insert_suggested_contributions`, test-first** (AC: #1, #3, #4, #5, #10)
  - [x] Write failing in-memory SQLite tests first, using the `setup_test_db()` shape from `src-tauri/src/db/financial_health.rs:338-375` extended with the `projects`, `project_contributions`, `accounts`, and `audit_log` tables copied verbatim from `migrations/025_projects.sql` and the existing migrations. `PRAGMA foreign_keys=ON;` is required for the FK behaviour to be exercised
  - [x] Add `pub fn insert_suggested_contributions(conn: &Connection, allocations: &[ProjectAllocationInput]) -> Result<Vec<ProjectContribution>, AppError>`
  - [x] Step 1 — filter: drop entries where `amount_cents == 0`. If nothing remains, return `Ok(vec![])` **without opening a transaction** (AC #4)
  - [x] Step 2 — validate every remaining entry **before** opening the transaction, mirroring the pre-validation loop of `db/expense.rs:228-253`, and returning `AppError::Validation { message, field }` with the offending row's 1-based index in the message:
        `amount_cents < 0`; duplicate `project_id` within the batch; `project_id` not present in `projects` or having a non-null `archived_at`; `account_id` not present in `accounts`; `date` not parseable as `YYYY-MM-DD` via `chrono::NaiveDate::parse_from_str`
  - [x] Step 3 — `conn.unchecked_transaction()?`, then per entry
        `INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date) VALUES (?1, ?2, ?3, 'suggested', ?4)`
        with `'suggested'` written as a **literal in the SQL** (AC #10), capture `tx.last_insert_rowid()`, then `tx.commit()?`
  - [x] Step 4 — return the created `ProjectContribution` rows (Story 31.2's model) so the command can audit each one and the frontend can invalidate per-account keys
  - [x] Tests: three entries → three rows, all with `source = 'suggested'`; one zero entry among three → two rows; all-zero and empty inputs → `Ok(vec![])`, zero rows, no transaction; negative amount → `Validation`, `SELECT COUNT(*) == 0`; duplicate `project_id` → `Validation`, zero rows; unknown `project_id` → `Validation`, zero rows; archived `project_id` → `Validation`, zero rows; unknown `account_id` → `Validation`, zero rows (a pre-check, not a raw FK error); malformed date → `Validation`, zero rows
  - [x] **Atomicity test (AC #5):** a batch of three where only the third is invalid → `Validation` returned and `SELECT COUNT(*) FROM project_contributions == 0`, proving the first two were never written
  - [x] **SC2 test (AC #3):** record `SELECT balance_cents FROM accounts` before and after a successful confirm and assert equality. Grep the finished diff for `UPDATE accounts` / `balance_cents` and confirm zero hits in this story's changes
  - [x] **NFR4 tie-back test (AC #8):** in the same test module, call `get_active_allocation_projects` + `compute_suggested_allocation` (Story 32.2) five times against a populated DB and assert `SELECT COUNT(*) FROM project_contributions` is unchanged and all five results are equal — the read path stays inert even now that a write path exists beside it

- [x] **Task 4 — `commands/projects.rs::confirm_project_allocations`** (AC: #1, #6, #7)
  - [x] Add:
        `#[tauri::command(rename_all = "snake_case")] pub fn confirm_project_allocations(state: State<DbState>, allocations: Vec<ProjectAllocationInput>) -> Result<Vec<ProjectContribution>, AppError>`
  - [x] Body, thin orchestration only: lock `state.0` with the standard `.map_err(|e| AppError::Database { .. })?` idiom → `let (figures, evaluation) = financial_health_db::evaluate_financial_health_waterfall(&conn)?;` → `let total: i64 = allocations.iter().map(|a| a.amount_cents).sum();` → `allocation::guard_confirmable(&evaluation.current_step, figures.avg_monthly_surplus_cents, total)?;` → `let created = projects_db::insert_suggested_contributions(&conn, &allocations)?;` → audit loop → `Ok(created)`
  - [x] Audit loop: for each created contribution, `audit_db::insert_audit_log(&conn, "project_contribution", contribution.id, "create", None, Some(&serde_json::to_string(&contribution).unwrap_or_default()))`, logging failures with `tracing::error!` rather than propagating — exactly the shape used in `commands/income.rs:129-139` and `commands/maintenance.rs:110-120`
  - [x] No SQL in the command (project rule 3). No write to `accounts`. No `source` parameter
  - [x] Register `commands::projects::confirm_project_allocations` in the `tauri::generate_handler![...]` list in `lib.rs`
  - [x] Sum the total from the **raw** `allocations` (before zero-filtering) so a user cannot exceed the cap by padding the list — zeros contribute nothing to a sum, so the two totals are identical, but state the intent in the code's ordering rather than relying on it

- [x] **Task 5 — Frontend mutation hook and invalidation** (AC: #9)
  - [x] Add `useConfirmProjectAllocations()` to `apps/desktop/src/hooks/useProjects.ts` (created by Story 31.1): `useMutation({ mutationFn: (allocations: ProjectAllocationInput[]) => invoke<ProjectContribution[]>("confirm_project_allocations", { allocations }), onSuccess: ... })`
  - [x] **Read `useCreateProjectContribution` (Story 31.2, extended by 31.3 and 31.4) and reuse its `onSuccess` invalidation block verbatim** — that is the definition of "the same cache invalidation as a manual contribution" in this story's AC. Do not re-derive the list from memory. As of Epic 31 that block is `queryKeys.projects`, `queryKeys.projectSavedTotals`, `queryKeys.projectContributions(project_id)`, `queryKeys.accountEarmarks(account_id)`, and `queryKeys.savingsProjectsSummary` — but **verify against the actual file**, because Epic 31's later stories append to it
  - [x] Add `queryClient.invalidateQueries({ queryKey: queryKeys.suggestedAllocation })` on top, because saved totals change `remaining_cents` and therefore the next suggestion
  - [x] The confirm payload spans **many** projects and possibly several accounts, whereas the manual hook handles one of each. Loop the returned contributions and invalidate `queryKeys.projectContributions(project_id)` for every distinct `project_id` and `queryKeys.accountEarmarks(account_id)` for every distinct `account_id` — not just the first entry's
  - [x] **Do not** invalidate `queryKeys.financialHealth*`. A contribution touches no account balance, no expense, and no income row, so `avg_monthly_surplus_cents` cannot have changed; invalidating it would trigger a pointless recompute and imply a data dependency that does not exist. Stories 31.1 and 31.2 make the same exclusion explicitly
  - [x] Add `ProjectAllocationInput` to `apps/desktop/src/lib/types.ts` mirroring the Rust field names exactly
  - [x] Hook test in `apps/desktop/src/hooks/__tests__/useProjects.test.tsx`, following `src/hooks/__tests__/useBudgetTemplates.test.tsx`: assert `invokeMock.mock.calls[0]` equals `["confirm_project_allocations", { allocations: [...] }]` (exact snake_case wire contract), assert the `invalidateQueries` spy was called for the projects key, the saved-totals key, the savings-summary key, the suggested-allocation key, and one earmark key per distinct account, and assert it was **not** called for `queryKeys.financialHealth`

- [x] **Task 6 — Wire confirm and skip into the panel** (AC: #1, #2)
  - [x] In `apps/desktop/src/components/projects/SuggestedAllocationPanel.tsx` (created by Story 32.3), fill the `footer` slot with a source-account selector. This is **required, not optional**: `project_contributions.account_id` is `INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT`, so a contribution cannot exist without an account. One selector applies to the whole batch. Reuse the **inline** account `Select` that Story 31.2 built inside `components/projects/ProjectContributionForm.tsx` so the two contribution paths look and behave identically — and specifically **do not** use `components/shared/OptionalAccountSelect.tsx`, which prepends a `{ value: "", label: t("common.none") }` option that is invalid for a `NOT NULL` column (Story 31.2 documents exactly this exclusion)
  - [x] Disable confirm until an account is selected, alongside the existing FR7 total check from Story 32.3
  - [x] In `apps/desktop/src/routes/wealth.projects.tsx`, replace Story 32.3's placeholder `onConfirm` with `confirmAllocations.mutate(payload)`, where `payload` maps each draft to `{ project_id, account_id, amount_cents, date }` with `date` = today as `YYYY-MM-DD` (use `date-fns` `format`, already a dependency)
  - [x] `onSkip` stays exactly as Story 32.3 left it — **local dismissal only, no `invoke()` of any kind** (AC #2). Do not add a "skipped" flag, a dismissal record, a config key, or a zero-amount row. Skipping must be indistinguishable from never opening the panel, at the database level
  - [x] On mutation success, dismiss the panel and show `toast.success(...)`; on error, keep the drafts intact and surface the `AppError` message so an over-cap or stale-gate rejection is explainable (`sonner` is already a dependency; `src/components/shared/InlineEdit.tsx` is the in-repo toast precedent)
  - [x] Set the confirm control's `disabled` from `isSubmitting` too, so a double-click cannot submit twice

- [x] **Task 7 — i18n** (AC: #1, #2)
  - [x] Add the keys from Dev Notes → "i18n keys" to **both** `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json` in the same change, in the flat `projects.*` namespace
  - [x] Add them to `REQUIRED_KEYS` in `apps/desktop/src/locales/__tests__/projects-i18n.test.ts`

- [x] **Task 8 — Playwright coverage** (AC: #1, #2, #9)
  - [x] In `apps/desktop/tests/projects.spec.ts` (created or extended by Stories 31.1 / 31.2 / 32.3), add a `confirm_project_allocations` case to the invoke switch mock that appends to the spec's in-memory contribution array and returns the created rows. `get_accounts` is needed by the account selector — Story 31.2 already adds that case for `ProjectContributionForm`; verify it is present. Any unmocked command falls through to `default: Promise.reject("Unknown command: ...")`
  - [x] `confirm_project_allocations` is only ever invoked by a user gesture, never on page load, so `apps/desktop/tests/nav-qa.spec.ts` needs no new case from this story (Stories 31.1-31.2 and 32.3 own its load-time cases for `/wealth/projects`)
  - [x] Test: edit an amount, pick an account, confirm → the mock records exactly one `confirm_project_allocations` call whose payload has one entry per non-zero project with the edited amounts, and the project list reflects the new saved totals after refetch
  - [x] Test (AC #2, the important one): open the panel, edit amounts, click skip → the recorded invoke log contains **no** `confirm_project_allocations` and **no** `create_project_contribution`, and the in-memory contribution array is still empty
  - [x] Test: confirm is disabled until an account is selected
  - [x] Test: a `confirm_project_allocations` mock that rejects with an `AppError`-shaped validation object leaves the drafts on screen and surfaces the message
  - [x] Only `tests/projects.spec.ts` needs the new mock cases — everything in this story lives inside the `/wealth/projects` route, so the always-mounted-component mock trap at `docs/project-context.md:295` does not apply

- [x] **Task 9 — Verification** (AC: all)
  - [x] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` green, including the new `db/projects.rs` and `projects/allocation.rs` tests
  - [x] `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` — zero new warnings
  - [x] `pnpm --filter @nixus/desktop test`, `pnpm --filter @nixus/desktop exec tsc --noEmit`, and `pnpm --filter @nixus/desktop exec playwright test projects` all green
  - [x] Grep this story's full diff for `UPDATE accounts`, `balance_cents`, and `'manual'` and confirm zero hits
  - [x] Grep the finished `commands/projects.rs` and confirm that `INSERT`, `UPDATE`, and `DELETE` appear in **no** command and that `insert_audit_log` appears in no `get_*` command
  - [x] Confirm no new migration, no `MIGRATIONS` change, no new crate, no new npm package

## Dev Notes

### What this story is, in one sentence

The single, guarded, audited, transactional write path for suggested allocations — plus a proof that skipping writes nothing.

### The write-path monopoly is the whole point

> *"Suggestion flow is read/write-separated: `get_suggested_allocation` is a pure query (zero writes, satisfies NFR4 directly); only `confirm_project_allocations` writes. This separation is the one process rule specific to this feature and must not be collapsed into a single command."*
> [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Process Patterns`]

> **Anti-pattern to avoid:** *"A `confirm_project_allocations` implementation that also updates `accounts.balance_cents` 'for convenience' — this would violate the PRD's core no-real-money-movement constraint and NFR2/SC2."*
> [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Enforcement Guidelines`]

Concretely, the following are all forbidden in this story, and Task 9's greps are how you prove they are absent:

- Any `UPDATE accounts` or any write to `balance_cents`, anywhere (AC #3, SC2).
- A `source` parameter on `ProjectAllocationInput`, or a `source` value drawn from user input (AC #10). `'suggested'` is a SQL literal in one `INSERT` statement in one function.
- A second write path: no "auto-confirm", no "apply on view", no persisted draft, no dismissal record, no config flag written on skip.
- Any write inside `get_suggested_allocation` (AC #8, Story 32.2's contract).

SC5 states the acceptance bar bluntly: *"100% of suggested contributions require explicit confirm action to persist a `project_contributions` row"* [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#2. Success Criteria`].

### Layering — three functions, three responsibilities

```
commands/projects.rs::confirm_project_allocations   ← lock, orchestrate, audit  (no SQL, no math)
  ├─ db/financial_health.rs::evaluate_financial_health_waterfall   (existing, read-only, unmodified)
  ├─ projects/allocation.rs::guard_confirmable                      (pure: step gate + inclusive cap)
  └─ db/projects.rs::insert_suggested_contributions                 (all SQL, one transaction)
```

This split exists so every rule is testable at the cheapest possible layer: the gate and cap in a pure unit test with no DB, the row semantics in an in-memory SQLite test with no Tauri `State`, and the command left as five lines of glue that needs no test of its own. It also keeps `docs/project-context.md` rule 3 satisfied — commands orchestrate, `db/` owns SQL.

`guard_confirmable` lives in `projects/allocation.rs` rather than `db/projects.rs` because it is pure policy over injected scalars, exactly like the rest of that module. It is the one function in that file that returns a `Result`, which is fine: `compute_suggested_allocation` cannot fail, but a rejected confirmation is a real, user-facing validation error.

### The inclusive cap must match the frontend exactly

FR7's test criterion is *"UI blocks confirm if edited total **exceeds** surplus amount"* [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements`], and the architecture notes `AppError::validation` covers *"if edited suggestion total exceeds surplus"* [Source: `#API & Communication Patterns`]. So both sides use the same comparison:

```
total <= avg_monthly_surplus_cents   → allowed   (equality allowed)
total >  avg_monthly_surplus_cents   → AppError::Validation
```

Story 32.3's `validateAllocationTotal` in `src/lib/allocation.ts` implements the client half with the same boundary and is unit-tested for `total == surplus`. If these two drift, the UI enables a confirm the backend then refuses. `guard_confirmable`'s boundary tests are the backend half of that contract.

Note that the surplus can legitimately change between the fetch that populated the panel and the confirm (a new expense or income entry landing in between). In that case the server-side check is the authority and the user sees the validation message — that is correct behaviour, not a bug, and it is why the check is not merely a client concern.

### Why the confirm path also re-checks the waterfall gate (AC #7)

FR6 forbids the app from *proposing* discretionary savings before the safety net is covered; FR8 makes confirmation the only way a `source = "suggested"` row comes into existence. Together they mean a `"suggested"` row should only ever exist for an allocation the app was willing to suggest. Re-checking the step in the confirm command closes the window where the user's step changed after the panel was rendered (a large new credit-card balance, for example), and makes the write path independently safe rather than trusting that the caller only ever got here through a legitimate suggestion. The check costs one already-needed read: the command must load the financial-health figures anyway to enforce the cap.

### Zero and empty are no-ops, not errors (AC #4)

A user who zeroes every amount and presses confirm has effectively skipped. Returning `Ok(vec![])` rather than an error keeps FR8's guarantee (*"skipping creates none"*) true through both routes, avoids an error message that would read as a bug, and keeps the truth table simple:

| Input | Rows created | Audit rows | Result |
| --- | --- | --- | --- |
| Skip (no call) | 0 | 0 | — |
| `[]` | 0 | 0 | `Ok([])` |
| all `amount_cents == 0` | 0 | 0 | `Ok([])` |
| mixed zero / non-zero | one per non-zero | one per created row | `Ok([...])` |
| any invalid entry | **0** | 0 | `Err(Validation)` |
| total over cap | 0 | 0 | `Err(Validation)` |
| gated-out step | 0 | 0 | `Err(Validation)` |

Zero-amount entries are filtered before validation, so a zero row is never rejected for being "not positive" — note the divergence from `db/expense.rs:236-241`, which rejects `amount_cents <= 0` outright. Here only *negative* is invalid; zero means "skip this project".

### Precedents to mirror, exactly

**Batch write with upfront validation** — `db/expense.rs::bulk_insert_imported_expenses` (`:224-273`) is the structural template: validate every row in a loop first (including existence checks against referenced tables, with the 1-based row index in the message), *then* `conn.unchecked_transaction()`, insert in a loop, `tx.commit()`. Note that it pre-checks the referenced category's existence rather than letting the foreign key fail — do the same for `account_id` and `project_id`, so the user gets `AppError::Validation` with a `field`, not an opaque `AppError::Database`.

**Audit on a mutation** — `commands/income.rs::create_income_entry` (`:109-139`) and `commands/maintenance.rs::update_vehicle` (`:90-123`): serialise the entity with `serde_json::to_string(&result).unwrap_or_default()`, call `audit_db::insert_audit_log`, and on failure `tracing::error!("Failed to write audit log: {}", e)` **without** failing the user's operation. The signature is fixed:
```rust
insert_audit_log(conn, entity_type, entity_id: i64, action, old_value: Option<&str>, new_value: Option<&str>)
```
[Source: `apps/desktop/src-tauri/src/db/audit.rs:5-18`]. For a create, `old_value` is `None`.

**Per-row audit, not a batch summary.** `commands/import.rs:431-433` writes a single audit row with `entity_id = 0` and a JSON count summary for a whole import batch. Do **not** copy that here: the architecture requires `entity_type = "project_contribution"` audit rows for contribution mutations, and the epic's AC says *"an audit log entry is written for each"* [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Story 32.4`]. Per-row rows keep `audit_log.entity_id` joinable back to the contribution.

**Thin command** — `commands/financial_health.rs:8-21` for the `State<DbState>` lock idiom and the delegate-immediately shape.

### Cache invalidation — copy Story 31.2's block, then add one key

The epic's AC is *"confirming triggers the same dashboard/project-list cache invalidation as a manual contribution"* and the architecture spells the set out: *"every contribution mutation's `onSuccess` invalidates `projects`, `project(id)`, `accountEarmarks(accountId)`, and the dashboard's savings-summary query key"* [Source: `#Process Patterns`]. Rather than re-deriving that list, **open `src/hooks/useProjects.ts`, read `useCreateProjectContribution`, and reuse its `onSuccess` body**, then add `queryKeys.suggestedAllocation`. This guarantees the two paths cannot drift and honours the exact wording of the AC.

As of Epic 31 the concrete keys are `projects`, `projectSavedTotals` (31.2), `projectContributions(projectId)` (31.2), `accountEarmarks(accountId)` = `["account-earmarks", accountId]` (31.3), and `savingsProjectsSummary` = `["savings-projects-summary"]` (31.4) — Epic 31's later stories deliberately append to that same `onSuccess` block, so read the file rather than trusting this list. Because this command writes across many projects and possibly several accounts, loop the returned rows and invalidate the per-id keys for every distinct `project_id` and `account_id`.

Two deliberate boundaries on that set:
- **Add `suggestedAllocation`** — new saved totals shrink `remaining_cents` and therefore change the next suggestion, and Story 32.1 already invalidates the same key on reorder.
- **Do not add `financialHealth*`** — a contribution writes only to `project_contributions`. `avg_monthly_surplus_cents` derives from `income_entries` and `expenses` (`db/financial_health.rs:42-70`), neither of which this story touches, so the surplus is provably unchanged. Stories 31.1 and 31.2 make the same exclusion explicitly, for the same reason: invalidating those keys would assert in code that this feature moves money.

`queryKeys` lives only in `src/lib/constants.ts` and must never be inlined in a hook (project rule 6).

### The source-account selector is forced by the schema, not invented scope

FR7 mentions only editing amounts, but `project_contributions.account_id` is `INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Architecture`], so a contribution physically cannot be written without an account. The suggestion payload from Story 32.2 carries no account (the allocation algorithm has no opinion about which account holds the money), so the confirm step must collect one. One selector for the whole batch is the minimum viable answer and matches the manual path's shape — FR3 has the user *"specifying a source account and amount"* per contribution, and Story 31.2 already ships that control in `ProjectContributionForm.tsx`. Reuse it; do not build a second account picker, and do not silently default to the first account (silently attributing money to an account the user did not choose is exactly the trust failure this feature is designed to avoid).

Related NFR3 interaction, for awareness only — no work here: once a suggested contribution exists, the `ON DELETE RESTRICT` FK blocks deleting that account, which Story 31.5 surfaces as a specific error. This story adds rows that participate in that guard but changes nothing about it.

### i18n keys

| Key | EN | FR |
| --- | --- | --- |
| `projects.suggestionAccountLabel` | `Where is this money sitting?` | `Où se trouve cet argent ?` |
| `projects.suggestionAccountRequired` | `Pick the account holding this money to continue.` | `Choisissez le compte qui détient cet argent pour continuer.` |
| `projects.suggestionConfirmed` | `Earmarked across {{count}} goal(s). No money was moved.` | `Réservé pour {{count}} objectif(s). Aucun argent n'a été déplacé.` |
| `projects.suggestionConfirmFailed` | `Nothing was saved. {{message}}` | `Rien n'a été enregistré. {{message}}` |
| `projects.suggestionSkipped` | `Skipped. Nothing was saved.` | `Passé. Rien n'a été enregistré.` |

The "No money was moved" clause is product-required, not decoration: the PRD's core promise is that earmarking never moves real money and account balances never change (SC2, and `#3. Product Scope`'s "without moving real money"). Both locale files change in the same commit; `projects-i18n.test.ts` fails CI on a one-sided key and guards `{{count}}` / `{{message}}` placeholder preservation.

### Dependencies — the exact names to build against

| Artefact | Owner | Exact name |
| --- | --- | --- |
| Tables + `source` CHECK | 31.1 | `projects`, `project_contributions` (migration `025_projects.sql`) |
| Models | 31.1 | `Project`, `ProjectContribution`, `CreateProjectContributionInput` |
| db functions | 31.1-31.3 | `get_active_projects`, `insert_project_contribution`, `delete_project_contribution`, `get_project_saved_cents`, `get_account_earmark_breakdown` |
| Commands | 31.1-31.3 | `get_projects`, `create_project_contribution`, `delete_project_contribution`, `get_account_earmark_breakdown` |
| Hooks | 31.1-31.4 | `useCreateProjectContribution`, `useDeleteProjectContribution`, `useProjectSavedTotals`, `useAccountEarmarkBreakdown` |
| Query keys | 31.1-31.4 | `projects`, `project(id)`, `projectSavedTotals`, `projectContributions(id)`, `accountEarmarks(id)`, `savingsProjectsSummary` |
| Account select | 31.2 | inline `Select` inside `ProjectContributionForm.tsx` (**not** `OptionalAccountSelect`) |
| Pure allocation module | 32.2 | `projects/allocation.rs`, `compute_suggested_allocation`, `AllocationProject`, `get_active_allocation_projects`, `ProjectAllocationSuggestion`, `queryKeys.suggestedAllocation` |
| Panel | 32.3 | `components/projects/SuggestedAllocationPanel.tsx` with its `footer` slot, `onConfirm`, `onSkip`, `isSubmitting` props; `src/lib/allocation.ts`'s `validateAllocationTotal` |

**Hard ordering dependency:** this story cannot land before 32.2 (it calls `guard_confirmable`'s module and needs the suggestion payload) or before 32.3 (it wires that panel's callbacks). It is independent of 32.1.

### Explicitly out of scope

No migration and no `MIGRATIONS` change — `migrations/025_projects.sql` and its `source` `CHECK` constraint already exist from Story 31.1. No change to `db/financial_health.rs`, `financial_health/evaluator.rs`, or `db/account.rs`. No change to `compute_suggested_allocation` itself (Story 32.2 owns it; this story only *adds* `guard_confirmable` to the same file). No `reorder_projects` work (Story 32.1). No new panel layout (Story 32.3 owns the panel; this story fills its `footer` slot and wires its callbacks). No delete path for suggested contributions — Story 31.2's `delete_project_contribution` already covers deleting any contribution regardless of `source`. No dashboard nudge. No AI-chat awareness of projects (PRD Growth phase). No new crate, no new npm package, no write to `accounts.balance_cents` from any path.

### Project Structure Notes

```
apps/desktop/src-tauri/src/
├── models/mod.rs                # MODIFIED: + ProjectAllocationInput (no `source` field)
├── projects/allocation.rs       # MODIFIED (created 32.2): + guard_confirmable() + its tests
├── db/projects.rs               # MODIFIED (created 31.1): + insert_suggested_contributions()
│                                #   + batch/validation/atomicity/SC2 tests + NFR4 tie-back test
├── commands/projects.rs         # MODIFIED (created 31.1): + confirm_project_allocations
└── lib.rs                        # MODIFIED: register commands::projects::confirm_project_allocations

apps/desktop/src/
├── lib/types.ts                 # MODIFIED: + ProjectAllocationInput
├── hooks/useProjects.ts         # MODIFIED (created 31.1): + useConfirmProjectAllocations()
├── components/projects/SuggestedAllocationPanel.tsx  # MODIFIED (created 32.3): account selector
│                                                     #   in the footer slot; confirm gating
├── routes/wealth.projects.tsx   # MODIFIED (created 31.1/32.3): confirm mutation wiring;
│                                #   onSkip stays a local dismissal with no invoke()
└── locales/en.json, fr.json     # MODIFIED: 5 new projects.suggestion* keys, both files

apps/desktop/src/hooks/__tests__/useProjects.test.tsx     # MODIFIED: confirm wire-contract +
                                                          #   invalidation (incl. negative) tests
apps/desktop/src/locales/__tests__/projects-i18n.test.ts  # MODIFIED: + REQUIRED_KEYS
apps/desktop/tests/projects.spec.ts                       # MODIFIED: 2 mock cases, 4 tests
```

**Nothing is newly created by this story** — every file is an addition to a file Story 31.1, 31.2, 32.2, or 32.3 already created. `migrations/`, `db/mod.rs`, `db/audit.rs`, `db/account.rs`, `db/financial_health.rs`, `financial_health/**`, `Cargo.toml`, `package.json`, `tauri.conf.json`, `src/lib/navigation.ts`, `src/components/dashboard/**`, and every spec other than `tests/projects.spec.ts` are untouched.

**No variance from the architecture.** `confirm_project_allocations(allocations: Vec<ProjectAllocationInput>)` is the signature the architecture specifies verbatim [Source: `#API & Communication Patterns`]. The one addition beyond the architecture's explicit text is `guard_confirmable` as a separately-testable pure function; the architecture already requires both checks it performs (the FR6 step gate as the reason `"suggested"` rows exist at all, and the `AppError::validation` on an over-surplus total), so this is a placement decision, not new behaviour.

### References

- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Story 32.4: Confirm or skip a suggested allocation` — acceptance criteria, copied faithfully]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Requirements Inventory` — FR8, NFR4]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Additional Requirements` — audit log on every mutation with `entity_type = "project_contribution"`; invalidate all affected `queryKeys`]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements` — FR8: one row per project with `source = suggested`, skipping creates none, no writes without explicit confirmation; FR7's inclusive cap wording]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#2. Success Criteria` — SC2: account balance never changes as a side effect; SC5: 100% of suggested contributions require explicit confirmation]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#9. Non-Functional Requirements` — NFR2 integer cents; NFR3 account-deletion guard context; NFR4 nothing persists before confirmation]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#1. Executive Summary`, `#3. Product Scope` — no real money movement; always user-confirmed, never a silent auto-transfer]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#API & Communication Patterns` — `confirm_project_allocations(allocations: Vec<ProjectAllocationInput>)` is the only write path for suggestions; `AppError::validation` when the edited total exceeds the surplus]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Process Patterns` — audit logging mandatory incl. `confirm_project_allocations`; read/write separation; invalidate `projects`, `project(id)`, `accountEarmarks(accountId)`, dashboard savings key]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Enforcement Guidelines` — never write `accounts.balance_cents`; never let a `get_*` command write; all SQL in `db/projects.rs`; the "convenience balance update" anti-pattern]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Architecture` — `project_contributions` schema: `account_id NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT`, `source TEXT NOT NULL CHECK (source IN ('manual','suggested'))`, ISO 8601 `date`]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Boundaries` — `project_contributions.account_id` is a read-only reference into `accounts`, never a write]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Error handling` — standard `AppError`, no new variants needed]
- [Source: `docs/project-context.md#2. Tauri IPC Commands` / `#Tauri IPC` — `rename_all = "snake_case"`, `Result<T, AppError>`, `State<DbState>` lock idiom, `invoke` arg names must match Rust params, register in `lib.rs`]
- [Source: `docs/project-context.md#3. Database Operations Belong in db/ Only` — lock → db call → audit log → return; audit on every create/update/delete]
- [Source: `docs/project-context.md#4. Rust Model Structs` — derive set, `snake_case` fields, ISO 8601 dates, `Create<Domain>Input` naming, models in `models/mod.rs`]
- [Source: `docs/project-context.md#5. Error Handling (AppError)` — use the existing enum; `validation` / `database` variants only]
- [Source: `docs/project-context.md#6. TanStack Query Keys` — keys only in `lib/constants.ts`; every mutation invalidates ALL affected keys]
- [Source: `docs/project-context.md#Anti-Patterns to Avoid` — no SQL in commands, no skipped audit log, no floats for money, no hardcoded query keys]
- [Source: `docs/project-context.md#Testing Rules` — Vitest hook tests via `createRoot`/`act`; Playwright against a stubbed `invoke`; the always-mounted-component mock trap at line 295]
- [Source: `apps/desktop/src-tauri/src/db/expense.rs:224-273` — batch insert: validate all rows first with indexed `AppError::Validation`, pre-check referenced ids, then `unchecked_transaction` + loop + `commit`]
- [Source: `apps/desktop/src-tauri/src/db/expense.rs:236-241` — the `amount_cents <= 0` rejection this story deliberately diverges from (zero is a skip, not an error)]
- [Source: `apps/desktop/src-tauri/src/db/audit.rs:5-18` — `insert_audit_log` signature]
- [Source: `apps/desktop/src-tauri/src/commands/income.rs:109-139` — create-command shape: db call → `serde_json::to_string` → audit → `tracing::error!` on audit failure]
- [Source: `apps/desktop/src-tauri/src/commands/maintenance.rs:90-123` — mutation-command audit shape with old/new JSON]
- [Source: `apps/desktop/src-tauri/src/commands/import.rs:390-440` — batch confirm command taking a `Vec` of inputs; its `entity_id = 0` batch audit row is the rejected alternative here]
- [Source: `apps/desktop/src-tauri/src/commands/financial_health.rs:8-21` — thin command + `State<DbState>` lock idiom]
- [Source: `apps/desktop/src-tauri/src/db/financial_health.rs:42-70` — `avg_monthly_surplus_cents` derives from income/expense aggregates only, hence no financial-health invalidation on contribution]
- [Source: `apps/desktop/src-tauri/src/db/financial_health.rs:247-261` — `evaluate_financial_health_waterfall` returns `(figures, evaluation)` for the gate and cap]
- [Source: `apps/desktop/src-tauri/src/db/financial_health.rs:332-375` — in-memory SQLite `setup_test_db()` pattern with `PRAGMA foreign_keys=ON`]
- [Source: `apps/desktop/src-tauri/src/financial_health/evaluator.rs:5-12` — `WaterfallStep` variants used by `guard_confirmable`]
- [Source: `apps/desktop/src-tauri/src/lib.rs` — flat `tauri::generate_handler![...]` registration list]
- [Source: `apps/desktop/src-tauri/Cargo.toml:25,29` — `rusqlite 0.38` (bundled only), `chrono 0.4` for date validation]
- [Source: `apps/desktop/src/hooks/useFinancialHealth.ts` — `useMutation` + `invoke` + `onSuccess` invalidation shape]
- [Source: `apps/desktop/src/lib/constants.ts:1-70` — flat kebab-case `queryKeys` object]
- [Source: `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` — `createRoot`/`act` harness, exact `invoke.mock.calls[0]` tuple assertions, `invalidateQueries` spy including `not.toHaveBeenCalled()` negatives]
- [Source: `apps/desktop/tests/accounts.spec.ts:3-158` — `page.addInitScript` invoke switch mock with an in-memory store and `default: Promise.reject("Unknown command")`]
- [Source: `apps/desktop/src/components/shared/InlineEdit.tsx` — `sonner` toast usage precedent]
- [Source: `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` — `REQUIRED_KEYS` + parity + placeholder + orphan-key test template]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` → **560 passed; 0 failed** (up from 537: +7 `guard_confirmable` tests, +11 `insert_suggested_contributions` tests, +5 pre-existing suite growth reconciled). `db::projects` alone: 73 passed.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` → 1 warning, pre-existing and unrelated (`explicit_auto_deref` at `commands/backup.rs:106`). **Zero new warnings.**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` → clean, no output.
- `pnpm --filter @nixus/desktop test` (vitest) → **14 files, 228 passed** (was 223; +5 `useConfirmProjectAllocations` tests).
- `pnpm --filter @nixus/desktop exec playwright test` → **441 passed, 1 failed**; the single failure is `maintenance.spec.ts:1640 "escape cancels edit without saving"`, which **passes in isolation** (verified: `1 passed (2.1s)`) and touches no file in this story — parallel-load flake, not a regression. All 21 `tests/projects.spec.ts` tests pass.
- TDD order was observed per task: the `guard_confirmable` tests were run and confirmed failing with `cannot find function guard_confirmable in this scope` before the function existed; the `insert_suggested_contributions` tests likewise failed with `cannot find function insert_suggested_contributions` before the db function existed.

### Completion Notes List

**Write-path monopoly (AC #1, #3, #10)**
- `insert_suggested_contributions` is the only function that writes a `source = 'suggested'` row, and `'suggested'` is a SQL literal inside its single `INSERT`. `ProjectAllocationInput` has no `source` field, so the value cannot be supplied over IPC.
- Verified by grep across every file this story touched: zero hits for `UPDATE accounts` and zero hits for any `balance_cents =` assignment. `balance_cents` appears only in *read* assertions inside the new SC2 test.
- `commands/projects.rs` contains zero `INSERT` / `UPDATE` / `DELETE` occurrences, and no `get_*` command calls `insert_audit_log`.

**Deviation 1 — removed the forgeable `source` parameter from `create_project_contribution`.** Story 31.2 shipped that command with `source: Option<String>` defaulting to `"manual"`, explicitly so Epic 32 could pass `"suggested"` through it. Now that this story provides the real write path, that parameter was a second, unguarded way to mint a `"suggested"` row — it bypasses `guard_confirmable`, the FR7 cap and the FR6 step gate entirely. It is now hard-coded to `"manual"` in the command. Nothing sends `source` (the TS `CreateProjectContributionInput`, the hook, and every spec omit it), so this is a pure narrowing with no caller impact. This is why Task 9's `'manual'` grep has one intentional hit.

**Deviation 2 — replaced the panel's `footer?: React.ReactNode` prop instead of passing content into it.** Task 6 says to "fill the `footer` slot with a source-account selector". Story 32.3 created that prop as a placeholder and no caller ever passed it. Rather than keep a now-dead prop and inject the selector from the route, the panel renders the selector itself at exactly that position and owns the `accountId` state beside the existing `drafts` state, and the prop is gone. Consequence: the panel now calls `useAccounts()`, and `onConfirm` carries `account_id` per entry via the exported `SuggestedAllocationDraft` type.

**Deviation 3 — the confirm payload carries every reviewed project, including zero-amount entries.** Task 6 says the route "maps each draft", and AC #4 exists precisely to define the server behaviour for all-zero and mixed-zero payloads — both only make sense if zeros reach the backend. Task 8's phrase "one entry per non-zero project" is therefore read as being about the *rows created*, not the wire payload: the Playwright test `"a zeroed amount creates no row for that project"` asserts exactly that (payload of two, one stored row). The db layer filters zeros before validating, so a zero is never rejected for being non-positive.

**Deviation 4 — updated four Story 32.3 Playwright tests.** `"a total exactly equal to the surplus leaves confirm enabled"`, `"exceeding the surplus disables confirm…"`, `"setting one amount to zero keeps confirm enabled"` and `"editing amounts invokes no write command at all"` asserted confirm's enablement from the total alone. Task 6 adds the source account to that gate (the column is `NOT NULL`), so each now selects the account first and continues to test only the FR7 boundary it was written for. This is an intentional behaviour change, not a weakened test.

**Skipping writes nothing (AC #2).** `onSkip` is a local `setSuggestionSkipped(true)` plus a toast — no `invoke` of any kind, no dismissal record, no config key, no zero-amount row. The regression test asserts all four negatives at once: the recorded invoke log contains neither `confirm_project_allocations` nor `create_project_contribution`, the exposed confirm-payload array is empty, and the mock's contribution store is still `[]` after amounts were edited *and* an account was picked.

**NFR4 regression (AC #8).** `the_suggestion_read_stays_inert_after_a_confirm_has_written_rows` populates the DB *through the new write path*, then runs `get_active_allocation_projects` + `compute_suggested_allocation` five times and asserts the contribution count, the project/priority checksum, the account balance and every source value are unchanged, and all five results are identical. This is the tie-back proving the read path did not become a write path now that one exists beside it.

**Cache invalidation (AC #9).** Rather than copy Story 31.2's `onSuccess` body and risk drift, `invalidateContributionKeys` was widened from one contribution to a list: the shared keys (`projects`, `projectSavedTotals`, `savingsProjectsSummary`) fire once per mutation, and `projectContributions(id)` / `accountEarmarks(id)` fire once per *distinct* id. The manual create and delete hooks now pass `[input]` / `[deleted]`, so all three paths provably share one implementation. `suggestedAllocation` is added by the confirm hook only. `financialHealth*` is deliberately never invalidated, and a test asserts that negative.

**Accepted size debt.** `commands/projects.rs` is 257 pure LOC, just over the 250 ceiling. It is a flat registry of independent thin IPC handlers, one per endpoint; `docs/project-context.md` rule 3 mandates one `commands/{feature}.rs` per domain, and this story's Project Structure Notes name this exact file. It remains smaller than the existing `income.rs` (274) and `maintenance.rs` (263). Splitting the whole epic's command surface in its final story would be a larger, riskier change than the debt it repays, so it is recorded here instead.

**Confirmed out of scope, verified untouched:** no new migration, no `MIGRATIONS` change, no new crate, no new npm package, no change to `db/financial_health.rs`, `financial_health/**`, `db/audit.rs`, `db/account.rs`, or `compute_suggested_allocation` itself.

### File List

**Modified — Rust (`apps/desktop/src-tauri/`)**
- `src/models/mod.rs` — added `ProjectAllocationInput` (no `source` field)
- `src/projects/allocation.rs` — added `guard_confirmable()` + 7 tests
- `src/db/projects.rs` — added `insert_suggested_contributions()` and `validate_suggested_allocations()` + 11 tests (batch, zero/empty no-op, negative, duplicate, unknown/archived project, unknown account, malformed date, atomicity, SC2, NFR4 tie-back)
- `src/commands/projects.rs` — added `confirm_project_allocations`; hard-coded `"manual"` in `create_project_contribution` (removed its `source` parameter)
- `src/lib.rs` — registered `commands::projects::confirm_project_allocations`

**Modified — Frontend (`apps/desktop/src/`)**
- `lib/types.ts` — added `ProjectAllocationInput`
- `hooks/useProjects.ts` — added `useConfirmProjectAllocations()`; widened `invalidateContributionKeys` to a list
- `components/projects/SuggestedAllocationPanel.tsx` — source-account selector in the footer position, `SuggestedAllocationDraft` export, confirm gated on account + total + `isSubmitting`, `footer` prop removed
- `routes/wealth.projects.tsx` — confirm wired to the mutation with today's date; skip stays a local dismissal
- `locales/en.json`, `locales/fr.json` — 5 new `projects.suggestion*` keys in both files

**Modified — Tests**
- `apps/desktop/src/hooks/__tests__/useProjects.test.tsx` — 5 confirm tests (wire contract incl. no-`source` assertion, shared+suggested invalidation, per-distinct-id keys, `financialHealth` negative, nothing invalidated on rejection)
- `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` — 5 keys added to `REQUIRED_KEYS`, 2 to the placeholder-parity list
- `apps/desktop/tests/projects.spec.ts` — `confirm_project_allocations` mock case, `__CONFIRM_CALLS__` / `__CONTRIBUTIONS__` test globals, 5 new tests, 4 Story 32.3 tests updated for the account gate

