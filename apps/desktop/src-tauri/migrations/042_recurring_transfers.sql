-- Recurring transfers between two of the user's own accounts ("every week, move $200 from
-- chequing to savings").
--
-- A template carries the same three schedule columns as the expense and income templates
-- (`frequency`, `day_of_month`, `start_date`; see migration 040). It cascades with either account:
-- a transfer that has lost one of its ends has nothing left to do.
CREATE TABLE recurring_transfer_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    day_of_month INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
    frequency TEXT NOT NULL DEFAULT 'monthly',
    start_date TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_recurring_transfer_templates_active ON recurring_transfer_templates(is_active);

-- One row per transfer that actually moved money. It is the persistent identity of an applied
-- occurrence (the role `income_entries.recurring_income_template_id` plays for income), so editing a
-- template never re-applies a past one, and the cause the two balance movements are keyed by.
-- A transfer is neither spending nor income, so it lives apart from `expenses`/`income_entries`
-- and never reaches a budget or an income total.
CREATE TABLE account_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recurring_transfer_template_id INTEGER
        REFERENCES recurring_transfer_templates(id) ON DELETE SET NULL,
    from_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_account_transfers_template ON account_transfers(recurring_transfer_template_id, date);
