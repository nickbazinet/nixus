---
review: adversarial
target: _bmad-output/planning-artifacts/architecture/architecture-multi-device-sync-2026-10-13/ARCHITECTURE-SPINE.md
spec: _bmad-output/specs/spec-multi-device-sync/SPEC.md
reviewer: adversary lens
date: '2026-10-13'
verdict: CHANGES REQUIRED — do not start implementation
critical: 9
high: 7
medium: 5
low: 3
---

# Adversarial Review — Nixus Cloud Multi-Device Sync Architecture Spine

## Method

I took the spine as a **build substrate** and asked one question per finding: *can two
competent engineers, each obeying every AD to the letter, build units that refuse to
interoperate, diverge permanently, or lose money?* Where an AD leans on code, I read the
code. Every finding below is either (a) a **pair** — two AD-compliant implementations
that disagree — or (b) a **trace** — a concrete interleaving that corrupts or wedges.

Verified against: `src/db/account.rs`, `src/db/expense.rs`, `src/db/income.rs`,
`src/db/mod.rs`, `src/db/backup.rs`, `src/db/danger_zone.rs`, `src/commands/account.rs`,
`src/commands/backup.rs`, `src/commands/danger_zone.rs`, `src/commands/datasets.rs`,
`src/datasets.rs`, `src/lib.rs`, all 28 `migrations/*.sql`.

**Verdict: CHANGES REQUIRED.** The paradigm is sound and the AD skeleton is unusually
well-shaped for a feature spine. But three load-bearing pieces are missing rather than
merely under-specified — there is **no `ActiveDataset::write` in the codebase at all**, there
is **no per-field HLC store** in which LWW could be decided, and there is **no peer
discovery mechanism that the polling rule permits**. On top of those, AD-5's `Counter`
rule is mathematically wrong for the two balance-write paths that actually exist. As
written, CAP-4 (convergence) is not achievable and money is corrupted by the single most
ordinary concurrent action a two-computer user can perform. The fixes are local — new or
tightened AD wording, not a redesign.

---

## CRITICAL

### C-1 — `Counter` is not idempotent for row-level idempotent operations: concurrent delete of one expense refunds it twice

**Code reality.** `db/expense.rs:411 delete_expense` reverses the balance before deleting
the row:

```rust
// src/db/expense.rs:411-430
pub fn delete_expense(conn: &Connection, id: i64) -> Result<Vec<BalanceChange>, AppError> {
    let tx = conn.unchecked_transaction()?;
    let expense = get_expense_by_id(&tx, id)?;
    if let Some(account_id) = expense.account_id {
        balance_changes.push(account_db::reverse_adjustment(
            &tx, account_id, CashFlowKind::Expense, expense.amount_cents)?);
    }
    let rows = tx.execute("DELETE FROM expenses WHERE id = ?1", params![id])?;
```

`reverse_adjustment` → `adjust_account_balance` → `UPDATE accounts SET balance_cents = ?1`
(`db/account.rs:76`). The pre-update hook therefore sees one `accounts.balance_cents`
change, which AD-5 records as a delta of `+amount`.

**Trace (both computers obey AD-5 and AD-12 exactly).**

1. Both computers hold expense E (`amount_cents = 5000`, `account_id = X`), and
   `accounts.balance_cents` for X is `100000` on both. Both are converged.
2. The user notices E is a duplicate. On computer A they delete it. A emits:
   `tombstone(expenses/E)` and `counter(accounts/X.balance_cents, +5000)` — two messages,
   distinct `msg_id`s.
3. Before syncing, the user does the same on computer B (or B was offline and the user
   cleaned up there too). B emits `tombstone(expenses/E)` and
   `counter(accounts/X.balance_cents, +5000)` — again distinct `msg_id`s.
4. Converge. AD-5: "Deletes are tombstones and **delete wins**" — the two tombstones for
   the same `row_uuid` collapse to one effect. Correct: E is deleted once.
5. AD-5: "`Counter` ... de-duplicated by `msg_id`, and the value is the sum of all
   deltas." The two deltas have **different** `msg_id`s, so dedup does not fire. Sum =
   `100000 + 5000 + 5000 = 110000`.
6. Both computers show `balance_cents = 110000`. **They agree, and the number is wrong by
   $50.** The expense list shows E deleted once; the balance shows it refunded twice.

The same defect fires on a converging *edit*: `update_expense`
(`db/expense.rs:177-213`) emits `reverse_adjustment(old)` then `adjust_account_balance(new)`.
If both computers change E from $100 to $200, each emits net `−10000`; the sum is
`−20000` for one $200 expense. Off by $100.

**Why this is structural, not a bug.** AD-5 makes tombstones idempotent at the *row*
level and counters idempotent at the *message* level. Every operation that is
row-idempotent (concurrent delete, concurrent identical edit) is therefore
counter-non-idempotent. SPEC CAP-4's acceptance criterion — "account balances equal the
sum of all changes" — is satisfied *literally* while being economically false. The
randomized simulator CAP-4 mandates will pass if it asserts "sum of deltas" and fail if
it asserts "sum of surviving expenses." The spine does not say which.

**Minimal AD change (AD-5).** Replace "de-duplicated by `msg_id`" with:

> `Counter` deltas are idempotent per **effect key**, not per message: every counter
> delta carries `(cause_table, cause_row_uuid, cause_kind)` where `cause_kind ∈
> {create, reverse}` taken from the row whose change produced it, and apply keeps at most
> one delta per `(account_uuid, column, cause_table, cause_row_uuid, cause_kind)`,
> winning by HLC. A counter delta with no identifiable cause row is rejected at capture
> time, not applied. A test asserts `accounts.balance_cents` equals the balance recomputed
> from the surviving `expenses` and `income_entries` rows after every simulator run.

---

### C-2 — Absolute balance writes are indistinguishable from accumulating ones at the hook, so `update_account_balance` doubles the user's money

**Code reality.** Two semantically opposite operations compile to byte-identical SQL.

| Intent | Entry point | SQL issued |
| --- | --- | --- |
| "add this expense's effect" | `adjust_account_balance` (`db/account.rs:76`) | `UPDATE accounts SET balance_cents = ?1 ...` |
| "the balance **is** this number" | `update_account_balance` (`db/account.rs:229`) | `UPDATE accounts SET balance_cents = ?1 ...` |

`update_account_balance` is a registered Tauri command (`lib.rs:317`,
`commands/account.rs:54`) **and** is reachable from the AI chat agent
(`commands/chat.rs:794`). It is how a user reconciles against a bank statement.

Note also that `balance_delta_cents` (`db/account.rs:39`) is misnamed: it returns the new
**absolute** balance, and for liability accounts it is a non-linear, sign-dependent
function (`sign * (|current| ± amount)`, `db/account.rs:52-59`). Any reader who takes the
name at face value will wire the wrong value into a counter.

**Trace.**

