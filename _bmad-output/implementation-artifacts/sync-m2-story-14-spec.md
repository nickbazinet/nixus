# Story 14 — Sync schema, registry and row identity (plan, self-approved)

Unattended: no HALT taken, all goals kept, no review sub-agents (one self-review pass). Checked against AD-2, AD-5, AD-12, AD-15, Consistency Conventions, Structural Seed.

## 1. Migration 032_sync_tables.sql (schema version 31 -> 32)

Seven tables, every invariant a NAMED table-level CHECK placed AFTER all columns (migrations 029/031 precedent, M1 trap).

- `sync_uuid(table_name, row_id, uuid BLOB)` — PK `(table_name, row_id)` WITHOUT ROWID + UNIQUE(uuid). AD-2 writes it `sync_uuid(table, row_id, uuid)`; `table`/`column` are SQL keywords, so every column is `*_name`. Recorded in the ledger.
- `sync_log(id INTEGER PRIMARY KEY AUTOINCREMENT, install, seq, idx, hlc, kind, table_name, row_uuid, column_name, cause_uuid, payload, created_at)` — rowid kept (append-only queue, ordered by id); AUTOINCREMENT so a shipped id is never reused. `seq`/`idx` are NULL until Story 19 cuts a segment; UNIQUE(install, seq, idx) once assigned. `hlc` is Story 13's frozen 33-char encoding (CHECK length = 33) so `ORDER BY hlc` is the HLC order.
- `sync_field_state(table_name, row_uuid, column_name, hlc, install, content_hash)` — PK of the first three, WITHOUT ROWID (AD-15 names the columns).
- `sync_applied_vector(install, seq, offset)` — PK `install`, WITHOUT ROWID.
- `sync_tombstone(table_name, row_uuid, hlc, row_json, deleted_at, purge_after)` — PK `(table_name, row_uuid)`, WITHOUT ROWID; full row for 30-day restore (AD-5).
- `sync_pending` / `sync_quarantine` — the `sync_log` message shape plus `waiting_on_*` / `reason`; `id` rowid, UNIQUE(install, seq, idx) so a replay is idempotent (AD-11).

No FK into data tables on purpose: a message names rows by uuid and may arrive before its subject row exists.
No uuid column on any data table.

## 2. WIPE_TABLES + the M1 round trip

All seven added to `WIPE_TABLES` (AD-15), `seed_all` gains exactly one row per table (the wipe test asserts one delete per listed table). `db/projects.rs` tripwire 31 -> 32. `sync/snapshot.rs` and `db/tests_sync_restore.rs` expected `sync\_%` lists grow to all nine. New tests: the seven travel EMPTY in a snapshot and are CARRIED OVER by a guarded restore; `sync_image_blobs` treatment unchanged.

## 3. sync/registry.rs (AD-5, AD-12)

Declarative, introspection-checked against the live migrated schema both ways.

- `TableClass::{Synced, AppendOnly, LocalOnly}` — exactly AD-5's words (`audit_log` AppendOnly; `schema_version`, `sqlite_sequence` and every `sync_*` LocalOnly). No `Derived`/`Bookkeeping` variant: the real schema has no such table and an unused variant is dead code.
- `RowIdentity::{Surrogate, Natural, SurrogateOrTemplate}` per synced table — AD-2's three cases; `expenses`/`income_entries` are the mixed ones (hand-made row = surrogate, template-generated = derived).
- `MergeKind::{Lww, Counter, Balance, Immutable, LocalId, Excluded}` per column of every Synced/AppendOnly table. `LocalId` = integer pk + every FK column (AD-2: local-only integers). `Excluded` = `project_images.image_bytes` (AD-10). `Counter` = `merchant_category_hints.usage_count`, `Balance` = `accounts.balance_cents` (AD-5).
- `config` is Synced; `config_key_is_local_only` reuses `db::config::LOCAL_ONLY_KEYS`.
- `FkPolicy::{Cascade, SetNull, Restrict, NoAction}` for all 17 edges keyed `(child table, child column)`; the test asserts each declared policy EQUALS the schema's `pragma_foreign_key_list.on_delete`, so the table cannot drift from reality.
- Coverage tests: no stale entry, no unclassified table/column/edge, LocalOnly tables carry no column entry, and non-vacuity (counts > 0, every variant used, a deliberately removed entry is caught).

## 4. Row identity — sync/identity.rs + db/sync_identity.rs

- SQL only in `db/sync_identity.rs`: `ensure`, `lookup`, `row_id_for`, `forget`, `forget_uuid`, `count`.
- `sync/identity.rs`: frozen `NAMESPACE` literal (plus a test proving it is UUIDv5 of the URL namespace over `https://nixusapp.com/sync/row-identity/v1`), `uuid_for(conn, table, row_id)` minting UUIDv4 lazily into `sync_uuid`, and UUIDv5 derivations over LENGTH-PREFIXED material in referenced-row uuids only: `merchant_category_hint`, `maintenance_task`, `project_image`, `config_key`, `recurring_expense`/`recurring_income` = `(template uuid, period)`.
- Golden-value tests pin every derivation's hex. Determinism proven across two independent databases whose logical rows hold different integer ids.
- `uuid = { version = "1.28.0", features = ["v4", "v5"] }` (Stack table; not present in Cargo.toml yet).

## 5. Out of scope

No capture hook (15), no emitters (16), no write-site change (17/18), no segment format (19), no apply (20), no command/UI/i18n/frontend, no version bump.
