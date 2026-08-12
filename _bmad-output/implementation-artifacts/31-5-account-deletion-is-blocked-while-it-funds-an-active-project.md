# Story 31.5: Account deletion is blocked while it funds an active project

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user,
I want to be prevented from deleting an account that still has money earmarked in a project,
so that I don't lose track of which project that money belonged to.

## Acceptance Criteria

1. **Given** an account with at least one logged project contribution
   **When** I attempt to delete that account
   **Then** the deletion is rejected with a clear, specific error message naming the affected project(s)

2. **Given** an account with no project contributions
   **When** I delete it
   **Then** the deletion proceeds exactly as it does today (no behavior change)

3. **Given** the block
   **When** the enforcement mechanism is inspected
   **Then** it is enforced at the database layer via the `project_contributions.account_id` foreign key (`ON DELETE RESTRICT`), not solely by application-level checks

4. **Given** a rejected deletion
   **When** the error reaching the frontend is inspected
   **Then** it is an `AppError::Validation` whose `message` names the affected project(s) — not a raw SQLite constraint string such as `FOREIGN KEY constraint failed`

5. **Given** a rejected deletion
   **When** the database is inspected afterwards
   **Then** the account row, all of its project contributions, and its `balance_cents` are unchanged, and no `delete` audit-log entry was written for it

6. **Given** an account whose only contributions fund **archived** projects
   **When** I attempt to delete it
   **Then** the deletion is still rejected with the same specific message — the application guard and the foreign key agree on every input

## Tasks / Subtasks

