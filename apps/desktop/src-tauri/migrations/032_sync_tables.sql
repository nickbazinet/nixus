-- The Milestone-2 sync tables: row identity, the replication log, merge state and the three
-- quarantine/parking/tombstone side tables (AD-2, AD-5, AD-11, AD-12, AD-15).
--
-- WHY all seven in one migration: they are one mechanism. `sync_log` without `sync_field_state`
-- cannot decide a write, and `sync_applied_vector` without `sync_log` cannot say what it has seen.
-- Shipping them separately would mean shipping a schema version at which nothing can run.
--
-- WHY none of them has a FOREIGN KEY into a data table: a message names its subject by uuid and may
-- arrive BEFORE the row it is about exists (AD-11 parks exactly that case in `sync_pending`). An FK
-- would turn a legal out-of-order arrival into a constraint failure, and `ON DELETE CASCADE` from a
-- data table would silently erase the tombstone that makes the delete restorable.
--
-- WHY no uuid column is added to any data table (AD-2): the mapping lives in `sync_uuid` so a
-- local-only user pays nothing, no existing table is rebuilt, and a row's identity can be dropped
-- with its tombstone without touching the row.
--
-- Every invariant below is a NAMED TABLE-LEVEL constraint placed AFTER all column definitions, like
-- migrations 029 and 031: SQLite reports the failing constraint by name, so each rule is
-- independently diagnosable, and SQLite requires table constraints to follow every column.
--
-- COLUMN NAMING: AD-2 and AD-15 write these columns as `table`, `column` and `offset`. All three are
-- SQL keywords, so every one is spelled `table_name` / `column_name` / `applied_offset` here rather
-- than quoted at every use site.

-- Which uuid belongs to which local row (AD-2). The only place a 16-byte identity is bound to a
-- machine-local integer id; the data tables keep their integer ids unchanged and local-only.
--
-- WITHOUT ROWID: the whole table is its primary key plus 16 bytes, it is read by key on every
-- captured change, and a hidden rowid would be a second copy of nothing useful.
CREATE TABLE sync_uuid (
    -- The data table the row lives in. Text rather than an id into some table registry: the
    -- registry is Rust (`sync::registry`), and a name is what every message carries anyway.
    table_name TEXT NOT NULL,

    -- The machine-local `rowid` / `INTEGER PRIMARY KEY`. Local-only by construction: it is never
    -- put in a message, which is the entire point of this table.
    row_id INTEGER NOT NULL,

    uuid BLOB NOT NULL,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- One uuid per local row.
    CONSTRAINT sync_uuid_row_is_mapped_once PRIMARY KEY (table_name, row_id),

    -- And one local row per uuid, in the SAME table: without this, two rows could claim one
    -- identity and a remote field write would be ambiguous. The reverse lookup (uuid -> row) that
    -- `sync::apply` does on every message is served by this index.
    CONSTRAINT sync_uuid_identity_is_unique UNIQUE (table_name, uuid),

    CONSTRAINT sync_uuid_is_16_bytes CHECK (length(uuid) = 16),

    CONSTRAINT sync_uuid_table_name_is_not_empty CHECK (length(table_name) > 0)
) WITHOUT ROWID;

-- Faster "forget every mapping of this uuid" when a tombstone is recorded (AD-2: the mapping is
-- removed with the tombstone so rowid reuse cannot alias identities).
CREATE INDEX idx_sync_uuid_uuid ON sync_uuid(uuid);

