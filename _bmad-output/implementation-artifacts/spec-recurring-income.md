---
title: 'Recurring income templates'
type: 'feature'
created: '2026-08-10'
status: 'done'
baseline_commit: '50cb155c1609df8161a1c2f2272ef453514caacc'
context: ['{project-root}/docs/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Recurring *expenses* auto-apply on launch, but predictable income (paycheque, rent received) must be entered by hand every month, so cash-flow views drift out of date until the user remembers.

**Approach:** Add a `recurring_income_templates` table mirroring the expense template pattern — scheduled against an existing income source, with an optional linked account — applied by the same launch-time backfill. Surface it in the existing `/spending/recurring` page as **two summary boxes** (money out, money in) above **one combined list** where each row carries an expense/income badge.

## Boundaries & Constraints

**Always:**
- Money as `i64` cents, fields suffixed `_cents`. Dates are `String` ISO `YYYY-MM-DD`.
- Applying a template creates rows through `income_db::insert_income_entry`, so account-balance adjustment, source validation, and `month` derivation stay in one place.
- Backfill on launch: every occurrence from the template's `created_at` date through today, skipping occurrences that already exist. Never create future-dated entries.
- Applied occurrences have a persistent identity: `income_entries` carries the `recurring_income_template_id` that created it. Skip an occurrence when **either** a row already exists for that template in that month, **or** a row already exists with the same `source_id` + `date` + `amount_cents` (which is how a manually recorded paycheque claims its month).
- Editing a template's amount, day, or source must never re-create occurrences it has already applied.
- `day_of_month` above the month's length clamps to the last day (reuse the expense helpers).
- Every create/update/delete writes an audit log entry.
- All user-facing strings via i18next, added to **both** `en.json` and `fr.json`.

**Ask First:**
- Any change to the `expenses`/`recurring_expense_templates` schema or to expense apply semantics.
- Removing or renaming existing `recurring.*` i18n keys or `data-testid` values that E2E specs rely on.

**Never:**
- No new income "type" concept — reuse existing `income_sources`.
- No recurrence beyond monthly (no weekly/biweekly/custom cadence).
- No editing of the recurring-expense flow beyond making its date helpers reusable and its list component render both kinds.
- No AI/chat tool integration for recurring income.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Backfill past occurrences | Template created 2026-01-01, day 15, today 2026-03-20 | 3 income entries: 01-15, 02-15, 03-15 | N/A |
| Occurrence before creation | Template created 2026-02-15, day 15, today 2026-03-20 | Entries for 02-15 and 03-15 only; nothing in January | N/A |
| Future day this month | Template created 2026-03-01, day 25, today 2026-03-20 | No entry created | N/A |
| Duplicate already recorded | Manual entry exists for same source/date/amount | That occurrence skipped; other months still created | N/A |
| Template amount edited | Template applied Jan–Mar at $2,500, amount changed to $2,600, app relaunched | No new entries for Jan–Mar; no further balance movement | N/A |
| Template day edited | Template applied on day 15, day changed to 20, app relaunched | No second entry for an already-applied month | N/A |
| Short month clamp | day 31, February 2026 | Entry dated 2026-02-28 | N/A |
| Account linked | Template with `account_id` on a chequing account | Entry created *and* account balance increased by `amount_cents` | Unknown account → `AppError::Validation` field `account_id` |
| Inactive template | `is_active = 0` | Skipped entirely by apply | N/A |
| Invalid input | `amount_cents <= 0`, or `day_of_month` outside 1–31 | Rejected before insert | `AppError::Validation` with matching `field` |
| Source deleted | Income source removed | Its recurring templates removed via `ON DELETE CASCADE` | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/migrations/` -- SQL migrations; latest is `022_budget_category_soft_delete.sql`
- `apps/desktop/src-tauri/src/db/mod.rs` -- `MIGRATIONS` array (`include_str!` + version number)
- `apps/desktop/src-tauri/src/db/recurring.rs` -- expense template CRUD + backfill; owns `clamp_day_to_month`, `last_day_of_month`, `next_month`, `parse_template_start_date` (currently private)
- `apps/desktop/src-tauri/src/db/income.rs` -- `insert_income_entry` (validates source/account, adjusts balances, derives `month`)
- `apps/desktop/src-tauri/src/db/danger_zone.rs` -- table list used by delete-all-data (line ~25)
- `apps/desktop/src-tauri/src/commands/recurring.rs` -- thin command layer + audit logging + startup `apply_due_recurring_expenses`
- `apps/desktop/src-tauri/src/lib.rs` -- startup background apply (~line 90, emits `recurring:applied`) and `invoke_handler` registration (~line 208)
- `apps/desktop/src-tauri/src/models/mod.rs` -- all structs; `RecurringExpenseTemplate` ~line 422, income models ~line 265
- `apps/desktop/src/routes/spending.recurring.tsx` -- page: header stat, auto-apply banner, list, add slide-over
- `apps/desktop/src/components/expenses/RecurringTemplateList.tsx` -- table, active toggle, delete dialog, edit slide-over
- `apps/desktop/src/components/expenses/{Add,Edit}RecurringTemplateForm.tsx` -- expense template form patterns
- `apps/desktop/src/components/income/AddIncomeEntryForm.tsx` -- source select + optional account select pattern (`AccountSelectField`, keys `income.accountOptional` / `income.accountLinkHelp`)
- `apps/desktop/src/hooks/useRecurringExpenses.ts`, `useIncome.ts` -- hook + invalidation patterns (`invalidateIncomeEntryMutationQueries`)
- `apps/desktop/src/lib/constants.ts` -- `queryKeys` (`recurringTemplates` line ~45)
- `apps/desktop/src/lib/types.ts` -- IPC types
- `apps/desktop/src/components/shared/RecurringApplyListener.tsx` -- listens for `recurring:applied`, invalidates caches
- `apps/desktop/src/locales/en.json`, `fr.json` -- **flat** dotted keys (e.g. `"recurring.title"`), full parity required
- `apps/desktop/tests/nav-qa.spec.ts` -- only spec mocking `get_recurring_templates`; its switch has a `default: Promise.resolve([])` fallback

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/migrations/023_recurring_income.sql` -- create `recurring_income_templates` (`id`, `source_id` → `income_sources` ON DELETE CASCADE, `amount_cents` CHECK > 0, `day_of_month` CHECK 1–31, `account_id` → `accounts` ON DELETE SET NULL, `is_active` default 1, `created_at`, `updated_at`) -- storage for the schedule
- [x] `apps/desktop/src-tauri/src/db/mod.rs` -- register migration `(23, include_str!(...))` -- migrations only run when listed
- [x] `apps/desktop/src-tauri/src/models/mod.rs` -- add `RecurringIncomeTemplate` (includes joined `source_name`, `income_type`), `CreateRecurringIncomeTemplateInput`, `UpdateRecurringIncomeTemplateInput` -- IPC contract
- [x] `apps/desktop/src-tauri/src/db/recurring.rs` -- widen the four date helpers to `pub(crate)` -- reuse instead of duplicating clamp/leap-year logic
- [x] `apps/desktop/src-tauri/src/db/recurring_income.rs` (new, add to `db/mod.rs`) -- CRUD + `apply_due_recurring_income(conn)` delegating to an `..._as_of(conn, today)` variant; inserts via `income_db::insert_income_entry` -- domain SQL stays in `db/`
- [x] `apps/desktop/src-tauri/src/db/recurring_income.rs` -- unit tests covering every I/O Matrix row (backfill, pre-creation skip, future skip, duplicate skip, clamp, account balance, inactive, validation) -- these are the regression net
- [x] `apps/desktop/src-tauri/src/db/danger_zone.rs` -- add `recurring_income_templates` to the wipe list (and its test fixture schema if present) -- delete-all-data must not leave orphans
- [x] `apps/desktop/src-tauri/src/commands/recurring_income.rs` (new, add to `commands/mod.rs`) -- `create/get/update/delete_recurring_income_template` + startup `apply_due_recurring_income`; audit entities `recurring_income_template` and `income_entry` -- commands orchestrate only
- [x] `apps/desktop/src-tauri/src/lib.rs` -- register the four commands; in the startup background block apply due income after due expenses and emit `recurring-income:applied` with the created count -- backfill runs on launch
- [x] `apps/desktop/src/lib/types.ts` + `apps/desktop/src/lib/constants.ts` -- add the three TS types and `recurringIncomeTemplates: ["recurring-income-templates"]` -- no hardcoded query keys
- [x] `apps/desktop/src/hooks/useRecurringIncome.ts` (new) -- list query + create/update/delete mutations; `onSuccess` invalidates `recurringIncomeTemplates` plus the income/account/financial-health keys used by `invalidateIncomeEntryMutationQueries` -- stale cards otherwise
- [x] `apps/desktop/src/components/income/{Add,Edit}RecurringIncomeForm.tsx` (new) -- source select, `MoneyInput`, day-of-month input, optional account select; Edit adds the active switch -- mirrors expense forms
- [x] `apps/desktop/src/components/expenses/RecurringTemplateList.tsx` -- accept both template arrays, merge into rows tagged `kind: "expense" | "income"`, add a leading type column rendering a `Badge` (`neutral` for expense, `good` for income), route row activation to the matching edit form, and report active counts per kind in the footer (money totals live in the summary boxes, not here) -- one combined list per the agreed UX
- [x] `apps/desktop/src/routes/spending.recurring.tsx` -- fetch both lists; replace the single summary card with **two side-by-side summary boxes** above the list — money out (committed each month, keeping `data-testid="recurring-committed-total"`) and money in (expected each month, `data-testid="recurring-expected-total"`), each captioned with its active template count and collapsing to stacked on narrow widths; add slide-over gains a `PillTabs` expense/income selector choosing which add form renders -- separates the two figures while keeping one entry point and one list
- [x] `apps/desktop/src/components/shared/RecurringApplyListener.tsx` -- also listen for `recurring-income:applied` and invalidate income, account, net-worth, and financial-health keys -- UI must reflect launch-time backfill
- [x] `apps/desktop/src/locales/en.json` + `fr.json` -- add the new `recurring.*` keys and retitle the page to cover both kinds; keep EN/FR key sets identical -- i18n is mandatory
- [x] `apps/desktop/src/locales/__tests__/recurring-i18n.test.ts` (new) -- assert EN/FR parity for all `recurring.*` keys, following the existing per-feature locale tests -- catches missed FR translations
- [x] `apps/desktop/tests/recurring-income.spec.ts` (new, added during implementation) -- Playwright coverage of add/list/toggle/edit/delete and the no-income-source case -- project standards require E2E for user-flow-shaped work
- [x] `apps/desktop/src-tauri/migrations/024_income_entry_recurring_template.sql` + `db/income.rs` + `db/recurring_income.rs` (added after review, option [B]) -- stamp `recurring_income_template_id` on generated entries and skip an occurrence when that template already claimed the month, keeping the source/date/amount check as the manual-entry claim -- an edit to a template's amount or day must not re-create applied months

**Acceptance Criteria:**
- Given an income source exists, when the user opens `/spending/recurring`, then two summary boxes show money out and money in, and below them a single list shows expense and income templates each tagged with a type badge.
- Given a recurring income template is added with a day already past this month, when the app is relaunched, then the missing entries appear on the income page and any linked account balance reflects them.
- Given a template is toggled inactive, when the app is relaunched, then no new income entries are created for it and previously created entries remain.
- Given a recurring income template is deleted, when the user reopens the page, then it is gone from the list and the income entries it already created still exist.
- Given the user switches the app to French, when they open `/spending/recurring`, then every label including the new type badge and income form is translated.

## Spec Change Log

### 2026-08-10 — Patch-class review fixes (no spec amendment)
Three-reviewer pass (blind adversarial, edge-case hunter, acceptance auditor). Fixed in place, spec
unchanged: launch-time balance changes now flow through `commands::income::record_account_balance_changes`
so a backfilled entry is audited and snapshotted like a manual one (project-context rule 3); backfill
isolates per-template errors so one unparsable `created_at` can no longer abandon already-written entries
unaudited; `SlideOver` open state derived from the resolved row instead of the key; cascade test counts rows
directly instead of through the inner join; leap-year and error-isolation tests added; income-source and
account deletions now invalidate the recurring-income list; backfill listener also invalidates
`yearly-summary` and `projection-input` since it writes historical months; template CRUD invalidation
narrowed to the list it actually changes; counter labels corrected from "income sources" to "income items";
merged-table column header changed from `common.category` to `recurring.categoryColumn` ("Category / Type")
now that it carries both budget categories and income types; i18n required-key list broadened to every key
the page renders plus the shared non-`recurring.` keys the forms borrow.

### 2026-08-10 — RESOLVED intent_gap: occurrences given a persistent identity (option [B])
**Human decision:** option [B]. The frozen `Always` duplicate-check rule was renegotiated and replaced by
two rules: applied occurrences are stamped with `recurring_income_template_id`, and an occurrence is skipped
when either that template already claimed the month **or** a row matches `source_id + date + amount_cents`
(keeping the manual-paycheque protection the original rule provided). Two matrix rows were added for the
amount-edit and day-edit cases.

**Known-bad state avoided:** editing a template's amount from $2,500 to $2,600 re-created every past
occurrence at the new amount on the next launch and re-credited the linked account by the whole history.

**Amended:** `Always` bullets 4–5, I/O matrix (+2 rows), migration 024 adding the nullable stamped column
with an index on `(recurring_income_template_id, month)`, `income_db::insert_income_entry_from_template`
(the public `insert_income_entry` now delegates with `None`, so manual entries stay unstamped),
`occurrence_already_applied` replacing `income_entry_exists`, and the `danger_zone` wipe order (income_entries
is now a child of the templates table).

**KEEP on any re-derivation:** routing inserts through the income layer so balance adjustment, source
validation and `month` derivation stay in one place; reusing the expense date helpers rather than copying
clamp/leap-year logic; per-template error isolation in the backfill; surfacing `balance_changes` so the
startup path audits and snapshots like a manual entry; the single combined table with two summary boxes.

**Residual, deferred:** two active templates on one source with the same amount and clamped day still
collapse to one entry, because the source/date/amount claim cannot tell them apart. Pausing then reactivating
a template still backfills the pause window, and manually deleting a generated entry still lets it return —
both shared with recurring expenses and recorded in `deferred-work.md`.
**Original finding (all three reviewers, independently):** the frozen `Always` rule "duplicate check before insert:
same `source_id` + `date` + `amount_cents`" combined with "backfill every occurrence from the template's
`created_at`" means an applied occurrence has no persistent identity. Consequences: editing a template's
amount or day makes the next launch re-create every past occurrence at the new value; reactivating after a
pause backfills the whole pause window; deleting a wrongly generated entry resurrects it next launch.

**Why it matters more here than for expenses:** recurring expenses carry the identical dedupe rule today,
but apply with `account_id: None`, so duplicates never move money. Recurring income applies with the
optional linked account, so each duplicate also credits a real account balance.

**Cannot be resolved from the spec** — the root cause is the frozen rule itself, and there is more than one
valid remedy. Human must choose. Options presented: (A) accept parity with expenses and defer, (B) add
`recurring_income_template_id` to `income_entries` and dedupe on `(template_id, year-month)` plus an apply
floor on edit, (C) keep the rule but skip the balance adjustment for occurrences outside the current month,
(D) bound the replay window. **Chosen: (B)** — see the resolution entry above.

## Design Notes

Backfill mirrors `apply_due_recurring_expenses_as_of`: walk month-by-month from the template's `created_at` date to today, clamp the day, skip out-of-window and already-existing occurrences. Keep the pure loop in an `..._as_of(conn, today: NaiveDate)` function so tests can pin "today".

Insert through the income layer rather than raw SQL so balance side effects stay correct:

```rust
let input = CreateIncomeEntryInput {
    source_id: template.source_id,
    amount_cents: template.amount_cents,
    date,
    account_id: template.account_id,
};
let created = income_db::insert_income_entry(conn, &input)?;
```

The combined list keeps one table; only a discriminated row type is new:

```ts
type RecurringRow =
  | { kind: "expense"; template: RecurringExpenseTemplate }
  | { kind: "income"; template: RecurringIncomeTemplate };
```

## Verification

**Commands:**
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -- expected: all pass, including the new `recurring_income` tests
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` -- expected: zero warnings
- `pnpm --filter @nixus/desktop test` -- expected: all pass, including the new locale parity test
- `pnpm --filter @nixus/desktop build` -- expected: exit 0, no TypeScript warnings (`noUnusedLocals`/`noUnusedParameters` are fatal)
- `pnpm --filter @nixus/desktop exec playwright test nav-qa` -- expected: still passes

**Manual checks (if no CLI):**
- Run `pnpm --filter @nixus/desktop tauri dev`: add a recurring income template dated earlier this month, restart the app, and confirm the income entry, the account balance change, and the dashboard cash-flow figure all update.

## Suggested Review Order

**Occurrence identity (the reviewed-and-renegotiated core)**

- Entry point: the two independent claims on a month — template stamp survives edits, source/date/amount is the manual claim
  [`recurring_income.rs:202`](../../apps/desktop/src-tauri/src/db/recurring_income.rs#L202)

- The nullable stamp and its `(template_id, month)` index
  [`024_income_entry_recurring_template.sql:4`](../../apps/desktop/src-tauri/migrations/024_income_entry_recurring_template.sql#L4)

- Public insert delegates with `None`, so manual entries stay unstamped
  [`income.rs:123`](../../apps/desktop/src-tauri/src/db/income.rs#L123)

**Backfill loop**

- Month walk from `created_at` to today, bounded by the eligibility window
  [`recurring_income.rs:138`](../../apps/desktop/src-tauri/src/db/recurring_income.rs#L138)

- One bad template cannot abandon already-written entries unaudited
  [`recurring_income.rs:116`](../../apps/desktop/src-tauri/src/db/recurring_income.rs#L116)

- Balance movements are returned, not dropped, so the caller can audit them
  [`recurring_income.rs:16`](../../apps/desktop/src-tauri/src/db/recurring_income.rs#L16)

**Command layer and startup**

- Backfilled income audited and snapshotted exactly like a manual entry
  [`recurring_income.rs:145`](../../apps/desktop/src-tauri/src/commands/recurring_income.rs#L145)

- Income applied after expenses under the same lock, emitting its own event
  [`lib.rs:92`](../../apps/desktop/src-tauri/src/lib.rs#L92)

- Wipe order: income_entries is now a child of the templates table
  [`danger_zone.rs:24`](../../apps/desktop/src-tauri/src/db/danger_zone.rs#L24)

**Schema and contract**

- Template table: source and optional account links, both with the right delete behaviour
  [`023_recurring_income.sql:1`](../../apps/desktop/src-tauri/migrations/023_recurring_income.sql#L1)

- Joined `source_name` / `income_type` keep the frontend free of a second lookup
  [`mod.rs:451`](../../apps/desktop/src-tauri/src/models/mod.rs#L451)

**UI: one table, two boxes**

- Discriminated row type is the whole trick — one table, two kinds
  [`RecurringTemplateList.tsx:47`](../../apps/desktop/src/components/expenses/RecurringTemplateList.tsx#L47)

- Badge tags each row; `good` for income, `neutral` for expense
  [`RecurringTemplateList.tsx:241`](../../apps/desktop/src/components/expenses/RecurringTemplateList.tsx#L241)

- Toggle branches per kind so each writes back through its own command
  [`RecurringTemplateList.tsx:105`](../../apps/desktop/src/components/expenses/RecurringTemplateList.tsx#L105)

- Two summary boxes, stacking below `sm`
  [`spending.recurring.tsx:74`](../../apps/desktop/src/routes/spending.recurring.tsx#L74)

- One add entry point; the pill picks which form renders
  [`spending.recurring.tsx:142`](../../apps/desktop/src/routes/spending.recurring.tsx#L142)

- Backfill writes historical months, so year- and projection-scoped caches are invalidated too
  [`RecurringApplyListener.tsx:33`](../../apps/desktop/src/components/shared/RecurringApplyListener.tsx#L33)

**Peripherals**

- Hook set; CRUD invalidates only the list it actually changes
  [`useRecurringIncome.ts:10`](../../apps/desktop/src/hooks/useRecurringIncome.ts#L10)

- Add and edit forms, reusing `MoneyInput` and `OptionalAccountSelect`
  [`AddRecurringIncomeForm.tsx:30`](../../apps/desktop/src/components/income/AddRecurringIncomeForm.tsx#L30)
  [`EditRecurringIncomeForm.tsx:34`](../../apps/desktop/src/components/income/EditRecurringIncomeForm.tsx#L34)

- The three regression tests for the reviewed bug
  [`recurring_income.rs:528`](../../apps/desktop/src-tauri/src/db/recurring_income.rs#L528)

- Browser-level flow: add, badge, toggle, edit, delete
  [`recurring-income.spec.ts:114`](../../apps/desktop/tests/recurring-income.spec.ts#L114)

- EN/FR parity plus the shared non-`recurring.` keys the forms borrow
  [`recurring-i18n.test.ts:1`](../../apps/desktop/src/locales/__tests__/recurring-i18n.test.ts#L1)