- [x] **Task 1 — Prove the foreign key actually blocks (test-first, no production code yet)** (AC: #3)
  - [x] In `apps/desktop/src-tauri/src/db/projects.rs`'s existing `#[cfg(test)] mod tests`, add a test that seeds an account, an active project and one contribution, then asserts a **raw** `conn.execute("DELETE FROM accounts WHERE id = ?1", ...)` returns `Err`.
  - [x] Assert the failure is a constraint violation, not any error: match on `rusqlite::Error::SqliteFailure(err, _)` and assert `err.code == rusqlite::ErrorCode::ConstraintViolation`. Use the concrete error rather than a string comparison — SQLite's message text is not a stable contract.
  - [x] Confirm the test harness has `PRAGMA foreign_keys=ON` (the `projects_test_db()` helper from Story 31.1 sets it; `db/budget.rs:386` is the same pattern). Without the pragma the FK is inert and this test would pass vacuously for the wrong reason — add an assertion or a comment making the dependency explicit.
  - [x] Add the counterpart test: with **no** contributions, the same raw `DELETE FROM accounts` succeeds and affects 1 row (AC #2's data state).
  - [x] If the migration from Story 31.1 turns out not to enforce this, **fix the migration in this story's scope only if it has not shipped**; otherwise raise it rather than silently adding a second migration. The FK is Story 31.1's deliverable; this story's job is to verify it and give it a voice.
- [x] **Task 2 — Guard query in `db/projects.rs` (TDD)** (AC: #1, #4, #6)
  - [x] Add `pub fn get_project_names_funded_by_account(conn: &Connection, account_id: i64) -> Result<Vec<String>, AppError>`:
    ```sql
    SELECT DISTINCT p.name
    FROM project_contributions c
    JOIN projects p ON p.id = c.project_id
    WHERE c.account_id = ?1
    ORDER BY p.name
    ```
  - [x] **No `archived_at` filter** (AC #6). The rationale, and the exact failure mode of adding one, is in Dev Notes → "Why the guard must not filter on `archived_at`". This is the single most important decision in the story.
  - [x] `DISTINCT` so an account with five contributions to one project names that project once.
  - [x] `ORDER BY p.name` so the message is deterministic and testable.
  - [x] Return an empty `Vec` — never an error — when the account funds nothing. "Nothing blocks this delete" is a normal answer, not a failure.
  - [x] Tests: empty vec for an account with no contributions; one name for one project (deduplicated across multiple contributions); two names alphabetically for two projects; the archived-project case returns the name (AC #6); contributions belonging to a *different* account are excluded.
- [x] **Task 3 — Surface the specific error from `delete_account`** (AC: #1, #2, #4, #5)
  - [x] In `apps/desktop/src-tauri/src/commands/account.rs::delete_account` (currently lines 111–132), insert the guard **before** `account_db::delete_account(&conn, id)?`:
    ```rust
    let funded_projects = projects_db::get_project_names_funded_by_account(&conn, id)?;
    if !funded_projects.is_empty() {
        return Err(AppError::Validation {
            message: format!(
                "This account still holds money set aside for: {}. Delete those contributions first.",
                funded_projects.join(", ")
            ),
            field: Some("id".to_string()),
        });
    }
    ```
  - [x] Add `use crate::db::projects as projects_db;` to the imports at the top of `commands/account.rs` (existing import block, lines 1–8).
  - [x] The early `return` must happen **before** the delete and before any audit write, so a rejected attempt leaves no `delete` audit entry (AC #5). Note the existing `let old_json = get_account_json(&conn, id);` at `:120` is a harmless read; placing the guard before or after it is fine, but the guard must precede the `account_db::delete_account` call.
  - [x] Do **not** modify `db/account.rs::delete_account` (`:287-295`). It stays a plain `DELETE` and remains the FK's backstop; putting the guard in the command keeps the check where the user-facing message belongs and leaves the db function reusable.
  - [x] Do **not** add cascade/reassignment behaviour. NFR3 offers "blocked **or** requires explicit reassignment/deletion", the epic AC chooses *blocked*, and deleting a user's contributions as a side effect of deleting an account would destroy exactly the record this requirement exists to protect.
  - [x] Do **not** change `delete_account`'s signature, parameter names, or success behaviour — the architecture states its *"public API surface is unchanged"* (AC #2).
  - [x] Keep the existing post-delete `insert_audit_log(... "delete" ...)` and `record_net_worth_snapshot` calls untouched on the success path.
- [x] **Task 4 — Keep the raw-FK path from ever reaching the user as a raw string** (AC: #4)
  - [x] Reason through the two-layer arrangement and leave a short WHY comment above the guard: the guard produces the readable message; the FK is the invariant. They must agree on every input, which is why the guard's query has no `archived_at` filter (AC #6).
  - [x] Do **not** attempt to translate `rusqlite`'s `ConstraintViolation` into a friendly message inside `db/account.rs` or in `impl From<rusqlite::Error> for AppError` (`error.rs:101-107`). That `From` impl is global — a project-specific message there would leak into every unrelated database error in the app.
  - [x] Add no new `AppError` variant. `Validation { message, field }` is the correct existing variant and the architecture states no new variants are needed.
- [x] **Task 5 — Surface the message in the UI** (AC: #1, #4)
  - [x] `apps/desktop/src/components/accounts/AccountRow.tsx` currently discards the backend message: its delete `onError` is `() => toast.error(t("toast.deleteFailed"))` (`AccountRow.tsx:106-108`). Change it to read the error and show the specific message when it is a validation error:
    ```typescript
    onError: (err) => {
      const { type, message } = readError(err);
      if (type === "validation") {
        toast.error(message);
        return;
      }
      toast.error(t("toast.deleteFailed"));
    },
    ```
  - [x] Add the small `InvokeError` interface + `readError` helper locally in `AccountRow.tsx`, copied from `components/profile/ProfileForm.tsx:73-88` — that is the existing precedent for reading an `AppError` on the frontend, and there is no shared error utility in `src/lib/` today. Do not create one as part of this story; a second local copy is the honest, minimal change, and extracting a shared helper is a refactor that would touch `ProfileForm` too.
  - [x] Keep the generic `t("toast.deleteFailed")` for every non-validation failure — a database or lock error must not surface a raw internal string.
  - [x] Optional improvement, only if it costs nothing: keep the confirmation `Dialog` open (or reopen it) on rejection so the user can read the toast and act. Do not redesign the dialog.
  - [x] `useDeleteAccount` in `apps/desktop/src/hooks/useAccounts.ts:75-92` needs **no** change: its `onSuccess` invalidations are already correct, and they do not run on failure.
- [x] **Task 6 — Known limitation: the message is English-only** (AC: #1)
  - [x] The project names come from user data, but the sentence around them comes from Rust and is not translated. This matches the app's existing behaviour for backend validation messages (e.g. `db/account.rs:134` `"Account name is required"`, surfaced verbatim by forms via `ProfileForm.tsx:241-247`).
  - [x] Do **not** invent a message-key protocol between Rust and i18next for this story — no such mechanism exists in the codebase, and adding one is an architectural change no requirement asks for.
  - [x] Record the limitation in the Completion Notes so it is a known, deliberate trade-off rather than an oversight. No new locale keys are required by this story; if a fallback key is added, add it to **both** `en.json` and `fr.json`.
- [x] **Task 7 — Rust unit tests (write first)** (AC: #1, #2, #3, #5, #6)
  - [x] All tests go in `db/projects.rs`'s `#[cfg(test)] mod tests` using the existing `projects_test_db()` helper. Commands are not unit-testable in this codebase (they need `State<DbState>`; no `commands/*.rs` CRUD file has a `#[cfg(test)]` block), so the guard query and the FK are what get covered — keep `commands/account.rs`'s addition to the six-line early return above so there is nothing untested left in it.
  - [x] FK enforcement: raw `DELETE FROM accounts` fails with `ErrorCode::ConstraintViolation` when a contribution exists (AC #3).
  - [x] FK non-interference: raw `DELETE FROM accounts` succeeds when no contribution exists (AC #2).
  - [x] Guard returns the funded project names, deduplicated and alphabetically ordered (AC #1).
  - [x] Guard returns an archived project's name (AC #6) — this test is the guard-vs-FK agreement proof.
  - [x] Guard returns an empty vec for an unrelated account (AC #2).
  - [x] AC #5 state check: after a failed raw delete, `SELECT COUNT(*) FROM accounts WHERE id = ?`, `SELECT COUNT(*) FROM project_contributions WHERE account_id = ?`, and the account's `balance_cents` are all unchanged.
  - [x] Cascade sanity (already covered in Story 31.1 but cheap to keep honest here): deleting the *project* removes its contributions (`ON DELETE CASCADE`), after which the account becomes deletable — this is the documented escape route a user has, and it must actually work.
- [x] **Task 8 — Playwright coverage** (AC: #1, #2)
  - [x] Extend `apps/desktop/tests/accounts.spec.ts`. Its mock already implements `delete_account` (`accounts.spec.ts:123`) as an in-memory splice; add a rejection branch so the mock can simulate the guard, e.g. reject with `{ type: "validation", message: "This account still holds money set aside for: Car. Delete those contributions first.", field: "id" }` when the account is flagged as funding a project.
  - [x] Test: attempting to delete a funding account shows a toast containing the project name and the account is still listed (AC #1).
  - [x] Test: deleting a non-funding account still removes it from the list (AC #2 — no behaviour change).
  - [x] Reject with an **object** shaped like the serialized `AppError` (`{ type, message, field }` per `error.rs:41-50`), not a bare string, or the frontend's `readError` will fall into its `typeof err === "string"` branch and the assertion will pass for the wrong reason.
  - [x] If Story 31.3 added a `get_account_earmark_breakdown` mock case to this spec, keep it — this story does not remove it.
- [x] **Task 9 — Verification** (AC: all)
  - [x] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` green; `cargo clippy --all-targets` adds zero new warnings.
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` clean; `pnpm --filter @nixus/desktop test` passes.
  - [x] `pnpm --filter @nixus/desktop exec playwright test` — run `accounts.spec.ts` plus the full suite; `AccountRow` appears on `/wealth/accounts`, which four specs visit.
  - [ ] Manual check (the AC #4 acceptance): with a real contribution logged, attempt the delete in the running app and confirm the toast reads as a sentence naming the project, with no `FOREIGN KEY constraint failed` text anywhere.
  - [x] `git diff` confirms: `db/account.rs` unmodified; `error.rs` unmodified; no new `AppError` variant; no migration added; no cascade/reassignment logic; no write to `accounts.balance_cents`.

## Dev Notes

### What this story is, in one sentence

The `ON DELETE RESTRICT` foreign key from migration 025 already makes this deletion impossible; this story proves that with a test and replaces the resulting raw SQLite failure with a sentence that names the projects — plus the one-line frontend change that stops the message being thrown away.

### Two layers, and why both exist

| Layer | Mechanism | Job |
| --- | --- | --- |
| Database | `project_contributions.account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (migration 025) | The invariant. Cannot be bypassed by any code path, present or future, including a raw SQL console. |
| Command | `get_project_names_funded_by_account` + early `AppError::Validation` return in `commands/account.rs::delete_account` | The voice. Turns "operation refused" into "refused, because of these goals". |

The architecture chose the FK deliberately: *"`ON DELETE RESTRICT` on `account_id` directly satisfies NFR3 (deleting an account with contributions is blocked at the DB layer, not just application logic) — this is stronger and cheaper than an application-level check."* And the epic's final AC for this story requires the DB-layer enforcement explicitly, *"not solely by application-level checks"*. So neither layer may be dropped in favour of the other: without the FK the guard is bypassable; without the guard the user sees `FOREIGN KEY constraint failed`.

`PRAGMA foreign_keys=ON` is what makes the FK live at runtime, and it is already applied to every connection in `db/mod.rs:79` (inside `open_configured`, which both startup and backup-restore go through — deliberately, per its doc comment, *"so a restored database can never end up configured differently from one opened at launch"*). Do not add a duplicate pragma.

### Why the guard must not filter on `archived_at`

The obvious-looking implementation is `WHERE p.archived_at IS NULL` — "block only for *active* projects", which even matches this story's title. It is wrong, and the failure is silent:

`ON DELETE RESTRICT` does not know what `archived_at` means. It blocks the delete whenever **any** `project_contributions` row references the account, archived project or not. If the guard filtered to active projects only, then for an account whose contributions all fund archived projects the guard would return an empty vec, the command would proceed to `account_db::delete_account`, and rusqlite would fail the `DELETE` with a constraint violation that `impl From<rusqlite::Error> for AppError` (`error.rs:101-107`) converts into `AppError::Database { message: "FOREIGN KEY constraint failed" }`. The user would see exactly the raw string AC #4 forbids — in the one case nobody tested.

So the rule is: **the guard's predicate must be exactly as broad as the foreign key's.** Any contribution row referencing the account blocks the delete, and the message names whichever projects those are. AC #6 exists to pin this behaviour in a test.

(This is also why the story is titled around "an active project" but implemented against all projects: the title describes the common case; the constraint describes every case.)

### The command change, in place

`commands/account.rs:111-132` today:

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn delete_account(
    state: State<DbState>,
    id: i64,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_account_json(&conn, id);

    account_db::delete_account(&conn, id)?;

    if let Err(e) = audit_db::insert_audit_log(&conn, "account", id, "delete", old_json.as_deref(), None) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    if let Err(e) = net_worth_db::record_net_worth_snapshot(&conn) {
        tracing::error!("Failed to record snapshot: {}", e);
    }
    Ok(())
}
```

The guard slots in immediately before `account_db::delete_account(&conn, id)?`. Everything else stays byte-for-byte identical, which is what makes AC #2 ("no behavior change") verifiable by reading the diff.

Note the pre-existing `get_account_json` helper (`:134-153`) runs SQL inside a command file, violating project rule 3. **Do not extend it and do not imitate it** — the new guard is a `db/projects.rs` function called from here, which is the correct layering. Leaving the existing violation in place is deliberate: fixing it is unrelated refactoring.

The architecture's implementation sequence lists this as step 6, *"Extend `commands/account.rs::delete_account` with the contribution-exists guard"*, and describes it as *"the one place this feature touches existing code outside its own module."* Keep it that way — one file, one early return.

### Error shape reaching the frontend

`AppError::Validation` serializes to (`error.rs:41-50`):

```json
{ "type": "validation", "message": "This account still holds money set aside for: Car, Vacation. Delete those contributions first.", "field": "id" }
```

`field: Some("id")` matches the command's parameter name, consistent with how `db/account.rs`'s validation errors name their field (`"name"`, `"institution"`, `"account_type"`). Nothing on the frontend keys off `field` here — the toast shows `message` — but setting it keeps the error self-describing and costs nothing.

Add no new variant: *"Standard `AppError` — no new error variants needed; existing `validation`/`database` variants cover all failure modes."*

### Frontend: the message is currently thrown away

`components/accounts/AccountRow.tsx:101-109`:

```typescript
deleteAccount.mutate(account.id, {
  onSuccess: () => {
    toast.success(t("toast.deleteSuccess"));
    // ...
  },
  onError: () => {
    toast.error(t("toast.deleteFailed"));
  },
});
```

`onError: () => ...` ignores its argument, so today a perfectly specific backend message would be replaced by a generic "delete failed". That one line is the difference between AC #1 passing and failing.

The precedent for reading a typed `AppError` on the frontend is `components/profile/ProfileForm.tsx:73-88`:

```typescript
interface InvokeError {
  type?: string;
  message?: string;
  field?: string;
}

function readError(err: unknown): { type: string; message: string; field?: string } {
  const e = err as InvokeError;
  const message =
    e?.message ?? (typeof err === "string" ? err : JSON.stringify(err, null, 2));
  return {
    type: e?.type ?? "unknown",
    message: message ?? "An unexpected error occurred",
    field: e?.field,
  };
}
```

Copy it locally into `AccountRow.tsx`. There is no shared error helper in `src/lib/` (verified: `lib/` contains `accountUtils`, `agents`, `assetUtils`, `constants`, `formatCurrency`, `i18n`, `maintenanceUtils`, `navigation`, `parseNetWorthBreakdown`, `projection`, `types`, `utils` — no `errors.ts`). Creating one would be a cross-feature refactor with no AC behind it.

Show the backend `message` **only** for `type === "validation"`. A `database`-type error carries an internal SQLite string and must keep the generic toast.

### Dependencies and sequencing

- **Depends on Story 31.1** for migration 025 (the `ON DELETE RESTRICT` FK this story gives a voice to), `db/projects.rs`, and the `projects_test_db()` test helper.
- **Depends on Story 31.2** because a contribution must be creatable for the blocked path to be reachable at all — both in the app and in any end-to-end verification. The Rust unit tests can seed rows with raw SQL and so technically only need 31.1's schema, but AC #1's user-facing behaviour cannot be exercised without 31.2.
- **Independent of Stories 31.3 and 31.4.**
- Epic 32 inherits this guard unchanged: `confirm_project_allocations` writes `project_contributions` rows through the same table, so suggestion-sourced contributions block account deletion identically. No extra work there.

### Testing standards

- **Rust:** all new tests go in `db/projects.rs`'s inline `#[cfg(test)] mod tests`, reusing `projects_test_db()` (in-memory SQLite + `PRAGMA foreign_keys=ON` + the migration's DDL). Precedents: `db/budget.rs:379-440` (multi-table helper), `db/account.rs:464-480` (minimal helper), `db/account.rs:387-401` (a test that seeds rows then exercises a db function).
- **Assert on `rusqlite::ErrorCode::ConstraintViolation`, not on message text.** SQLite's wording is not a stable contract, and a string match would pass on an unrelated constraint failure.
- **The pragma is part of the test's meaning.** A `#[cfg(test)]` DB without `PRAGMA foreign_keys=ON` silently ignores every FK, so the AC #3 test would pass while proving nothing. `projects_test_db()` sets it; make that dependency explicit in a comment so nobody "cleans up" the pragma later.
- **Commands are not unit-tested** in this codebase — `State<DbState>` requires a Tauri handle and no `commands/*.rs` CRUD file has a test module. That is precisely why the command-side change is six lines: the guard query is tested in `db/`, and the wiring is covered by Playwright.
- **Playwright** stubs `invoke` per spec against the Vite dev server; there is no real IPC and therefore no real FK in E2E. The E2E test proves the *UI* surfaces the message; the Rust tests prove the *block* is real. Both are needed, and neither substitutes for the other.
- **Zero new warnings** from `cargo clippy` and `tsc` (project rule 9).

### Explicitly out of scope

No new migration and no change to migration 025 (unless it has not yet shipped and is provably wrong — raise it rather than patch around it), no change to `db/account.rs`, no change to `error.rs` and no new `AppError` variant, no cascade delete of contributions, no "reassign contributions to another account" flow (NFR3 permits it as an alternative; the epic AC chose blocking, and reassignment has no AC, no UI, and no command), no i18n protocol for backend messages, no shared frontend error utility, no change to `useDeleteAccount`'s invalidation list, no dashboard or earmark work, no allocation suggestions, no new dependency, no version bump.

### Project Structure Notes

```
apps/desktop/src-tauri/src/
├── db/projects.rs                  # MODIFIED — + get_project_names_funded_by_account
│                                   #            + FK-enforcement and guard tests
└── commands/account.rs             # MODIFIED — + projects_db import; + 6-line guard before the
                                    #            delete. Nothing else in the file changes.

apps/desktop/src/
└── components/accounts/AccountRow.tsx  # MODIFIED — delete onError reads the AppError and shows
                                        #            the validation message; local readError helper

apps/desktop/tests/
└── accounts.spec.ts                # MODIFIED — mock rejection branch + blocked/allowed delete tests
```

**No new files.** This is the smallest story in the epic by diff size and the one with the highest ratio of reasoning to code.

**Deliberately not touched:** `apps/desktop/src-tauri/migrations/` (the FK ships in Story 31.1's `025_projects.sql`), `db/mod.rs`, `db/account.rs` (its `delete_account` stays a plain `DELETE`, backed by the FK), `db/audit.rs`, `db/net_worth.rs`, `error.rs` (a project-specific message in the global `From<rusqlite::Error>` impl would leak into every unrelated DB error), `models/mod.rs` (no new model — the guard returns `Vec<String>`), `lib.rs` (no new command to register), `hooks/useAccounts.ts`, `lib/constants.ts`, `lib/types.ts`, `routes/wealth.accounts.tsx`, `components/profile/ProfileForm.tsx` (its `readError` is copied, not moved), `Cargo.toml`, `package.json`, `tauri.conf.json`, `_bmad-output/implementation-artifacts/sprint-status.yaml`.

**Boundary note:** `commands/account.rs` is the only file outside the projects feature that this epic modifies, exactly as the architecture predicted (*"the one place this feature touches existing code outside its own module"*). The dependency direction is `commands/account.rs → db/projects.rs`, which is acceptable because commands are the orchestration layer; the reverse (a projects module reaching into account commands) would not be.

**Naming conventions satisfied:** `snake_case` Rust function name; the guard lives in `db/` with the SQL, not in `commands/` (project rule 3); no money field is introduced so the `_cents` rule is not engaged; no new query key, model, or component.

### References

- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Story 31.5: Account deletion is blocked while it funds an active project` — acceptance criteria, copied faithfully, incl. "clear, specific error message naming the affected project(s)" and the DB-layer enforcement clause]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Requirements Inventory` — NFR3: blocked, enforced via `ON DELETE RESTRICT`]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#FR Coverage Map` — NFR3 → Epic 31, "enforced by schema + surfaced error"]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#9. Non-Functional Requirements` — NFR3: blocked or requires explicit reassignment/deletion, verified by a foreign-key constraint or an explicit guard]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Architecture` — the `ON DELETE RESTRICT` rationale: "stronger and cheaper than an application-level check"]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Cross-Cutting Concerns Identified` — `delete_account` is extended with the contribution-exists guard; the one place this feature touches existing code outside its module]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Decision Impact Analysis` — implementation sequence step 6]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#API & Communication Patterns` — "Standard `AppError` — no new error variants needed"]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Architectural Boundaries` — `commands/account.rs` gains one internal check; its public API surface is unchanged]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Boundaries` — `project_contributions.account_id` is the only foreign touchpoint into `accounts`, read-only, enforced by `ON DELETE RESTRICT`]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Requirements Coverage Validation` — SC2/SC5-class risks are enforced structurally, "deliberately stronger than 'agents should remember not to'"]
- [Source: `docs/project-context.md#3. Database Operations Belong in db/ Only` — the guard query belongs in `db/`, not in the command file]
- [Source: `docs/project-context.md#5. Error Handling (AppError)` — use the existing enum, never ad-hoc error types; `{ type, message, field }` JSON shape]
- [Source: `docs/project-context.md#2. Tauri IPC Commands`; `#9. Compilation Warnings Policy`; `#Testing Rules`]
- [Source: `apps/desktop/src-tauri/migrations/025_projects.sql` (created in Story 31.1) — `account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT`; `project_id ... ON DELETE CASCADE`]
- [Source: `apps/desktop/src-tauri/src/db/mod.rs:76-86`, `:79` — `open_configured` applies `PRAGMA foreign_keys=ON` to every connection, startup and restore alike]
- [Source: `apps/desktop/src-tauri/src/commands/account.rs:1-8`, `:111-132`, `:134-153` — import block; the `delete_account` body to extend; the in-command SQL helper not to imitate]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:287-295` — `delete_account`'s plain `DELETE`, left unchanged as the FK's backstop]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:131-160` — validation-error style, including `field: Some("name")` naming]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:387-401`, `:464-480` — seed-then-exercise test style; minimal in-memory test-db helper]
- [Source: `apps/desktop/src-tauri/src/db/budget.rs:379-440`, `:386` — multi-table test helper with `PRAGMA foreign_keys=ON`]
- [Source: `apps/desktop/src-tauri/src/error.rs:5-13`, `:41-50`, `:101-107` — `AppError::Validation`, its JSON serialization, and the global `From<rusqlite::Error>` impl that must not be specialized]
- [Source: `apps/desktop/src/components/accounts/AccountRow.tsx:101-109` — the delete `onError` that currently discards the message]
- [Source: `apps/desktop/src/components/accounts/AccountRow.tsx:196-210` — the delete confirmation Dialog]
- [Source: `apps/desktop/src/components/profile/ProfileForm.tsx:73-88`, `:241-247` — `InvokeError` + `readError` precedent and validation-aware error handling]
- [Source: `apps/desktop/src/hooks/useAccounts.ts:75-92` — `useDeleteAccount`; unchanged by this story]
- [Source: `apps/desktop/tests/accounts.spec.ts:123-134` — the existing `delete_account` mock branch to extend]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo test` (apps/desktop/src-tauri): 494 passed, 0 failed.
- `cargo clippy --all-targets`: 1 warning, pre-existing (`clippy::explicit_auto_deref` at `commands/backup.rs:106`), untouched by this story. Zero new warnings.
- `pnpm --filter @nixus/desktop exec tsc --noEmit`: clean.
- `pnpm --filter @nixus/desktop test`: 210 passed (13 files).
- `pnpm --filter @nixus/desktop exec playwright test accounts.spec.ts`: 25 passed.
- `pnpm --filter @nixus/desktop exec playwright test` (full suite): 426 passed, 2 failed — `expenses.spec.ts` "search placeholder promises only what it does" and `maintenance.spec.ts` "escape cancels edit without saving". Both pass when re-run in isolation (2 passed) and neither touches accounts, `AccountRow`, or `delete_account`; they are pre-existing flakes under full-suite parallelism.
- Test-bite proofs (temporary edits, reverted): adding `AND p.archived_at IS NULL` to the guard query makes `funded_project_names_include_archived_projects` fail (`left: [] right: ["Archived goal"]`), and removing the `type === "validation"` branch from `AccountRow`'s `onError` makes the new blocked-delete Playwright test fail. Both new tests bite.

### Completion Notes List

- The `ON DELETE RESTRICT` foreign key in `migrations/025_projects.sql:17` was verified present and live, not modified. The pragma it depends on (`db/mod.rs` `open_configured`) was not duplicated; the test helper's `PRAGMA foreign_keys=ON` is now asserted rather than assumed via `assert_foreign_keys_enforced`, so the AC #3 test cannot pass vacuously.
- `get_project_names_funded_by_account` has **no** `archived_at` filter, by design: its predicate is exactly as broad as the foreign key's. `funded_project_names_include_archived_projects` pins AC #6 and additionally asserts the raw delete still fails for that same input, making it the guard-vs-FK agreement proof.
- `db/account.rs`, `error.rs`, `models/mod.rs`, `lib.rs`, `hooks/useAccounts.ts` and the migrations directory are untouched; no new `AppError` variant, no cascade or reassignment behaviour, no write to `accounts.balance_cents`.
- **Deviation (deliberate, zero-cost):** on a validation rejection the delete confirmation `Dialog` now stays open (the early `return` in `onError` skips `setShowDeleteDialog(false)`), so the user can read the toast and act. Non-validation failures still close it exactly as before. This is the story's own optional improvement in Task 5; the dialog was not redesigned.
- **Deviation (test-harness shape):** `setupTauriMock` gained a third optional parameter, `blockedDeletes: { account_name, project_names }[]`, rather than a boolean flag. All three pre-existing call sites are unchanged, and the mock rejects with an object shaped like the serialized `AppError::Validation` (`{ type, message, field }`) so the component's `readError` takes its object path, not its string path. The mock's message string is byte-identical to the Rust `format!`.
- **Known limitation (deliberate):** the rejection sentence is produced in Rust and is English-only — only the project names inside it come from user data. This matches every existing backend validation message in the app (e.g. `db/account.rs`'s "Account name is required"). No Rust↔i18next message-key protocol was invented and no new locale keys were added, so `en.json`/`fr.json` are untouched.
- `readError` was copied locally into `AccountRow.tsx` from `ProfileForm.tsx` rather than extracted to `src/lib/`; extracting a shared helper would also have to touch `ProfileForm` and has no AC behind it.
- **Not performed:** the Task 9 manual in-app check (AC #4 by eye) is left unchecked — this environment cannot drive the running Tauri binary. Its content is covered by the Rust tests (the block is real, the message names the projects) plus the Playwright test (the UI shows that message verbatim and never the generic "Failed to delete"); a human should still confirm once.

### File List

- `apps/desktop/src-tauri/src/db/projects.rs` — MODIFIED: added `get_project_names_funded_by_account`; added FK-enforcement, cascade-escape-route and guard tests.
- `apps/desktop/src-tauri/src/commands/account.rs` — MODIFIED: added `use crate::db::projects as projects_db;` and the contribution-exists guard before `account_db::delete_account`.
- `apps/desktop/src/components/accounts/AccountRow.tsx` — MODIFIED: local `InvokeError` + `readError`; delete `onError` surfaces a validation message and keeps the dialog open.
- `apps/desktop/tests/accounts.spec.ts` — MODIFIED: `setupTauriMock` `blockedDeletes` fixture + `delete_account` rejection branch; two new tests (blocked delete, unaffected delete).
- `_bmad-output/implementation-artifacts/31-5-account-deletion-is-blocked-while-it-funds-an-active-project.md` — MODIFIED: task checkboxes, Dev Agent Record, Status.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story 31-5 → `review`.