-- The replication record (AD-1: the log is truth, the tables are the view).
--
-- WITH a rowid, and the one `AUTOINCREMENT` in the sync schema: this is an append-only queue read
-- in insertion order, and a REUSED id would alias a message that has already been shipped in a
-- segment. `AUTOINCREMENT` is what makes an id monotonic for the life of the database.
--
-- `seq` and `idx` are NULL until Story 19 cuts unshipped rows into a segment: at capture time the
-- segment this message will travel in does not exist yet, and inventing a number there would have
-- to be revised on every batch boundary. The message id AD-4 defines, `(install, seq, idx)`, is
-- therefore the identity of a SHIPPED message, and the UNIQUE below is what keeps it one.
CREATE TABLE sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Who produced it: this install for a locally captured change, the origin install for a
    -- message re-shipped from a snapshot tail. 8 random bytes as 16 lowercase hex (AD-4).
    install TEXT NOT NULL,

    -- The segment this message travels in and its position inside it (AD-6: `log/<install>/<seq>`).
    seq INTEGER,
    idx INTEGER,

    -- Story 13's FROZEN encoding: exactly 33 chars, `{ntp64:016x}-{install:016x}`, fixed width and
    -- lowercase so a plain `ORDER BY hlc` reproduces the HLC order with no decoding at all.
    hlc TEXT NOT NULL,

    -- What kind of change this is (AD-5). The set is closed by a named CHECK rather than by
    -- convention, so a typo is a constraint failure instead of a message nothing applies.
    kind TEXT NOT NULL,

    -- Routing, in uuid space (AD-2). Every kind addresses a row — a balance set and a balance
    -- delta address the account, a tombstone the deleted row — so neither is nullable. Only
    -- `column_name` is, because only a field write names a column.
    table_name TEXT NOT NULL,
    row_uuid BLOB NOT NULL,
    column_name TEXT,

    -- AD-5's key for a balance delta: the uuid of the row that CAUSED it, so two computers
    -- reacting to the same deleted expense produce one delta rather than two.
    cause_uuid BLOB,

    -- The value, in the pinned binary payload encoding Story 19 freezes with the format version.
    -- Opaque here on purpose: this table must not grow a column per value type.
    payload BLOB,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    CONSTRAINT sync_log_install_is_8_bytes_hex CHECK (length(install) = 16),

    CONSTRAINT sync_log_hlc_is_the_frozen_encoding CHECK (length(hlc) = 33),

    CONSTRAINT sync_log_kind_is_known CHECK (
        kind IN ('field', 'counter_delta', 'balance_set', 'balance_delta', 'tombstone')
    ),

    -- Both or neither: a `seq` without an `idx` is a position inside nothing, and an `idx` without
    -- a `seq` names a position in an unidentified segment. "Not yet shipped" is both being NULL.
    CONSTRAINT sync_log_shipping_is_whole_or_absent CHECK ((seq IS NULL) = (idx IS NULL)),

    CONSTRAINT sync_log_shipping_is_not_negative CHECK (
        (seq IS NULL OR seq >= 0) AND (idx IS NULL OR idx >= 0)
    ),

    -- AD-4's message identity, enforced rather than assumed. SQLite treats NULLs as distinct in a
    -- UNIQUE index, so this constrains shipped messages only, which is exactly the intent.
    CONSTRAINT sync_log_message_id_is_unique UNIQUE (install, seq, idx),

    CONSTRAINT sync_log_row_uuid_is_16_bytes CHECK (length(row_uuid) = 16),

    CONSTRAINT sync_log_cause_uuid_is_16_bytes CHECK (cause_uuid IS NULL OR length(cause_uuid) = 16),

    CONSTRAINT sync_log_table_name_is_not_empty CHECK (length(table_name) > 0),

    -- A per-column write names its column; the other three kinds must NOT, because their column is
    -- implied by the kind (`accounts.balance_cents` for both balance kinds) or does not exist at
    -- all (a tombstone is the whole row). A nullable-either-way column would make the routing
    -- ambiguous exactly where apply has to be deterministic.
    CONSTRAINT sync_log_names_a_column_only_when_it_has_one CHECK (
        (kind IN ('field', 'counter_delta')) = (column_name IS NOT NULL)
    ),

    -- AD-5: a delta is keyed by its cause; a set is not, because it replaces whatever was there.
    CONSTRAINT sync_log_balance_delta_names_its_cause CHECK (
        (kind = 'balance_delta') = (cause_uuid IS NOT NULL)
    )
);

-- The unshipped tail, which is what Story 19 cuts into segments and what AD-9 re-applies after a
-- restore. Partial so it indexes only the rows that are still work to do.
CREATE INDEX idx_sync_log_unshipped ON sync_log(id) WHERE seq IS NULL;

CREATE INDEX idx_sync_log_row ON sync_log(table_name, row_uuid);

-- Per-field merge state (AD-5): a field applies only if its message `hlc` is greater than the
-- stored one, whatever the arrival order. This is what makes apply idempotent and order-independent
-- rather than dependent on a de-duplication pass.
--
-- `content_hash` is also reconcile's input (AD-3): a write that bypassed the hook is detected by
-- comparing the live value's hash with the one recorded here.
--
-- WITHOUT ROWID: addressed only by its full key, one row per synced field of every synced row.
CREATE TABLE sync_field_state (
    table_name TEXT NOT NULL,
    row_uuid BLOB NOT NULL,
    column_name TEXT NOT NULL,

    hlc TEXT NOT NULL,

    -- The install that won the field, which is AD-4's tie-break made durable: two writes on the
    -- same `(wall_ms, counter)` are ordered by install id, and the winner has to be remembered or
    -- the next arrival of the loser would flip it.
    install TEXT NOT NULL,

    content_hash TEXT NOT NULL,

    CONSTRAINT sync_field_state_one_row_per_field
        PRIMARY KEY (table_name, row_uuid, column_name),

    CONSTRAINT sync_field_state_row_uuid_is_16_bytes CHECK (length(row_uuid) = 16),

    CONSTRAINT sync_field_state_hlc_is_the_frozen_encoding CHECK (length(hlc) = 33),

    CONSTRAINT sync_field_state_install_is_8_bytes_hex CHECK (length(install) = 16),

    CONSTRAINT sync_field_state_content_hash_is_hex CHECK (
        length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
    )
) WITHOUT ROWID;

