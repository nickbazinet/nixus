-- Sync state for this dataset (AD-15).
--
-- WHY it lives in the dataset's own database rather than beside it: every
-- whole-dataset operation this app already has is a copy or a delete of the one
-- `.db` file (backup export, restore, profile migration, delete-all-data), so
-- state kept in the file is carried correctly by all four for free. A sidecar
-- file would silently miss every one of them.
--
-- Every rule is a NAMED TABLE constraint rather than an inline column one: a
-- violation then reports which invariant broke, and SQLite requires table
-- constraints to follow every column definition.
CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY,

    -- AD-4: 8 random bytes, lowercase hex, minted once per install.
    install_id TEXT NOT NULL,

    -- A one-way digest of this machine's signals, never the signals themselves
    -- and never a raw hardware identifier: the column only has to answer "is this
    -- the machine that minted the install id?", which a digest does, and a
    -- correlatable identifier at rest would be a new privacy surface for nothing.
    machine_fingerprint TEXT NOT NULL,

    -- The pinned account (AD-7).
    identity_id TEXT,
    owner_sub TEXT,

    -- 'unlinked' until this dataset is bound to a cloud account; a wipe returns it
    -- there by deleting the row (AD-15).
    link_state TEXT NOT NULL DEFAULT 'unlinked',

    -- Frozen is a reason, not a flag plus a reason: NULL is "not frozen", and a
    -- frozen state that could not say why would make AD-14's entitlement lapse
    -- indistinguishable from a support-set freeze.
    frozen_reason TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- One logical row, enforced by the schema rather than by convention: two rows
    -- would mean two install ids appending to the same `(install, seq)` space.
    CONSTRAINT sync_state_single_row CHECK (id = 1),

    CONSTRAINT sync_state_install_id_is_8_bytes_hex CHECK (length(install_id) = 16),

    CONSTRAINT sync_state_fingerprint_is_sha256_hex
        CHECK (length(machine_fingerprint) = 64),

    -- Both or neither: an identity id without its owner sub is half a pin, and a
    -- half pin would let the missing half be adopted from whatever account happens
    -- to sign in next.
    CONSTRAINT sync_state_pin_is_whole_or_absent
        CHECK ((identity_id IS NULL) = (owner_sub IS NULL)),

    CONSTRAINT sync_state_link_state_is_known
        CHECK (link_state IN ('unlinked', 'linked')),

    CONSTRAINT sync_state_linked_requires_a_pin
        CHECK (link_state <> 'linked' OR identity_id IS NOT NULL),

    CONSTRAINT sync_state_frozen_reason_is_known
        CHECK (
            frozen_reason IS NULL
            OR frozen_reason IN ('entitlement_lapsed', 'owner_mismatch', 'support')
        )
);
