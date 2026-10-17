# Story 17 — Migrate write sites, finance domains (plan, self-approved)

AD-3. Move every finance write onto `ActiveDataset::write`; lower `sync-write-site-budget.json`.

## Scope (finance): budget, budget_template, expenses (+import), accounts, assets, income,
recurring expense/income templates + their generated rows, net-worth snapshots.

## Steps
1. `db/mod.rs`: `transaction_or_savepoint(conn)` — a real transaction when `is_autocommit()`, a
   SAVEPOINT (rollback on drop) when the caller already opened one. Needed because several finance
   `db::*` fns open `conn.unchecked_transaction()`, which is an error inside a `WriteTx`
   (Story 15 trap (e)).
2. Commands: `lock -> active.write(|tx| db_fn(tx, ..)) -> audit (unchanged, on `conn`) -> return`.
   `record_net_worth_snapshot` gets its own `active.write` exactly where it had its own statement.
3. `record_account_balance_changes` takes `&ActiveDataset` (audit on conn, snapshot in a write).
4. `apply_due_recurring_{expenses,income}` take `&ActiveDataset`; `lib.rs` passes `&active`.
5. Template-generated rows: `identity::ensure_derived` at the insert site, keyed
   `recurring_expense(template uuid, "YYYY-MM")` / `recurring_income(...)`, skipped when
   `!capture::is_capturing()` (AD-12), following `bind_merchant_hint_identities`.
6. `CAPTURE-SANCTIONED (AD-3)` markers; regenerate the budget file; re-aim the scanner
   non-vacuity test at story-18 sites.
7. Tests: `sync/tests_finance_capture.rs` — per domain, commit produces `sync_log`, rollback none,
   cascade captured, derived identity stable across two replicas.

## Auto-decisions (rules section 5)
- Spec self-approved, all goals kept, no HALT, no review sub-agents, one self-review pass.
- CONFLICT: `commands/chat.rs` reaches five finance db fns on a bare connection. MUST NOT DO
  forbids migrating chat (story 18). Those five fns therefore stay UNSANCTIONED with a named
  reason, exactly as Story 16 did for `update_account_balance`. Recorded in the ledger.
- `config`-backed finance settings (financial-health target months, retirement input) are NOT
  migrated: `config` is `Natural` identity and story 18 owns its `ensure_derived`, so migrating
  the caller now would fail every write loudly.