-- What this computer has applied, per origin install (AD-11): advanced in the SAME transaction as
-- the data, which is what makes "applied" and "recorded as applied" one fact instead of two.
--
-- AD-9 reads a snapshot's watermark from the copy's own vector, never from a separate field, so this
-- table IS the watermark.
--
-- WITHOUT ROWID: one row per install, keyed by install, never scanned.
CREATE TABLE sync_applied_vector (
    install TEXT NOT NULL,

    -- The highest CONTIGUOUS segment seq applied for that install. Contiguous and not merely
    -- highest: AD-11 applies per install in `seq` order, so a gap means the later segment has not
    -- been applied at all.
    seq INTEGER NOT NULL,

    -- How far into that segment, for a batch that stopped part-way (AD-11 applies at most 500
    -- messages or ~20 ms per transaction). AD-15 names this column `offset`, which is a keyword.
    applied_offset INTEGER NOT NULL DEFAULT 0,

    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    CONSTRAINT sync_applied_vector_one_row_per_install PRIMARY KEY (install),

    CONSTRAINT sync_applied_vector_install_is_8_bytes_hex CHECK (length(install) = 16),

    CONSTRAINT sync_applied_vector_position_is_not_negative CHECK (seq >= 0 AND applied_offset >= 0)
) WITHOUT ROWID;

-- Deleted rows, kept whole (AD-5, AD-12). Two jobs, and both need the FULL row rather than a
-- marker: a user restoring something deleted on another computer for 30 days, and a balance delta
-- addressed to an already-tombstoned row being added to the retained copy instead of being lost.
--
-- A tombstone is ABSORBING per row uuid: an upsert of any clock value after it is dropped, which is
-- sound precisely because AD-2 removes the uuid mapping with the tombstone, so a re-insert is a new
-- identity rather than a resurrection.
--
-- WITHOUT ROWID: keyed by `(table, row uuid)` and looked up by that key on every applied message.
CREATE TABLE sync_tombstone (
    table_name TEXT NOT NULL,
    row_uuid BLOB NOT NULL,

    hlc TEXT NOT NULL,

    -- The install that deleted it, so a concurrent delete of one row from two computers is one
    -- tombstone with a decidable winner rather than two.
    install TEXT NOT NULL,

    -- The whole row as JSON, column name to value. JSON and not the binary payload encoding: this
    -- is read by a restore in a LATER app version, possibly after a migration added a column, and
    -- a self-describing document survives that where a positional encoding does not.
    row_json TEXT NOT NULL,

    -- When the delete happened and when the restorable copy may be purged (AD-5: 30 days).
    deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
    purge_after TEXT NOT NULL,

    CONSTRAINT sync_tombstone_one_row_per_identity PRIMARY KEY (table_name, row_uuid),

    CONSTRAINT sync_tombstone_row_uuid_is_16_bytes CHECK (length(row_uuid) = 16),

    CONSTRAINT sync_tombstone_hlc_is_the_frozen_encoding CHECK (length(hlc) = 33),

    CONSTRAINT sync_tombstone_install_is_8_bytes_hex CHECK (length(install) = 16),

    CONSTRAINT sync_tombstone_row_json_is_an_object CHECK (
        json_valid(row_json) AND json_type(row_json) = 'object'
    ),

    -- A purge window that ended before the delete did would make the row unrestorable the moment
    -- it was deleted.
    CONSTRAINT sync_tombstone_purge_is_after_the_delete CHECK (purge_after > deleted_at)
) WITHOUT ROWID;

CREATE INDEX idx_sync_tombstone_purge_after ON sync_tombstone(purge_after);

