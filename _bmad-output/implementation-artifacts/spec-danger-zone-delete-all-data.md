---
title: 'Settings Danger Zone — delete all app data'
type: 'feature'
created: '2026-08-01'
status: 'done'
baseline_commit: 'ea8f35ff9ad360d5e4e67166655d9eed4af5e203'
context: ['{project-root}/docs/project-context.md', '{project-root}/docs/guidelines/warnings.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way for a user to wipe their own data. Beta testers who want a clean slate (bad import, test data, handing the machine off) must manually locate and delete the SQLite file. Nixus is local-first, so the app owes the user a first-class "delete everything" control.

**Approach:** Add a "Danger Zone" section at the bottom of the Settings screen with a type-to-confirm dialog that invokes a new `delete_all_data` Tauri command. The command deletes every row from all user-data tables in a single transaction, then the app relaunches into an empty state. The dialog also offers a one-click backup export before wiping.

## Boundaries & Constraints

**Always:**
- Delete rows only — never `DROP TABLE`, never delete the DB file, never touch `schema_version`.
- Wipe runs inside one SQLite transaction with foreign keys respected (children before parents); either everything is gone or nothing is.
- The destructive button stays disabled until the user types the exact confirmation word (case-sensitive, per the active locale).
- `config` table is **preserved** — AI provider settings and `onboarding_completed` survive, so the wizard does not reappear.
- OS keychain AI credentials are **preserved** — the existing "Clear Credentials" control already covers that.
- Every new user-facing string gets keys in both `en.json` and `fr.json`.
- Zero new compiler/clippy warnings (see `docs/guidelines/warnings.md`).

**Ask First:**
- Adding a new npm/cargo dependency (none should be needed).
- Any change that would also wipe `config`, keychain credentials, or run destructive schema DDL.
- Introducing a new shared UI primitive (e.g. AlertDialog) into `packages/shared`.

**Never:**
- No selective/partial wipe UI (per-module or per-date deletion).
- No cloud/remote deletion, no undo/trash, no scheduled deletion.
- No refactor of the existing sidebar backup/restore UI or of `CredentialsForm`.
- No new migration file.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | DB has rows across finance, car, chat, audit tables; user types confirmation word and confirms | All listed tables are empty, `config` and `schema_version` untouched, command returns Ok, app relaunches | N/A |
| Already empty DB | All tables empty | Command succeeds, returns Ok, no error | N/A |
| Wrong/partial confirmation text | User types `delete` when word is `DELETE` | Confirm button remains disabled; nothing invoked | N/A |
| Dialog dismissed | User opens dialog then cancels / presses Esc | No command invoked, typed text is reset on next open | N/A |
| SQL failure mid-wipe | A `DELETE` fails | Transaction rolls back, DB unchanged, `AppError::Database` surfaced as inline destructive-styled message in the dialog, no relaunch | Rollback + error string shown |
| Backup export cancelled | User clicks "Export backup", cancels native dialog | Dialog stays open, no error shown, wipe not triggered | Null result treated as no-op |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/routes/settings.ai-provider.tsx` -- the Settings page; append the Danger Zone card as a sibling below the existing `max-w-2xl` AI provider card
- `apps/desktop/src/components/settings/CredentialsForm.tsx` -- reference for settings-page conventions: `invoke`, `useTranslation`, raw `<button>` styling with `bg-destructive` / `border-destructive/50`, inline status/error rendering
- `apps/desktop/src/components/shared/UpdateChecker.tsx` -- reference for `Dialog` usage from `@nixus/shared` and `relaunch()` from `@tauri-apps/plugin-process`
- `apps/desktop/src/components/shared/AppSidebar.tsx` (~lines 199-234) -- existing backup trigger: `invoke<{path:string}|null>("export_backup")`; reuse the same command for the "back up first" CTA
- `apps/desktop/src-tauri/src/db/danger_zone.rs` -- wipe logic (`WIPE_TABLES`, `wipe_all`, `reclaim_space`) + tests; SQL lives in the `db/` layer per project-context Rule #3
- `apps/desktop/src-tauri/src/commands/danger_zone.rs` -- thin command wrapper only
- `apps/desktop/src-tauri/src/commands/mod.rs` and `src/db/mod.rs` -- register new `pub mod danger_zone;`
- `apps/desktop/src-tauri/src/commands/backup.rs` -- pattern for `DbState` locking, `AppError` mapping, and colocated `#[cfg(test)]` tests with `tempfile`
- `apps/desktop/src-tauri/src/db/mod.rs` -- `DbState(pub Mutex<Connection>)`, `MIGRATIONS`, `run_migrations()`; use `run_migrations` in tests to build a real schema
- `apps/desktop/src-tauri/src/error.rs` -- `AppError::Database { message }`
- `apps/desktop/src-tauri/src/lib.rs` (~lines 91-181) -- add command to `generate_handler!`
- `apps/desktop/src/locales/en.json` / `fr.json` -- flat dot-delimited keys; new keys go under the `settings.*` prefix
- `apps/desktop/src/locales/__tests__/maintenance-i18n.test.ts` -- pattern for an en/fr key-parity test

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/commands/danger_zone.rs` -- new file with `#[tauri::command] pub fn delete_all_data(state: State<DbState>) -> Result<(), AppError>`; lock `DbState`, open a transaction, `DELETE FROM` each user-data table child-first, commit, then `PRAGMA wal_checkpoint(TRUNCATE)` and `VACUUM` outside the transaction. Tables: `chat_messages`, `chat_conversations`, `maintenance_service_logs`, `maintenance_tasks`, `vehicles`, `income_entries`, `income_sources`, `recurring_expense_templates`, `merchant_category_hints`, `expenses`, `budget_categories`, `budget_groups`, `passive_assets`, `net_worth_snapshots`, `accounts`, `audit_log`. Keep the table list in one `const` slice so it is auditable. -- single source of truth for the wipe
- [x] `apps/desktop/src-tauri/src/commands/danger_zone.rs` -- colocated `#[cfg(test)] mod tests`: build an in-memory/temp DB via `run_migrations`, seed at least one row in every wiped table, run the wipe logic, assert all listed tables are `COUNT(*) = 0` while `config` and `schema_version` retain rows; plus an already-empty-DB case. Extract the wipe body into a `fn wipe_all(conn: &mut Connection) -> Result<(), AppError>` so it is testable without Tauri `State`. -- covers the I/O matrix
- [x] `apps/desktop/src-tauri/src/commands/mod.rs` -- add `pub mod danger_zone;` -- module registration
- [x] `apps/desktop/src-tauri/src/lib.rs` -- add `commands::danger_zone::delete_all_data` to `generate_handler!` -- expose to frontend
- [x] `apps/desktop/src/components/settings/DangerZone.tsx` -- new component: red-bordered card titled "Danger Zone" with an explanatory warning list of what is deleted and what is kept, an "Export backup" secondary button calling `invoke("export_backup")`, and a destructive "Delete all data" button that opens a `Dialog` from `@nixus/shared`. Dialog contains the warning, an `Input` requiring the exact confirmation word, a disabled-until-match destructive confirm button, and inline error display. On success: `queryClient.clear()` then `await relaunch()`. -- the whole UI surface
- [x] `apps/desktop/src/routes/settings.ai-provider.tsx` -- render `<DangerZone />` in a new `mx-auto max-w-2xl mt-6` wrapper below the existing card -- places it at the bottom of Settings
- [x] `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json` -- add all `settings.dangerZone*` / delete-all keys to both files in lockstep, including the confirmation word (`DELETE` / `SUPPRIMER`) -- bilingual parity
- [x] `apps/desktop/src/locales/__tests__/danger-zone-i18n.test.ts` -- assert every new danger-zone key exists in both `en.json` and `fr.json` with a non-empty value -- prevents locale drift

**Acceptance Criteria:**
- Given the Settings screen, when it renders, then a visually distinct destructive-bordered "Danger Zone" section appears below the AI Provider card and is the last section on the page.
- Given the Danger Zone, when the user reads it, then it states explicitly that all financial, vehicle, net-worth, chat and audit data is deleted permanently and that AI credentials and app preferences are kept.
- Given a successful wipe, when the app relaunches, then the dashboard/budget screens show their empty states and the onboarding wizard does not reappear.
- Given the app is running in French, when the Danger Zone renders, then all strings including the confirmation word are localized.
- Given the new command, when `cargo clippy` and `tsc` run, then there are zero new warnings or errors.

## Spec Change Log

### 2026-08-01 — review pass 1 (patch-only, no loopback)

Three adversarial reviews (blind, edge-case, acceptance) produced no `intent_gap` or
`bad_spec` findings, so the code was not re-derived. Applied as patches:

- **Documented-rule violation (project-context Rule #3):** the spec's own Design Notes placed
  `wipe_all` in `commands/danger_zone.rs`, but SQL must live in `db/`. Wipe logic moved to
  `apps/desktop/src-tauri/src/db/danger_zone.rs`; the command is now a thin wrapper. Code Map
  above updated to match. **KEEP:** the `WIPE_TABLES` const-slice design and child-first
  ordering — both verified correct against all 22 migrations by the edge-case reviewer.
- **Documented-rule violation (project-context Rule #2):** added
  `rename_all = "snake_case"` to `#[tauri::command]`.
- **Silent-survival hazard:** `WIPE_TABLES` was a hand-maintained allowlist with no schema
  check. Added `PRESERVED_TABLES` + `wipe_list_covers_every_table_in_the_schema`, which diffs
  the list against `sqlite_master`. Avoids the known-bad state where a future migration adds a
  table that silently survives "delete all data".
- **Untested matrix row:** added `wipe_all_rolls_back_when_a_delete_fails` (proves the
  rollback row of the I/O matrix) and `reclaim_space_succeeds_on_a_wal_file_backed_database`
  (exercises `wal_checkpoint`/`VACUUM` on a real WAL file, not in-memory).
- **Dead-end after wipe:** `SetupIncompleteBanner`'s `finance.onboarding.dismissed`
  localStorage flag survives the wipe and `relaunch()`. If previously dismissed, the user
  landed on an empty dashboard with no route back to onboarding. The delete flow now clears
  that key. Residual copy problem deferred.
- **Misreported failure:** `relaunch()` throwing after a successful delete previously showed a
  generic error implying the delete failed, with the confirm button re-enabled for a pointless
  retry. Split into a `wiped` state with a dedicated
  `settings.dangerZoneRestartFailed` message; controls stay locked once data is gone.
- **State bugs:** stale export-backup errors leaked into the delete dialog (now cleared on
  open as well as close); confirm input is compared with `.trim()` so a padded paste works;
  delete trigger disabled while a backup export is in flight; error text got `role="alert"`.

### 2026-08-01 — follow-up: collapsible section

Human request: make the Danger Zone collapsible. Implemented with the codebase's established
collapsible pattern (`useState` + `aria-expanded` + `aria-controls` + lucide `ChevronDown`/
`ChevronUp`, as in `AutoCategorizedSummary.tsx`) rather than the exported-but-unused
`Accordion` primitive from `packages/shared`. Collapsed by default, which also keeps the
destructive controls out of casual reach. `isExpanded = expanded || deleting || wiped` forces
the section open once a wipe starts, so the `dangerZoneRestartFailed` message cannot be hidden
by collapsing mid-operation; the toggle is disabled in those states for the same reason.

Rejected as noise or verified false: the claim that `PRAGMA foreign_keys=ON` is unset in
production (it is set in `db/mod.rs` `init_db`); "Delete all data" naming vs. preserved
credentials (disclosed in the copy, and preserving them was an explicit human decision);
placement on the `ai-provider` route (`/settings` redirects there and it is the only settings
page); `format!` SQL (const-sourced, not user input).

## Design Notes

Delete order matters: `chat_messages` before `chat_conversations`, `maintenance_service_logs`/`maintenance_tasks` before `vehicles`, `budget_categories` before `budget_groups`, `income_entries` before `income_sources`, and `expenses` before `budget_categories`/`accounts`. Even if FKs are not enforced on every table, child-first ordering keeps the wipe correct if `PRAGMA foreign_keys` is ever turned on.

`budget_categories` has a `deleted_at` soft-delete column — the wipe is an unconditional `DELETE FROM`, ignoring soft-delete semantics.

Shape of the testable core:

```rust
const WIPE_TABLES: &[&str] = &["chat_messages", "chat_conversations", /* ... child-first ... */];

fn wipe_all(conn: &mut Connection) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    for table in WIPE_TABLES {
        tx.execute(&format!("DELETE FROM {}", table), [])?;
    }
    tx.commit()?;
    Ok(())
}
```

There is no `AlertDialog` in `packages/shared` — build the modal from the existing `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `Input` exports. Do not add a new primitive.

`queryClient` is not exported from `main.tsx`; get it with `useQueryClient()`.

## Verification

**Commands:**
- `cd apps/desktop/src-tauri && cargo test danger_zone` -- expected: new wipe tests pass
- `cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings` -- expected: no warnings
- `cd apps/desktop && pnpm test` -- expected: all vitest suites pass, including the new i18n parity test
- `cd apps/desktop && npx tsc --noEmit` -- expected: no type errors

**Manual checks (if no CLI):**
- Launch the app, open Settings, confirm the Danger Zone is the bottom-most section and styled destructively.
- Confirm button stays disabled for wrong-case input; enabled on exact match.
- Run the wipe with seeded data; after relaunch, verify budget/expenses/garage/net-worth/chat are empty while the AI provider still shows "Connected" and onboarding does not restart.

## Suggested Review Order

**The wipe itself (highest risk)**

- Start here: the exact table set that gets deleted, and the child-first order.
  [`db/danger_zone.rs:17`](../../apps/desktop/src-tauri/src/db/danger_zone.rs#L17)

- One transaction, all-or-nothing; table names come from the const, never user input.
  [`db/danger_zone.rs:44`](../../apps/desktop/src-tauri/src/db/danger_zone.rs#L44)

- Checkpoint + VACUUM split out so it runs outside the transaction and stays testable.
  [`db/danger_zone.rs:62`](../../apps/desktop/src-tauri/src/db/danger_zone.rs#L62)

- Thin command: lock, wipe, log, best-effort reclaim. No SQL in `commands/`.
  [`commands/danger_zone.rs:11`](../../apps/desktop/src-tauri/src/commands/danger_zone.rs#L11)

**Irreversibility guards in the UI**

- Type-to-confirm gate; trimmed compare, and locked once data is gone.
  [`DangerZone.tsx:47`](../../apps/desktop/src/components/settings/DangerZone.tsx#L47)

- Delete succeeded means never report failure; `wiped` latches the controls.
  [`DangerZone.tsx:85`](../../apps/desktop/src/components/settings/DangerZone.tsx#L85)

- Clears the banner dismissal flag so onboarding stays reachable after the wipe.
  [`DangerZone.tsx:32`](../../apps/desktop/src/components/settings/DangerZone.tsx#L32)

- Restart failure gets its own message instead of looking like a failed delete.
  [`DangerZone.tsx:101`](../../apps/desktop/src/components/settings/DangerZone.tsx#L101)

- Resets typed text and stale export errors on open as well as close.
  [`DangerZone.tsx:51`](../../apps/desktop/src/components/settings/DangerZone.tsx#L51)

- Collapsed by default; force-expanded while deleting so state messages stay visible.
  [`DangerZone.tsx:49`](../../apps/desktop/src/components/settings/DangerZone.tsx#L49)

**Wiring**

- Renders as the last section of Settings.
  [`settings.ai-provider.tsx:28`](../../apps/desktop/src/routes/settings.ai-provider.tsx#L28)

- Command exposed to the frontend.
  [`lib.rs:153`](../../apps/desktop/src-tauri/src/lib.rs#L153)

**Tests**

- Guards the real hazard: a future migration adding a table that survives the wipe.
  [`db/danger_zone.rs:177`](../../apps/desktop/src-tauri/src/db/danger_zone.rs#L177)

- Proves the rollback row of the I/O matrix by breaking a mid-list DELETE.
  [`db/danger_zone.rs:210`](../../apps/desktop/src-tauri/src/db/danger_zone.rs#L210)

- Exercises checkpoint/VACUUM on a real WAL file, not in-memory.
  [`db/danger_zone.rs:228`](../../apps/desktop/src-tauri/src/db/danger_zone.rs#L228)

- en/fr parity, interpolation placeholder, and per-locale confirm word.
  [`danger-zone-i18n.test.ts:32`](../../apps/desktop/src/locales/__tests__/danger-zone-i18n.test.ts#L32)