1. Account X, `balance_cents = 10000` on both computers, converged.
2. The user reads their bank statement: the real balance is `$500.00`. On computer A they
   use the balance editor and enter `50000`. A's hook sees `old=10000, new=50000`; AD-5
   records `counter(+40000)`.
3. The user, not trusting sync yet, does exactly the same on computer B. B's hook sees
   `old=10000, new=50000`; B records `counter(+40000)`.
4. Converge: `10000 + 40000 + 40000 = 90000`. Both computers display `$900.00`.
5. The user set the same number twice and the app invented `$400`. There is no error, no
   conflict cue, and the two computers agree — so no diagnostic surfaces.

C-1's effect-key fix does **not** repair this: an absolute set has no cause row. The hook
is architecturally incapable of telling the two intents apart, so the distinction must be
made *above* the hook.

**Minimal AD change (AD-3 + AD-5).** Add to AD-3:

> A write whose intent is "set to an absolute value" rather than "accumulate" must declare
> itself: `ActiveDataset::write` takes an intent tag, and capture turns a tagged
> `Absolute` write to a `Counter` column into a `set_absolute(hlc, value)` message, never
> a delta.

And to AD-5:

> A `Counter` column has two message forms: `delta` (accumulating, idempotent per effect
> key per C-1) and `set_absolute` (LWW on `(hlc, install)`). Apply computes the value as
> `latest set_absolute.value + sum of all deltas with hlc > that set_absolute.hlc`. A
> `Counter` column reachable by any untagged write fails the registry test. `db/account.rs`
> must split `update_account_balance` (Absolute) from `adjust_account_balance` (delta) at
> the capture boundary, and `balance_delta_cents` must be renamed — it returns an absolute
> balance, not a delta.

---

### C-3 — There is nowhere to store a per-field HLC, so LWW is arrival-ordered and two computers diverge permanently

AD-4 says "Every message carries `(hlc, install)`" and "ties break by install id."
AD-5 says the default merge kind is `Lww`. Converging LWW **requires** apply to compare
an incoming write's HLC against the HLC of the write that currently holds the field.

AD-15 enumerates the sync tables, and the enumeration reads as exhaustive: "`sync_state`,
`sync_log`, `sync_pending` and `sync_row_state` are tables in the dataset DB."
AD-3 defines the only one that is per-row: `sync_row_state(table, row_uuid,
content_hash)` — **a hash, no HLC, no per-column granularity**. `sync_log` is the
*outbound* record (AD-3: capture writes it; the diagram's `LOG --> SEG` makes it the
segment source); remote messages go to apply and then the tables. After apply writes a
remote field value, **the HLC that justified it is retained nowhere.**

**Pair.**

- **Impl-1** adds `sync_field_hlc(table, row_uuid, column, hlc, install)` and compares.
  Converges under any arrival order.
- **Impl-2** follows AD-15's table list literally, has nothing to compare against, and
  applies in arrival order (the only order available). Last writer to *arrive* wins.

Both pass every stated test in the spine. Now:

1. B edits `expenses/E.merchant` to `"Costco"` at HLC 100. C edits it to `"Loblaws"` at
   HLC 200. Both upload.
2. Computer A (Impl-2) fetches C's segment first, then B's. Final value: `"Costco"` (HLC 100).
3. Computer D (Impl-2) fetches B's segment first, then C's. Final value: `"Loblaws"` (HLC 200).
4. A and D are permanently divergent on a field neither of them touched, with no further
   message that could ever reconcile them. Status on both: `idle`.

Segment fetch order is not controllable — AD-9 explicitly fetches the snapshot and the
tail "in parallel," and AD-6's `head/*` polling returns per-install heads in arbitrary
order. So arrival order differs between computers as a matter of course, not as a rare race.

**Minimal AD change (AD-5 + AD-15).** Add to AD-5:

> Convergence of `Lww` requires persisted decision state: `sync_field_state(table,
> row_uuid, column, hlc_wall_ms, hlc_counter, install)` holds the HLC of the write that
> currently owns each synced column. Apply rejects any `Lww` message whose `(hlc, install)`
> does not strictly exceed the stored pair. A proptest applies one message set in randomized
> orders and asserts byte-identical tables and identical `sync_field_state`.

Add `sync_field_state` (and `sync_applied`, per C-4) to AD-15's table list, and state that
the list is the complete set.

---

### C-4 — `msg_id` dedup has no persisted store, so a replayed segment double-counts money

AD-5 ("de-duplicated by `msg_id`") and AD-11 ("Duplicates are ignored by `msg_id`") both
require a durable set of applied `msg_id`s. AD-15's table list contains no such table.
`sync_pending` holds *un*applied orphans; `sync_log` holds *outbound* messages.

**Pair.** Impl-1 adds `sync_applied(msg_id, applied_hlc)`. Impl-2 has nothing and dedups
only within the current 500-message batch (the only scope available), which is exactly
the scope in which duplicates do *not* occur.

**Trace.** Duplicate delivery is not hypothetical — AD-6 mandates retries, AD-6 treats a
`412` as success, and SPEC CAP-4's acceptance test explicitly injects "duplicated and
dropped uploads."

1. B uploads `log/B/7` containing `counter(accounts/X.balance_cents, −5000)`. The PUT
   times out after S3 has durably stored it. B retries; the retry returns `412`
   (`If-None-Match: *`), which AD-6 calls success. One object, correct.
2. A fetches `log/B/7`, applies it in batch N. Balance `−5000`. A's poll loop is
   interrupted (app quit, network drop) *after* apply commits but *before* A persists its
   per-install watermark — AD-6 and AD-11 never pin watermark persistence to the apply
   transaction.
3. A restarts, re-reads `head/B`, re-fetches `log/B/7`, and applies it again in batch M.
   Impl-2 has no cross-batch `msg_id` memory. Balance `−10000`.
4. A now disagrees with B and C by $50, permanently, and the number will drift further on
   every interrupted poll.

**Minimal AD change (AD-11).** Add:

> Duplicate suppression is durable: `sync_applied(msg_id BLOB PRIMARY KEY, hlc)` is written
> **in the same transaction** as the messages it covers, and each install's fetch watermark
> is advanced **in that same transaction**. A message already in `sync_applied` is a no-op.
> `sync_applied` is pruned only by the snapshot path, never ahead of the watermark vector.

---

### C-5 — AD-6 forbids LIST on the polling path, and the only discovery mechanism it offers cannot discover anything new

AD-6: "Discovery polls `head/*` with conditional GETs (`If-None-Match` → `304`); LIST is a
repair path only, **never on the polling path**."

A conditional GET requires a concrete key. `head/<install>` is keyed by install id.
To poll `head/B` a computer must already know `B` exists. The only place install ids are
enumerated is the snapshot's watermark vector (AD-9), and snapshots are written only when
"the tail exceeds 2 MB or 5,000 messages" (AD-9) — a threshold driven by the *existing*
computers' own volume, with no relation to a new computer joining.

