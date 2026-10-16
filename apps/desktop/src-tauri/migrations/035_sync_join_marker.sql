-- A durable record that this dataset has actually JOINED its account's sync, and a durable
-- opt-out, so neither decision has to be re-derived (or re-asked) on every launch.
--
-- `link_state = 'linked'` cannot answer either question: it is written at the FIRST credential
-- vend, before the join (publish / restore / replace) has completed, so a computer that only
-- saw the CAP-5 link-choice question and dismissed it reads as linked and is asked again on
-- every launch. `joined_at` is written ONLY when a join genuinely completes.
--
-- Added with ALTER TABLE rather than a table rebuild so the install id, the fingerprint, the
-- account pin and the frozen reason of every existing row are carried without being re-stated.
-- The CHECK is attached to the column it constrains: a table-level CONSTRAINT would have to
-- follow every column definition, which ALTER TABLE cannot express.
ALTER TABLE sync_state ADD COLUMN joined_at TEXT;

ALTER TABLE sync_state
    ADD COLUMN sync_disabled INTEGER NOT NULL DEFAULT 0
    CONSTRAINT sync_state_disabled_is_boolean CHECK (sync_disabled IN (0, 1));

-- Milestone 1 rows are treated as joined. A dataset that holds a pin AND reports `linked` has
-- been through a credential vend against this account, and the overwhelmingly common case is a
-- computer that has been syncing for weeks; treating it as "never joined" would ask it the
-- first-connect question it has already answered.
UPDATE sync_state SET joined_at = datetime('now') WHERE link_state = 'linked';
