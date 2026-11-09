-- The brokerage account a holding sits in, so the Accounts page can show a live market value beside
-- the typed cash balance. NULL is the ordinary state: a holding the user never linked.
--
-- SET NULL and not RESTRICT, matching `expenses.account_id`: a holding is not money held in the
-- account the way a project contribution is, so deleting the account costs nothing but the link.
-- ADD COLUMN can carry a REFERENCES clause only because the default is NULL, which this is.
ALTER TABLE stock_holdings
    ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

-- The Accounts page reads holdings BY account, once per row, which is the only access path that
-- does not already have the primary key in hand.
CREATE INDEX idx_stock_holdings_account_id ON stock_holdings(account_id);