**Trace (no concurrency needed — this is the happy path).**

1. Computer A enables sync, uploads the initial snapshot, writes `head/A`, and polls. Its
   known-install set is `{A}`.
2. Computer B logs in on a new machine, bootstraps from `snap/LATEST` (watermark `{A: n}`),
   mints its own install id (AD-4: 8 random bytes), and makes 40 edits. B uploads
   `log/B/1` and writes `head/B`.
3. B's known-install set is `{A, B}` (A came from the watermark), so **B applies A's
   changes fine.**
4. A's known-install set is still `{A}`. A polls `head/A` — its own — gets `304`, reports
   `idle`. A never issues a GET for `head/B` because A has never seen the string `B`.
5. A never applies any of B's 40 edits. Both computers display `idle`. One-way sync,
   indefinitely, with a green status light.
6. The condition clears only if A's own tail crosses 2 MB / 5,000 messages, A writes a
   snapshot, and — per AD-13 — A "drops install ids unseen for 90 days from the watermark
   vector," which would drop nothing useful because A never saw B in the first place.

**Pair.** Impl-1 reads "LIST is a repair path" as permitting a low-cadence `ListObjectsV2`
on `head/` and discovers peers. Impl-2 obeys the "never on the polling path" prohibition
literally and never discovers peers. Both are AD-6-compliant; only one syncs.

**Minimal AD change (AD-6).** Replace the discovery sentence with:

> Discovery has two tiers. **Roster:** a single mutable key `roster` holds the set of
> install ids; an install adds itself with an `If-Match` CAS at enable time and after any
> install-id regeneration (AD-15), retrying on `412`. **Steady state:** computers poll
> `head/<install>` with conditional GETs for every id in `roster` plus every id in the
> latest watermark vector, and re-read `roster` on the same cadence (one extra conditional
> GET per poll). `LIST` remains a repair path only. A computer whose `roster` CAS has not
> succeeded reports `error`, never `idle`.

---

### C-6 — AD-2's UUIDv5 natural keys are computed over **local integer ids**, so the two tables it names get machine-dependent UUIDs and a hard UNIQUE wedge

AD-2 names the natural keys as `merchant_category_hints (merchant, budget_category)` and
`maintenance_tasks (vehicle, task_type_key)`. The actual columns are:

```sql
-- migrations/015_merchant_category_hints.sql:9
UNIQUE(merchant, budget_category_id)
-- migrations/018_maintenance_tables.sql:22
UNIQUE(vehicle_id, task_type_key)
```

`budget_category_id` and `vehicle_id` are **local `INTEGER` ids** — precisely the values
AD-2's own rule declares "unchanged and local-only" and which differ per computer.
Hashing them makes the UUIDv5 machine-dependent, which is the exact opposite of the
property AD-2 exists to provide.

**Trace.**

1. Computer A has vehicle "Civic" at local `vehicles.id = 1`. Computer B bootstrapped from
   a snapshot and then created a second vehicle first, so on B the same Civic is local
   `vehicles.id = 2` (AD-2 permits this: integer ids are local).
2. Offline, both users add the oil-change task. A computes
   `uuid_A = UUIDv5(ns, "1|oil_change")`; B computes `uuid_B = UUIDv5(ns, "2|oil_change")`.
   **Different UUIDs for the row AD-2 promised would be one row.**
3. Converge. On A, B's insert arrives with `uuid_B`. Apply resolves the parent by uuid to
   A's local `vehicles.id = 1` and inserts `(vehicle_id=1, task_type_key='oil_change')`.
4. `UNIQUE(vehicle_id, task_type_key)` is violated. AD-11's sync_pending covers only
   "parent is missing" and "unknown table, column or newer `schema_version`" — a UNIQUE
   violation is neither. The 500-message transaction aborts and rolls back.
5. The segment is re-fetched on the next poll, re-batched, and fails identically.
   **Apply is permanently wedged** — not just for this row, but for every message in every
   batch that contains it. AD-16's status set has no state for "apply cannot make
   progress"; the nearest is `error`, with no recovery path.

**Pair.** Impl-1 reads "natural key" as the *logical* key and hashes
`(parent_row_uuid, task_type_key)`. Impl-2 hashes the literal column values. Both obey
AD-2's text; only Impl-1 converges, and the two cannot interoperate at all.

**Minimal AD change (AD-2).** Replace the last sentence with:

> Tables with a non-PK UNIQUE natural key derive `uuid` as UUIDv5 in one fixed namespace
> over the **sync-stable** rendering of that key: every local integer FK component is
> replaced by the parent row's `uuid`, and text components are normalized (NFC, trimmed,
> case-folded) by one shared function. The exhaustive list is
> `merchant_category_hints(budget_category.uuid, merchant)` and
> `maintenance_tasks(vehicle.uuid, task_type_key)`. A test asserts the derivation reads no
> integer id. Editing any component of a natural key is a row identity change and is
> emitted as `tombstone(old_uuid) + insert(new_uuid)` in one message group, never as a
> field write.

---

### C-7 — No AD governs apply on a constraint violation, so every UNIQUE / CHECK / NOT NULL edge is a permanent apply wedge

AD-11 parks exactly three cases: missing parent, unknown table/column, newer
`schema_version`. The schema has constraint classes outside all three, and a single
violating message aborts the whole 500-message transaction forever (C-6 step 5).

Live constraints that remote apply can violate:

| Constraint | Source | How a converging edit violates it |
| --- | --- | --- |
| `project_images.project_id INTEGER PRIMARY KEY` | `026:2` | 1 image per project. Both computers add a cover photo offline → two UUIDv7 rows → PK collision on apply. See C-8. |
| `UNIQUE(merchant, budget_category_id)` | `015:9` | C-6, plus text-normalization drift. |
| `UNIQUE(vehicle_id, task_type_key)` | `018:22` | C-6. |
| `CHECK (byte_size = length(image_bytes))`, `CHECK (byte_size > 0)`, `image_bytes BLOB NOT NULL` | `026:3,8,10` | AD-10's lazy image is unrepresentable. See C-8. |
| `CHECK(amount_cents > 0)` | `004:9`, `011`, `016:4`, `023:4` | A `set_absolute`/LWW write of `0` or a negative value, or a parked-then-replayed older message, aborts the batch. |
| `accounts.name NOT NULL`, `institution NOT NULL` (no defaults) | `005:3-4` | A counter delta or field write arriving before the row's insert cannot be upserted into existence. See C-9. |
| `CHECK (source IN ('manual','suggested'))`, `CHECK(income_type IN (...))`, `CHECK(mime_type IN (...))`, `CHECK(day_of_month BETWEEN 1 AND 31)` | `025:18`, `011`, `026:11`, `016:6`, `023:4` | A newer app version widening an enum sends a value an older computer's CHECK rejects — exactly CAP-7's scenario, which AD-11 only handles for unknown *columns*, not unknown *values*. |

