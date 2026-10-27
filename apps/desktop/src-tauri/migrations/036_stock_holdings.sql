CREATE TABLE stock_holdings (
    passive_asset_id INTEGER PRIMARY KEY REFERENCES passive_assets(id) ON DELETE CASCADE,  -- the primary key IS the one-holding-per-asset rule
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    currency TEXT,                      -- NULL until the first successful quote: Yahoo search never reports one
    quantity_micros INTEGER NOT NULL,   -- 1e-6 shares, so fractional holdings stay integers
    last_price_cents INTEGER,           -- minor units of `currency`, NULL before the first successful quote
    last_price_at TEXT,
    fx_rate_to_base_micros INTEGER,     -- 1e-6 of base currency per unit of `currency`; 1000000 when they match
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- Named one guard per rule, never a conjunction: SQLite reports the failing
    -- constraint by name, so each rule is independently diagnosable and testable.
    CONSTRAINT stock_holdings_symbol_not_empty CHECK (length(trim(symbol)) > 0),
    CONSTRAINT stock_holdings_quantity_positive CHECK (quantity_micros > 0),
    CONSTRAINT stock_holdings_last_price_non_negative CHECK (last_price_cents IS NULL OR last_price_cents >= 0),
    CONSTRAINT stock_holdings_fx_rate_positive CHECK (fx_rate_to_base_micros IS NULL OR fx_rate_to_base_micros > 0)
);
