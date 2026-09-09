-- The downscaled derivative the project list renders, so a collapsed row never pays for the
-- full-size payload behind `get_project_image`.
--
-- Both columns are NULLABLE, and that is a deliberate state rather than a gap: a row written
-- before this migration has no derivative yet (the lazy backfill fills it on the next list read),
-- and a picture whose thumbnail could not be produced must still be storable rather than have its
-- upload refused.
--
-- NO NAMED CHECKS HERE, unlike migration 026. SQLite's ALTER TABLE ADD COLUMN accepts only a
-- column definition, so the `CONSTRAINT <name> CHECK (...)` form that gives 026 its four
-- independently-diagnosable guards is unavailable without rebuilding the table and rewriting every
-- stored blob. The two rules those constraints would carry -- `thumbnail_mime` restricted to the
-- same allow-list as `mime_type`, and `length(thumbnail_bytes) <= 65536` -- are therefore enforced
-- in Rust instead, in `db::projects::validated_thumbnail`, which every path that binds these two
-- columns goes through.
ALTER TABLE project_images ADD COLUMN thumbnail_bytes BLOB;
ALTER TABLE project_images ADD COLUMN thumbnail_mime TEXT;
