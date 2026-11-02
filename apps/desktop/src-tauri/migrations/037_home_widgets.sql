-- The AI-generated Home Surface (PRD FR-8). One row per Widget; the dataset IS the profile, so the
-- table holds exactly one Home Surface.
--
-- `spec_json` is the Surface-Validated description only: Catalog Component names, Data Source
-- names and their bounded parameters. It never holds a resolved figure — every value a Widget shows
-- is read from the finance tables at render time.
--
-- `widget_key` is deliberately NOT unique: two computers can each add a widget while offline, and a
-- UNIQUE index would turn that ordinary merge into a refused remote apply. The key is minted with
-- enough entropy that a collision is not a realistic event.
CREATE TABLE home_widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    widget_key TEXT NOT NULL,
    position INTEGER NOT NULL,
    spec_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT home_widgets_key_not_empty CHECK (length(trim(widget_key)) > 0),
    CONSTRAINT home_widgets_spec_not_empty CHECK (length(trim(spec_json)) > 0)
);

CREATE INDEX idx_home_widgets_position ON home_widgets(position);
