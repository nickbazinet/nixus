-- One `sync_field_state` row per SYNCED ROW instead of one per synced COLUMN (AD-3, AD-5, AD-19).
--
-- WHY, measured rather than assumed: the AD-19 local-write latency gate measured a 1,000-row
-- import at +32.5 ms against a baseline of 2.2-6.8 ms, and 4,000 `sync_field_state` rows (one per
-- captured column) were 7.9 ms of it, the single largest remaining item once Story 15 had collapsed
-- the log messages to one per changed row. A `WITHOUT ROWID` row keyed by
-- `(table_name, row_uuid, column_name)` costs a key comparison and a page write per COLUMN, and the
-- columns of one changed row are always written together, so the per-column row was paying four
-- times for one fact.
--
-- WHY no data migration: this table is BOOKKEEPING, not user data. Every row in it is derivable
-- from the live tables plus `sync_log`, which is exactly what reconcile does (AD-3), and migration
-- 032 has not shipped in any release, so nothing in the field holds a row worth carrying. Dropping
-- and recreating is therefore both correct and the only honest option: a per-column row cannot be
-- rewritten into the packed map without reading every row of a table this build is replacing.
--
-- WHY a packed BLOB and not a JSON object: the map is read and rewritten on every captured change,
-- it is never queried BY its contents (no index on a column name would be used), and the packed
-- form is fixed-width per entry apart from the name, so finding one column is a linear scan over a
-- few hundred bytes with no allocation. JSON would cost a parse per captured row for a readability
-- nothing reads.
--
-- WHY the `install` column is gone: Story 13 froze the HLC encoding as `{ntp64:016x}-{install:016x}`
-- exactly 33 characters, so an entry's `hlc` ALREADY carries the install that wrote it, verbatim and
-- in the same lexical order. AD-15 lists `install` as its own column; keeping a second copy of 16
-- characters per column would be a second place to keep correct. `db::sync_capture::ColumnState`
-- exposes it as `install()`, so callers still read a field rather than a substring.

DROP TABLE sync_field_state;

-- Per-field merge state (AD-5): a field applies only if its message `hlc` is greater than the
-- stored one, whatever the arrival order. This is what makes apply idempotent and order-independent
-- rather than dependent on a de-duplication pass.
--
-- `content_hash` is also reconcile's input (AD-3): a write that bypassed the hook is detected by
-- comparing the live value's hash with the one recorded here.
--
-- WITHOUT ROWID: addressed only by its full key, one row per synced row of every synced table.
CREATE TABLE sync_field_state (
    table_name TEXT NOT NULL,
    row_uuid BLOB NOT NULL,

    -- The per-column map, packed by `db::sync_capture`:
    --   count: u16 big-endian
    --   per entry, sorted by column name:
    --     name length: u8, name bytes,
    --     hlc: exactly 33 ASCII bytes (Story 13's frozen encoding, install id included),
    --     content hash: 32 raw sha256 bytes
    -- Raw bytes and not hex: this is never read by eye, and hex would be twice the size and a
    -- formatting pass per captured column.
    columns BLOB NOT NULL,

    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    CONSTRAINT sync_field_state_one_row_per_synced_row PRIMARY KEY (table_name, row_uuid),

    CONSTRAINT sync_field_state_row_uuid_is_16_bytes CHECK (length(row_uuid) = 16),

    CONSTRAINT sync_field_state_table_name_is_not_empty CHECK (length(table_name) > 0),

    -- The empty map is 2 bytes (a count of zero); the smallest entry is 1 + 1 + 33 + 32.
    CONSTRAINT sync_field_state_columns_is_a_packed_map CHECK (
        length(columns) >= 2 AND (length(columns) = 2 OR length(columns) >= 69)
    )
) WITHOUT ROWID;