CAP-7 promises an older computer "applies what it understands, holds the rest ... with
nothing dropped." A CHECK violation is understood syntactically and rejected
semantically — the one case CAP-7's mechanism misses.

**Minimal AD change (AD-11).** Replace the parking sentence with:

> Apply never lets one message block others. Each batch runs with a SAVEPOINT per message;
> a message whose statement fails for **any** reason — missing parent, unknown table,
> column or value, newer `schema_version`, or a `UNIQUE`/`CHECK`/`NOT NULL`/FK violation —
> rolls back to its savepoint, is recorded in `sync_pending` with the SQLite error code,
> and the batch continues. `sync_pending` rows are retried on each new segment and on app
> update. A `sync_pending` row that has failed the same way more than N times raises
> `AppError::Sync { code: "apply_blocked" }` and a distinct `blocked` status; it is never
> discarded. Every constraint in the migrations is listed in a conflict-policy table beside
> AD-12's FK table, and a test fails on an unclassified `UNIQUE` or `CHECK`.

---

### C-8 — AD-10's lazy image cannot exist in the schema, and AD-5 has no column kind that would keep bytes out of segments

Two independent blockers on one table.

**(a) The row cannot be created without the bytes.** `migrations/026_project_images.sql`:

```sql
project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
image_bytes BLOB NOT NULL,
byte_size INTEGER NOT NULL,
CONSTRAINT project_images_byte_size_positive CHECK (byte_size > 0),
CONSTRAINT project_images_byte_size_matches_payload CHECK (byte_size = length(image_bytes)),
```

AD-10 requires a row carrying "the thumbnail and `sha256`" with the full bytes fetched
"on first view with a placeholder." `NOT NULL` + `byte_size > 0` + `byte_size =
length(image_bytes)` make a byte-less row **unrepresentable**. A bootstrapping computer's
apply hits a CHECK violation and wedges (C-7). AD-10 also names a `sha256` column that
does not exist, and AD-2's migration mandate adds only `uuid`.

**(b) AD-5 has no way to exclude a column.** AD-5 classifies **tables** as `Synced |
LocalOnly` and **columns** as `Lww | Counter | Tombstone`. There is no per-column
"not synced" kind. `project_images` must be `Synced` (the thumbnail must travel), so
`image_bytes` is necessarily `Lww` — putting multi-megabyte blobs into segments, which
AD-10's rule and CAP-6 forbid. **AD-5 and AD-10 directly contradict each other.**

**(c) Reconcile then destroys the images.** AD-3's reconcile compares
`sync_row_state(table, row_uuid, content_hash)` "with the tables." On a bootstrapped
computer the image bytes are absent by design. If the content hash covers the row (nothing
says it does not), every `project_images` row hashes differently, reconcile emits
"corrective" messages, and the computer that *has* the bytes applies them — **nulling or
truncating the originals on every computer.** One user action (open the app on a second
machine) destroys every project image.

**(d) Concurrent cover photos.** `project_id` is the PRIMARY KEY, so the table is a 1:1
singleton. `project_images` is not in AD-2's UUIDv5 list, so both computers mint UUIDv7
and apply collides on the PK (C-7).

**Minimal AD change (AD-5 + AD-10 + AD-2).** Add a fourth column kind to AD-5:

> A synced column may also be `Local` (never captured, never applied, excluded from
> `sync_row_state`'s content hash) or `ContentAddressed` (only its `sha256` is captured;
> bytes travel as `blob/<sha256>`). `project_images.image_bytes` is `ContentAddressed`;
> `project_images.byte_size` is derived from it. The column default is **`Unclassified`,
> which fails the registry test** — not `Lww`.

Add to AD-10:

> A migration adds `project_images.sha256 TEXT` and relaxes `image_bytes` to nullable,
> replacing the `byte_size` CHECK triad with one that holds when bytes are absent
> (`image_bytes IS NULL OR byte_size = length(image_bytes)`). A row with `sha256` set and
> `image_bytes` NULL is the normal pre-fetch state. `sync_row_state`'s content hash covers
> `sha256`, never bytes.

Add `project_images` to AD-2's UUIDv5 list, derived from `UUIDv5(ns, project.uuid)`, so
both computers address one row and LWW decides which image wins.

---

### C-9 — `ActiveDataset::write` does not exist, so on day one **every** write takes AD-3's weakest path — and that path is ambiguous and crash-lossy

**Code reality.** There is no `impl ActiveDataset` anywhere in the codebase. The struct has
two fields and no methods (`db/mod.rs:41-44`). Writes today go directly through
`conn.unchecked_transaction()` (17 sites across 8 `db/` modules) or bare
`conn.execute`, against roughly 202 `INSERT`/`UPDATE`/`DELETE` statements.

AD-3 is built entirely on this method, AD-1's dependency rule routes all of `db/`'s
coupling through it, and the CAP-3 map names it as a component. AD-3 concedes the gap —
"`ActiveDataset::write` is adopted incrementally; a source-guard test lists call sites not
yet migrated" — but the consequence is unstated: **at adoption 0%, 100% of writes are
"outside" writes**, so the entire capture design runs on the fallback, which is the
document's least specified rule.

Three defects in that fallback:

**(a) The direction of truth is undefined.** AD-3: reconcile "compares
`sync_row_state(table, row_uuid, content_hash)` with the tables and emits the missing
messages." *Missing on which side?*

- **Impl-1** ("tables are truth"): a `sync_row_state` entry with no matching table row
  means the row was deleted locally → emit a tombstone.
- **Impl-2** ("emit only what exists"): no table row, nothing to hash → emit nothing.

Rows removed by remote apply's FK `CASCADE` (AD-12: "hook disabled, nothing re-emitted")
are exactly this shape. There are **7 live CASCADE edges** (`vehicles→maintenance_tasks`,
`vehicles→maintenance_service_logs`, `maintenance_tasks→maintenance_service_logs`,
`income_sources→income_entries`, `income_sources→recurring_income_templates`,
`projects→project_contributions`, `projects→project_images`). Unless apply also deletes the
cascaded children's `sync_row_state` rows — which no AD requires — Impl-1's next reconcile
pass re-emits tombstones for rows apply removed, propagating deletes no user requested.
Impl-1 and Impl-2 produce different cloud state from identical local state.

**(b) The dirty flag cannot be durable.** AD-3: "A hook event outside
`ActiveDataset::write` marks the dataset `dirty`." A rusqlite pre-update hook cannot
safely execute SQL on its own connection, so the mark must be in-memory. A crash or force
quit between the un-captured write and the reconcile pass loses the flag, the write never
reaches `sync_log`, and the computer is **silently and permanently divergent** with status
`idle`. During the entire incremental-adoption period this is one crash away on every
write.

**(c) `sync_state` has two writers.** The Consistency Conventions table says "manager
writes `sync_state`." A dirty flag persisted there would be written by the UI connection
too, violating the spine's own "one writer per concern."