-- Messages whose subject or parent row has not arrived yet (AD-11). Parked, not quarantined: the
-- row is expected, and the message applies unchanged once it exists.
--
-- WITH a rowid: it is a worklist that is scanned, drained and re-tried, not a keyed lookup.
CREATE TABLE sync_pending (
    id INTEGER PRIMARY KEY,

    -- The shipped message, verbatim. A `seq`/`idx` is NOT NULL here, unlike in `sync_log`: only a
    -- message that arrived in a segment can be waiting for a parent.
    install TEXT NOT NULL,
    seq INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    hlc TEXT NOT NULL,
    kind TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_uuid BLOB NOT NULL,
    column_name TEXT,
    cause_uuid BLOB,
    payload BLOB,

    -- What it is waiting for, so draining is a lookup by the row that just appeared rather than a
    -- re-try of everything parked.
    waiting_on_table TEXT NOT NULL,
    waiting_on_uuid BLOB NOT NULL,

    received_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Re-delivering a segment must not park the same message twice (AD-6: objects are immutable and
    -- a duplicate delivery is expected, not exceptional).
    CONSTRAINT sync_pending_message_id_is_unique UNIQUE (install, seq, idx),

    CONSTRAINT sync_pending_install_is_8_bytes_hex CHECK (length(install) = 16),

    CONSTRAINT sync_pending_hlc_is_the_frozen_encoding CHECK (length(hlc) = 33),

    CONSTRAINT sync_pending_kind_is_known CHECK (
        kind IN ('field', 'counter_delta', 'balance_set', 'balance_delta', 'tombstone')
    ),

    CONSTRAINT sync_pending_row_uuid_is_16_bytes CHECK (length(row_uuid) = 16),

    CONSTRAINT sync_pending_cause_uuid_is_16_bytes CHECK (
        cause_uuid IS NULL OR length(cause_uuid) = 16
    ),

    CONSTRAINT sync_pending_waiting_on_uuid_is_16_bytes CHECK (length(waiting_on_uuid) = 16),

    CONSTRAINT sync_pending_position_is_not_negative CHECK (seq >= 0 AND idx >= 0)
);

CREATE INDEX idx_sync_pending_waiting_on ON sync_pending(waiting_on_table, waiting_on_uuid);

-- Messages that cannot be applied and must never block a later one (AD-11): a UNIQUE, CHECK or
-- NOT NULL violation, or a table, column or schema version this build does not know.
--
-- The REASON is a code, never a message and never a value (AD-16): `sync_diagnostics` exports counts
-- and codes, and a quarantine row holding a rendered SQLite error would put user data in it.
CREATE TABLE sync_quarantine (
    id INTEGER PRIMARY KEY,

    install TEXT NOT NULL,
    seq INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    hlc TEXT NOT NULL,
    kind TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_uuid BLOB NOT NULL,
    column_name TEXT,
    cause_uuid BLOB,
    payload BLOB,

    reason TEXT NOT NULL,

    -- The schema version the message was produced at, so a message parked as `unknown_schema` can
    -- be retried once this build has caught up (AD-11, CAP-7) instead of being dead forever.
    schema_version INTEGER,

    quarantined_at TEXT NOT NULL DEFAULT (datetime('now')),

    CONSTRAINT sync_quarantine_message_id_is_unique UNIQUE (install, seq, idx),

    CONSTRAINT sync_quarantine_install_is_8_bytes_hex CHECK (length(install) = 16),

    CONSTRAINT sync_quarantine_hlc_is_the_frozen_encoding CHECK (length(hlc) = 33),

    -- DELIBERATELY no `kind IN (...)` here, unlike every other table: this is where a message this
    -- build does not understand goes (AD-11, CAP-7), and a message carrying a kind introduced by a
    -- newer app version is exactly such a message. A closed set would make the one row that most
    -- needs recording the one row that cannot be recorded.
    CONSTRAINT sync_quarantine_kind_is_not_empty CHECK (length(kind) > 0),

    CONSTRAINT sync_quarantine_row_uuid_is_16_bytes CHECK (length(row_uuid) = 16),

    CONSTRAINT sync_quarantine_cause_uuid_is_16_bytes CHECK (
        cause_uuid IS NULL OR length(cause_uuid) = 16
    ),

    CONSTRAINT sync_quarantine_reason_is_known CHECK (
        reason IN (
            'constraint_violation',
            'unknown_table',
            'unknown_column',
            'unknown_schema',
            'malformed_payload',
            'apply_failed'
        )
    ),

    CONSTRAINT sync_quarantine_position_is_not_negative CHECK (seq >= 0 AND idx >= 0)
);

CREATE INDEX idx_sync_quarantine_reason ON sync_quarantine(reason);
