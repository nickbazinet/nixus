# Story 16 — Balance and counter emitters (plan, self-approved)

AD-5 (binding), AD-3, AD-12, AD-19. Unattended: every checkpoint auto-approved, no sub-agents, one self-review pass.

## Seam: how an emitter reaches capture

`db/*` functions take `&Connection` and `WriteTx` derefs to it, so an emitter cannot be handed the
`Capture` without changing every caller up to `commands/` (= story 17's migration). Chosen instead:
`ActiveDataset::write` installs its `Capture` as the **ambient capture of the write in progress on
this thread** (a thread-local + RAII guard), and `sync::capture::emit_balance_{set,delta}` appends
to the SAME buffer the hook appends to. Consequences, all deliberate:

- ordering relative to hook changes is preserved, and `WriteTx::savepoint`'s `Mark`/`rollback_to`
  discards an emission with its rows (one vector, one truncate);
- an emitter called OUTSIDE a `write` buffers and is discarded by the next `begin()` — exactly what
  the hook already does for an unmigrated write site, so nothing regresses and nothing is invented;
- every DB read still happens in the flush's reading pass (cause uuid resolution included).

## Cause key (AD-5 `(cause row uuid, kind)`, with the occurrence problem fixed)

`sync::identity::balance_cause(cause_table, cause_row_uuid, kind_tag, discriminator)` = UUIDv5 under
the frozen namespace over length-prefixed parts. Scope per kind:

- `Created` / `Deleted` → discriminator `""`, so the key is a pure function of `(row, kind)`: two
  computers deleting the same expense emit ONE delta (AD-19's double delete).
- `Edited` → discriminator = the emitted message's own `hlc`, so each edit occurrence is its own
  cause. Without it, editing twice would collide with the first edit's key and be deduplicated into
  a LOST UPDATE.

Dedup rule (already in the reference engine, kept): one cause keeps the delta with the EARLIEST
`hlc`, so the outcome does not depend on arrival order.

## Emitters

- `adjust_account_balance(conn, account_id, kind, amount_cents, cause)` — computes the new balance
  ONCE with `balance_delta_cents` (credit-card sign rules) and emits `balance_delta` of
  `new - old`. Replicas add it verbatim. `reverse_adjustment` takes the cause too.
- `update_account_balance` / `insert_account` → `balance_set` (absolute + hlc). LWW by hlc; a delta
  stamped after the set applies on top; the same set twice is a no-op.
- `record_merchant_category_hint` (db/expense.rs) moves onto `write` + `identity::ensure_derived`
  (natural key, AD-2) so its `usage_count` increments are captured by the hook.
- Counter on INSERT: `new - 0` instead of nothing. A counter's value becomes `sum(deltas)` with no
  "the schema default is 1" baked into the merge rule, and two computers creating the same hint
  independently converge on 2 rather than 1. Simulator reference/oracle/runner updated to match.
- `balance_cents` stays `MergeKind::Balance` = never generically captured (asserted for a raw
  `UPDATE accounts SET balance_cents` run inside `write`).

## Write sites migrated (budget lowered)

`commands/account.rs::{create_account, update_account_balance}` → `active.write`. `insert_account`
and `update_account_balance` are marked `CAPTURE-SANCTIONED (AD-3)` and leave the budget.
`adjust_account_balance` STAYS in the budget: its callers are expense/income (story 17).
`record_merchant_category_hint` → `commands/import.rs` via `active.write`, 4 sites leave.

## Simulator

`sim/balance.rs::BalanceLedger` extracted so the reference engine and the new real-emitter test
share ONE rule. `tests_balance_emitters.rs`: two real captured datasets, real emitters, `sync_log`
rows shipped over an in-memory transport and folded by the ledger; asserts identical balances,
credit-card signs, reversal, double reversal/double delete, balance_set races, counter adds,
duplicate delivery. Story 20 replaces the fold with `sync::apply`.

## Not in this story

No segments/upload (19), no apply path (20), no further finance write sites (17), no audit/config
(18), no tombstone table (21), no migration, no version bump, no frontend.