**Minimal AD change (AD-3).** Replace the dirty/reconcile sentences with:

> `ActiveDataset::write(|tx| …)` **must exist before sync capture ships**; it is the only
> write entry point for a sync-enabled dataset. Until the source-guard list is empty,
> reconcile is **unconditional at every launch** for a sync-enabled dataset — never gated
> on a volatile dirty flag — and the dirty flag is an optimization that may only shorten
> the interval, never replace the launch pass. Reconcile's direction of truth is: **the
> tables are truth for row existence and content; `sync_row_state` records what has been
> logged.** Reconcile emits an insert or field write for every table row whose hash differs
> from or is absent in `sync_row_state`, and a tombstone **only** for a `sync_row_state`
> row marked `logged_live` — apply sets `logged_deleted` on every row it removes, including
> FK `CASCADE` children, so reconcile never re-emits a remotely-driven delete. Capture's
> per-transaction buffer collapses multiple events on one row by **final value for `Lww`
> and by sum for `Counter`** (`update_expense` emits a reverse and an adjust on
> `accounts.balance_cents` in one transaction; collapsing to the last event alone loses the
> reversal).

---

## HIGH

### H-1 — AD-11's pragma list omits `foreign_keys=ON`, which AD-12's entire cascade semantics require

AD-11: the second connection is opened "(WAL, busy timeout)". It does **not** list
`PRAGMA foreign_keys=ON`. SQLite defaults it **off** per connection. The codebase sets it
only in `db::open_configured` (`db/mod.rs:103`), and the sync connection cannot use that
function — it must not re-run migrations and must not register the hook. The codebase
already knows this is the hazard: `db/projects.rs:2070` comments "Without the pragma every
FK below is inert."

**Pair.** Impl-1 sets `foreign_keys=ON` on the sync connection; AD-12's "a parent tombstone
is applied locally (FK CASCADE removes children)" works. Impl-2 follows AD-11's list
literally; cascades silently do nothing, `defer_foreign_keys` is a no-op (it only defers
*enforcement*, which is off), and children are orphaned.

**Trace.** A deletes vehicle V. A's hook is enabled, so locally A emits tombstones for V
and, per the SPEC's confirmed hook behaviour on cascades, for V's tasks and logs. B
(Impl-2) applies only V's tombstone; no cascade fires; B's `maintenance_tasks` and
`maintenance_service_logs` rows for V survive as orphans referencing a nonexistent vehicle.
B's garage screen shows maintenance for a deleted car. Permanent divergence, and B's
reconcile (C-9) may then re-emit those orphans as live rows, resurrecting them on A.

**Minimal AD change (AD-11).** Change the parenthetical to "(WAL, `foreign_keys=ON`,
`defer_foreign_keys` per transaction, busy timeout, `BEGIN IMMEDIATE`)" and add: "A test
asserts `PRAGMA foreign_keys` is `1` on the apply connection; `defer_foreign_keys` without
`foreign_keys=ON` is a silent no-op."

### H-2 — AD-12 never makes a tombstone and its SET NULL consequences one atomic unit, so the RESTRICT override diverges

`accounts` has **no** CASCADE children. It has 1 RESTRICT
(`project_contributions.account_id`, `025:17`, `NOT NULL`) and 3 SET NULL
(`expenses.account_id` `021:2`, `income_entries.account_id` `021:5`,
`recurring_income_templates.account_id` `023:6`). AD-12 says the SET NULL edges "replay as
ordinary field writes" — i.e. as *independent messages* — while the RESTRICT edge means
"a live child wins and the account tombstone is overridden."

**Trace.**

1. Account X, 200 expenses linked, no contributions. Converged.
2. A deletes X. Locally RESTRICT does not fire (no contributions). SET NULL fires: 200
   `expenses.account_id → NULL` updates, which the enabled hook emits as 200 ordinary LWW
   field writes at HLC `T`, plus `tombstone(accounts/X)` at `T`.
3. B, offline, records a project contribution against X.
4. Converge. On A, B's contribution insert arrives; X is tombstoned; AD-12's RESTRICT rule
   overrides the tombstone → A resurrects X. On B, A's tombstone arrives; B has a live
   child → tombstone overridden → X stays.
5. The 200 SET NULL messages are *independent* field writes, so they apply on B regardless.
   Both computers end with account X **alive and zero expenses linked to it** — and, because
   `balance_cents` is a Counter, X still shows the accumulated balance of 200 expenses that
   no longer reference it. The account screen shows a balance no transaction list explains.

**Pair.** Impl-1 treats a tombstone and its referential-action messages as one atomic group
(reject the group ⇒ reject the SET NULLs ⇒ X alive **with** its 200 links). Impl-2 follows
AD-12 literally ("ordinary field writes") ⇒ X alive **without** links. Permanent
divergence between two AD-12-compliant computers.

Additionally: `project_contributions.account_id` is `NOT NULL` + RESTRICT, so the
resurrection is mandatory — but AD-5 bounds restorability at 30 days. A contribution
arriving on day 31 cannot be inserted at all (its parent is unrecoverable), and with
`defer_foreign_keys` the failure surfaces only at COMMIT, aborting the batch (C-7).
**AD-5's 30-day bound and AD-12's unconditional RESTRICT override contradict each other.**

**Minimal AD change (AD-12).** Add:

> A delete is one atomic message group: `tombstone(parent)` plus every referential-action
> message it caused (`SET NULL` field writes, `CASCADE` child tombstones), sharing one
> `group_id`. Apply accepts or rejects the group as a unit. When the RESTRICT rule overrides
> an account tombstone the **whole group** is rejected, so the children's links survive.
> A tombstone carries the full field set of the row it removed, so a group rejected on a
> computer that already applied it can be reversed; a tombstone older than the AD-5
> retention window that must be overridden raises `AppError::Sync { code:
> "restrict_unrecoverable" }` rather than aborting the batch.

### H-3 — The snapshot's watermark vector is not pinned to the snapshot's own transaction, and either direction of the race corrupts

AD-9 defines a snapshot as "`zstd` of a consistent SQLite copy (`VACUUM INTO` or the backup
API) ... plus a watermark vector `{install: seq}`." It never says *when* the vector is read
relative to the copy. The apply loop runs concurrently on the second connection (AD-11).

- **Vector read after the copy.** Between the copy at `T` and the read at `T+δ`, apply
  commits `log/B/42`. The vector claims `B: 42` is included; the bytes predate it. A new
  computer bootstraps, fetches only the tail *after* `B:42`, and **permanently misses
  segment 42**. It converges with nobody, silently.
- **Vector read before the copy.** The copy now contains `B:42` but the vector says it does
  not. The new computer re-applies `B:42`. With C-4 unfixed (no `sync_applied`), every
  counter delta in that segment is applied twice.

Both orderings are AD-9-compliant; one loses data, the other duplicates money.

