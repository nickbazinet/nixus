-- The user-owned half of a Home widget (PRD FR-8 follow-up). Three columns, deliberately NOT three
-- more keys inside `spec_json`.
--
-- `spec_json` is AI-owned and Surface-Validated against a closed schema that refuses any key the
-- Catalog does not declare. Putting a manual rename or a chosen colour in there would mean either
-- opening that schema — which is the one thing keeping a hallucinated key out of the renderer — or
-- teaching the generation prompt about presentation it has no business choosing. Worse, a modify
-- re-emits the whole widget document (FR-6), so every tweak the user had made would be overwritten
-- by the next "make it a bar chart".
--
-- As columns, the opposite is true for free: the Modify branch UPDATEs `spec_json` alone, so the
-- user's choices survive an AI modify without that branch knowing they exist.
--
-- `title_override` NULL means "show the AI's title", which is how a rename is undone rather than
-- stored as an empty string. `span` is a grid span, not a pixel width. `accent` is an OFFSET into
-- the renderer's 8-step chart ramp, not a colour: the ramp is rank-ordered with an alternating
-- luminance adjacency, and rotating its start preserves that property where a free-form hex would
-- not.
ALTER TABLE home_widgets ADD COLUMN title_override TEXT;

ALTER TABLE home_widgets ADD COLUMN span INTEGER NOT NULL DEFAULT 1
    CONSTRAINT home_widgets_span_range CHECK (span IN (1, 2));

ALTER TABLE home_widgets ADD COLUMN accent INTEGER
    CONSTRAINT home_widgets_accent_range CHECK (accent IS NULL OR accent BETWEEN 0 AND 7);