Two further AD-9 problems: `VACUUM INTO` cannot run inside a transaction, so the "consistent
copy" and the vector cannot share a transaction without switching to the backup API or a
long read snapshot. And AD-9 requires the copy to have "project image bytes removed" —
mutating the copy, which conflicts with its own consistency claim and with C-8.

**Minimal AD change (AD-9).** Add:

> The snapshot bytes and its watermark vector are taken from **one read snapshot**: apply is
> quiesced (or a `BEGIN DEFERRED` read transaction is held on the apply connection) for the
> duration, the vector is read from `sync_applied`/`sync_state` inside that same read
> transaction, and image-byte stripping happens on the *copy* with capture absent. A test
> asserts that a snapshot taken while apply is committing yields a vector that is exactly
> the set of messages present in the bytes.

### H-4 — AD-4 "rejects" skewed messages, which AD-11 forbids and CAP-4 counts as lost edits; and sub-threshold skew wins every conflict forever

AD-4: "Remote timestamps more than 5 minutes ahead of local time are **rejected** and
surface `clock_skew`." AD-11: a message is "**parked, never discarded**." CAP-4: "0 edits
are lost."

**Trace (data loss).** B's clock is 10 minutes fast. B writes 50 expenses and uploads them.
A rejects all 50 and shows `clock_skew`. Segments are immutable and `head/B` has already
advanced, so B will never re-send. Computer C, whose clock is also fast (or which comes
online an hour later, by which time B's stamps are no longer "ahead"), accepts all 50. A
and C are permanently divergent on 50 rows. Acceptance is a function of *each receiver's*
local clock, so the rule itself is the divergence mechanism.

**Trace (skew abuse).** A user sets one machine 4 minutes fast — under the threshold. Every
message it emits outranks every concurrent message from the other computer, forever. The
other computer's edits silently never win an LWW conflict. AD-4 claims to prevent "a skewed
clock winning every conflict"; a 4-minute skew does exactly that while passing the check.

**Minimal AD change (AD-4).** Replace the rejection sentence with:

> Skew is bounded at the **sender**: the HLC refuses to stamp a message more than 5 minutes
> ahead of the maximum wall time observed in any applied remote message, and a computer
> whose own clock exceeds that bound reports `clock_skew` and **stops uploading** until it
> is back in range. A receiver **never discards** a skewed message: it goes to
> `sync_pending` with its HLC and is re-evaluated as local time advances, so the same
> message set is eventually accepted by every computer regardless of local clock. Acceptance
> must not be a function of receiver-local time at steady state.

### H-5 — `epoch_reset` has no defined semantics and no persisted epoch, so the wipe un-deletes on a third computer

AD-15: "`danger_zone` wipe of a synced dataset writes one `epoch_reset` message and the
sync tables are included in `WIPE_TABLES` coverage." Nothing defines what apply *does* with
`epoch_reset`, whether the epoch is persisted, or whether pre-epoch segments are removed.

**Trace.** A wipes at HLC `T`. B applies `epoch_reset` and wipes. Computer C joins later,
bootstraps from a post-wipe snapshot, then — per AD-9 — fetches "the tail after its
watermark." AD-13 retains segments for 90 days, so the tail C computes may include
pre-`T` segments. C applies them on top of an empty database and **resurrects every row the
user asked to destroy.** C then uploads nothing contradictory (its rows are "live"), and
A and B's reconcile may accept them back. A privacy-grade "delete all my data" silently
reverses.

**Three further defects in the same sentence.**

- **The message destroys itself.** `wipe_all` (`db/danger_zone.rs:48`) deletes every table
  in `WIPE_TABLES` in one transaction. With `sync_log` in that list, the `epoch_reset`
  message is deleted by the transaction that creates it, before it can ever be uploaded.
- **`sync_state` is wiped too**, destroying the install id and `seq`. If the next launch
  reuses the same install id, `log/<install>/0` already exists and AD-6 treats the `412` as
  success — every post-wipe change is silently discarded (see H-6).
- **The tombstone flood AD-15 claims to prevent is unavoidable.** `wipe_all` runs on the UI
  connection with the hook **enabled** (`commands/danger_zone.rs:20`, `&mut *conn` from the
  `DbState` guard), and the SPEC's assumptions confirm the hook sees `DELETE` without
  `WHERE`. So the hook fires once per row — tens of thousands of events on a heavy-year
  dataset — and AD-3 flushes the buffer into `sync_log`. And `wipe_all` uses
  `conn.transaction()` directly, not `ActiveDataset::write`, so it is an "outside" write
  that marks the dataset dirty; reconcile then compares a full `sync_row_state` against
  empty tables and emits the same flood by the other path. **AD-15's goal is unreachable
  because AD-3 provides no capture-suppressed write primitive.**

**Minimal AD change (AD-15 + AD-3).** Add to AD-3:

> `ActiveDataset::write` accepts a `Capture::Suppressed` mode that discards the hook buffer
> instead of flushing it and does **not** mark the dataset dirty; it is permitted only for
> writes that emit their own replacement message. Reconcile skips rows covered by an epoch
> boundary.

Add to AD-15:

> `epoch_reset(hlc)` means: delete every synced row, drop every `sync_pending` and
> `sync_applied` entry, and **persist the epoch HLC in `sync_state`**. Apply rejects any
> message with `hlc < epoch_hlc` — including messages replayed from retained segments — and
> every snapshot carries the epoch HLC so a bootstrapping computer inherits it before it
> fetches any tail. The wipe is capture-suppressed, and ordering is pinned: persist the
> epoch and the `epoch_reset` message, upload it, prune pre-epoch segments and snapshots,
> and only then clear `sync_log`. The install id and `seq` in `sync_state` are **preserved**
> across a wipe, or regenerated with a `roster` CAS before any upload resumes.

### H-6 — AD-6's "412 means already exists and is success for identical content" discards data when install ids collide, and AD-15's defences miss filesystem copies

AD-15 regenerates the install id on "Restore, backup import, and dataset copy/migration" —
three *in-app* code paths. A user copying the dataset directory in Finder/Explorer,
restoring a machine from Time Machine, putting the app-data folder in Dropbox, or cloning a
VM bypasses all three. Two live computers then share one install id.

**Trace.** Both append `log/<install>/7` with **different** content. The first PUT wins.
The second gets `412` from `If-None-Match: *`, which AD-6 declares "success for identical
content" — but the implementation cannot know the content is identical without reading the
object, which AD-6 does not require. The second computer marks `seq 7` uploaded and moves
on. **Its entire segment is silently lost, with status `idle`.** `head/<install>` has "single
writer" assumed; now two writers overwrite each other's heads, so peers see a head that
oscillates and skip segments.

**Pair.** Impl-1 verifies the ETag/content on `412` and errors on mismatch. Impl-2 treats
any `412` as success. Only Impl-1 detects the collision.

**Minimal AD change (AD-6 + AD-15).** AD-6: "A `412` on an immutable key is success **only
after** the existing object's ETag matches the bytes just offered; a mismatch is
`AppError::Sync { code: \"identity_collision\" }`, halts all uploads, and requires install-id
regeneration." AD-15: "The install id is bound to the dataset file *and* the machine: a
`(install_id, machine_fingerprint, db_file_inode)` triple is stored in `sync_state` and
re-validated at every launch. Any mismatch — however the file arrived, including a
filesystem-level copy or a whole-machine restore — forces install-id regeneration, a
`roster` CAS, and a reconcile pass before any upload."

### H-7 — AD-5's column default is `Lww`, which is the opposite of what AD-5 claims to prevent — and makes AI chat content a Nixus-stored asset

AD-5's *Prevents* includes "a new table or column syncing by accident." Its *Rule* makes
`Lww` the column **default**. A future migration adding a column to a Synced table syncs it
silently; only *tables* are guarded by the unclassified-fails test.

Separately, AD-5's `LocalOnly` list is `audit_log`, `config`, `schema_version`, `sync_*`.
That leaves `chat_conversations` and `chat_messages` **Synced by default** — uploading AI
prompts and model responses to a Nixus-owned S3 bucket. The README's hosted-AI guarantee
states Nixus "does not store the prompt, the attached statement, the model's response, or
the file name in its own databases or logs." The inherited AD-11 row says content
statelessness is "Not extended to sync" and that "docs must not imply otherwise" — but it
never classifies chat, so the default decides, and the default contradicts a published
guarantee.

**Minimal AD change (AD-5).** "The column default is `Unclassified`; an unclassified column
on a `Synced` table fails the registry test exactly as an unclassified table does.
`chat_conversations` and `chat_messages` are `LocalOnly` in v1; changing that requires a
Privacy Policy amendment landed first (inherited AD-13)."

---

## MEDIUM

### M-1 — The second connection turns `db/backup.rs`'s safe swap into corruption, and AD-9's "atomic replace" does not exist in the code

`restore_from_file` (`db/backup.rs:23`) is explicitly built on "SQLite only unlinks
[`-wal`/`-shm`] when the **last** connection closes cleanly" (doc comment, lines 13-19). It
drops exactly one connection — the `&mut Connection` from the `DbState` guard
(`commands/backup.rs:162`) — then calls `remove_sidecars(db_path)` (line 40). AD-11's sync
connection is still open on the same file with the wal-index mapped. Deleting the sidecars
under it is precisely the "database disk image is malformed" hazard the function was written
to avoid. On Windows the sidecar `remove_file` fails with a sharing violation, which the
code logs as `warn!` and **continues** (lines 122-126).

AD-9 also describes the sequence as "checkpoint, safety copy, **atomic replace**, migrate,
rollback on failure." The code uses `std::fs::copy(backup_path, db_path)` (line 53) — not a
rename. A crash mid-copy leaves a truncated database at `db_path` with the `.pre-restore`
file beside it, and nothing on the launch path looks for that file. AD-9's claim to prevent
"a half-restored database being opened" is not a property the cited code has.

**Minimal AD change (AD-9 + AD-11).** AD-11: "The apply connection is closed before any
operation that replaces or renames the dataset file — `dataset:switched`, restore, import,
and `danger_zone` reclaim — and reopened only after the new file is configured. The manager
exposes a `quiesce()` the restore path must call and await." AD-9: "Restore uses a true
atomic replace (write beside, `fsync`, rename) and records an intent marker that the launch
path checks, so a crash mid-restore is recoverable rather than observable."

### M-2 — AD-15 requires install-id regeneration on restore, but AD-1 forbids `db/` from importing `sync/`, leaving no legal place for it — and a crash window if placed outside

`restore_from_file` ends with `open_configured(db_path)` and returns; there is no hook.
AD-1's dependency rule bars `db/backup.rs` from calling `sync/`. So the regeneration must
live in `commands/backup.rs`, *after* the swap commits — a window in which a crash leaves a
dataset holding another computer's install id and `seq`, with no marker, feeding straight
into H-6's silent data loss.

A second, quieter problem: AD-15 says "unsent changes are recovered by reconcile (AD-3),"
but after a restore the tables **and** `sync_row_state` both come from the backup file, so
they agree and reconcile emits nothing. The changes made since the backup were in the
overwritten file and are simply gone. AD-13's "re-applies its own unsent `sync_log` on top"
has the same shape: `sync_log` lives inside the file being replaced (AD-1, AD-15), so the
thing to replay is destroyed by the replay's prerequisite.

**Minimal AD change (AD-15).** "Restore, import and copy write a one-shot
`sync_identity_invalid` marker into the **restored** file as part of the same atomic
replace; the manager refuses every network operation until it has consumed that marker,
regenerated the install id, CASed the `roster`, and completed a reconcile pass. Unsent
`sync_log` rows and `sync_field_state` are extracted from the outgoing file **before** the
swap and re-inserted into the restored file inside the same atomic unit; what cannot be
extracted is reported, never silently dropped."

### M-3 — AD-13 lets a snapshot that lost the `snap/LATEST` CAS delete segments the winning snapshot needs

AD-6 resolves concurrent `snap/LATEST` writes by CAS-and-retry: the loser re-reads and
retries, so the *last* writer wins. AD-13 then says "a computer that writes a new snapshot
may delete segments older than 90 days that **the snapshot's** watermark covers" — *its own*
snapshot's, not `snap/LATEST`'s.

**Trace.** A and B both cross the snapshot threshold. A writes `snap/a` (watermark
`{A:100, B:5}`) and B writes `snap/b` (watermark `{A:50, B:60}`) — B was behind on A's
segments. Both CAS; B lands last, so `snap/LATEST = snap/b`. A, having written a snapshot,
deletes `log/A/1..100`. Computer C bootstraps from `snap/b`, needs the tail after `A:50`,
and requests `log/A/51..100` — **deleted by A.** C cannot bootstrap and cannot repair:
the data exists in no retained object. The 90-day age filter does not help; age is
uncorrelated with whether the winning snapshot covers them.

**Minimal AD change (AD-13).** "Retention is driven **only** by the snapshot currently named
by `snap/LATEST`: after a successful CAS a computer re-reads `snap/LATEST`, and if it does
not name its own snapshot it deletes nothing. Deletion requires the segment to be covered by
that snapshot's watermark **and** older than the retention window, and is preceded by a
conditional re-read of `snap/LATEST` to confirm it has not changed."

### M-4 — AD-11's 500-message transaction plus the `DbState` mutex re-creates the UI freeze AD-11 and AD-16 exist to prevent

In WAL mode there is one writer at a time. A 500-message apply transaction holds the write
lock for its full duration. Every UI command acquires the `DbState` mutex *first* and then
issues its write (`commands/*.rs` → `conn.unchecked_transaction()`), so it blocks on
`SQLITE_BUSY` **while holding the mutex** — serializing every other command behind it. That
is the UI freeze AD-11's *Prevents* claims to eliminate, reintroduced by AD-11's own batch
size. Past the busy timeout the user's save fails outright.

AD-11 also does not specify `BEGIN IMMEDIATE`. An apply transaction that begins deferred,
reads, then writes can hit `SQLITE_BUSY_SNAPSHOT`, which is not resolved by waiting and
forces a full rollback — so Impl-1 (immediate) makes progress and Impl-2 (deferred) livelocks
under concurrent UI writes.

**Minimal AD change (AD-11).** "Apply transactions use `BEGIN IMMEDIATE` and are bounded by
**wall time as well as count** — at most 500 messages *or* 50 ms, whichever comes first —
and the actor yields between batches so a UI write never waits more than one batch. No UI
code path may hold the `DbState` lock across a write that can return `SQLITE_BUSY`: the busy
timeout is set on both connections and a test asserts p99 UI write latency under sustained
apply load."

### M-5 — The S3 prefix is keyed on the mutable Cognito identity id while the dataset is keyed on the immutable user-pool `sub`, so one user can silently fork into two datasets

AD-7 scopes everything to `acct/<identity-id>/` and the IAM policy to
`cognito-identity.amazonaws.com:sub` (the *identity* id). The inherited AD-12 keys a
cloud-linked dataset by the Cognito **user-pool** `sub`. These are different identifiers
with different stability guarantees: an identity-pool identity id can change across
identity linking/merging, a differing `logins` map, an unauthenticated→authenticated
transition, or a pool recreation. Nothing binds them.

**Trace.** Computer A enables sync and gets identity id `I1`; data lands at `acct/I1/`.
Computer B logs in with the same user-pool account and `GetId` returns `I2`. B reads
`acct/I2/`, finds nothing, and — per AD-9, "the first computer to enable sync becomes the
source of truth" — uploads its own initial snapshot. The user now has two cloud datasets,
neither aware of the other, no error, and `idle` on both. Cross-prefix *read* isolation
still holds (so CAP-9 is intact), but the user's data has forked.

**Minimal AD change (AD-7 + AD-9).** AD-7: "The identity id obtained at enable time is
recorded in `sync_state`; a later `GetId` returning a different id raises
`AppError::Sync { code: \"identity_changed\" }` and halts sync rather than switching
prefixes." AD-9: "Before claiming source-of-truth status, a computer writes
`acct/<identity-id>/owner` with `If-None-Match: *` containing the user-pool `sub`. A
mismatch between that object and the signed-in `sub` halts sync; an empty prefix whose
`owner` write succeeds is a genuine first enable."

---

## LOW

### L-1 — AD-12's edge counts are correct; its *descriptions* are not

The two claims check out exactly: one RESTRICT edge (`project_contributions.account_id →
accounts`, `025:17`) and four SET NULL edges (`021:2`, `021:5`, `023:6`, `024:5-6`). But
AD-12's framing — "A parent tombstone is applied locally (FK `CASCADE` removes children)" —
reads as if `accounts` cascades. It does not; `accounts` has zero CASCADE children. The 7
live CASCADE edges are all on `vehicles`, `maintenance_tasks`, `income_sources`, and
`projects`. Tighten the wording so the policy table is read against the real graph, and note
that `maintenance_service_logs.task_id` is **nullable yet still CASCADE** (`019:5`) — a
schema that was deliberately relaxed to let logs outlive tasks still destroys every log with
a non-null `task_id` when the task is deleted.

### L-2 — No AD covers a local `schema_version` that exceeds the running binary

`run_migrations` only applies `version > current_version` (`db/mod.rs:128`), and
`restore_from_file` calls `open_configured` unconditionally (`backup.rs:67`). Restoring a
backup taken on a newer app build leaves the local schema **ahead** of the binary, with no
error. AD-11 handles a *message* naming a newer `schema_version`; it says nothing about the
local database being newer than the code reading it. Add one sentence to AD-11 requiring the
manager to refuse to capture or apply when `MAX(schema_version) > ` the binary's highest
migration, surfacing `update_needed`.

### L-3 — AD-14's entitlement check is per-operation, leaving a snapshot half-published

"The manager checks the entitlement capability `multi_device_sync` before every network
operation." A downgrade landing between the `snap/<id>` PUT and the `snap/LATEST` CAS leaves
an orphan snapshot and, if AD-13's retention ran first, deleted segments with no snapshot
naming them. Add: "Snapshot publication and retention are one guarded unit — the entitlement
is checked once at the start and the unit either completes or leaves `snap/LATEST` and all
segments untouched. Retention never runs before the `snap/LATEST` CAS succeeds."

---

## Required Before Implementation

Ordered by what unblocks the most:

1. **AD-5 rewrite (C-1, C-2, C-8c, H-7)** — effect-keyed counters, a `set_absolute` message
   form, a `Local`/`ContentAddressed` column kind, and an `Unclassified` column default.
   Without this, money is corrupted by ordinary two-computer use.
2. **AD-15 table list + AD-5/AD-11 (C-3, C-4)** — add `sync_field_state` and `sync_applied`,
   and declare the list complete. Without these two tables CAP-4 is unachievable.
3. **AD-6 discovery (C-5)** — a `roster` object. Without it computers never find each other.
4. **AD-3 (C-9)** — `ActiveDataset::write` must exist before capture ships; reconcile's
   direction of truth and its launch-unconditional trigger must be stated; the buffer
   collapse rule must distinguish `Lww` from `Counter`.
5. **AD-11 apply hardening (C-7, H-1, M-4)** — per-message savepoints, `foreign_keys=ON`,
   `BEGIN IMMEDIATE`, and a wall-time batch bound.
6. **AD-2 (C-6)** — UUIDv5 over sync-stable keys, and natural-key edits as
   tombstone+insert.
7. **AD-9/AD-10/AD-12/AD-4/AD-15 tightenings (C-8, H-2, H-3, H-4, H-5, H-6)** — snapshot
   watermark atomicity, the image migration, atomic delete groups, sender-side skew bounds,
   `epoch_reset` semantics, and ETag verification on `412`.

## What the Spine Gets Right

Worth preserving verbatim: the single-apply-path rule (AD-1), keeping integer ids local
rather than rewriting primary keys across 28 migrations (AD-2), the immutable-object +
exactly-two-mutable-keys transport shape (AD-6), the enhanced-flow identity pool with a
cross-account denial release gate (AD-7), the reserved `enc_scheme` byte (AD-8),
snapshot-first bootstrap with a bounded tail (AD-9), the compute-free retained-bucket stack
(AD-17), and the discipline of pairing every AD with an explicit *Prevents*. The registry
and FK-policy tests with failing-on-unclassified are the right mechanism — they just need
their defaults inverted and their coverage widened to `UNIQUE` and `CHECK`.
