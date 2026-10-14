-- Which full project images this computer has already put in the cloud (AD-10, AD-6).
--
-- WHY a table and not a column on `project_images`: the cloud object is keyed by CONTENT
-- (`blob/<sha256>`), so the fact "these bytes are stored" outlives the row that happens to
-- reference them — a picture replaced and then put back is already uploaded, and two projects
-- sharing one picture share one upload. A column would also be lost the moment the row is
-- rewritten by a later table rebuild.
--
-- WHY the name starts with `sync_`: AD-15 makes every `sync_*` table local-only, and the two
-- halves of the snapshot round trip already discover them by name — the strip empties every
-- `sync\_%` table in the snapshot copy (so this never travels) and the guarded restore carries
-- every `sync\_%` table over from the live file (so this computer keeps knowing what it sent).
-- Both work here with no edit, and `WIPE_TABLES` covers it so a wipe forgets it too.
CREATE TABLE sync_image_blobs (
    -- The hash of the FULL image bytes, lowercase hex: byte-for-byte the value
    -- `project_images.image_sha256` holds and the `blob/<sha256>` key it names.
    image_sha256 TEXT PRIMARY KEY,

    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Named table constraint, like migration 029's: a violation reports which invariant broke.
    -- The GLOB is what rejects uppercase and non-hex, which a length check alone would admit —
    -- and a non-digest here would be concatenated into an object key.
    CONSTRAINT sync_image_blobs_hash_is_hex CHECK (
        length(image_sha256) = 64 AND image_sha256 NOT GLOB '*[^0-9a-f]*'
    )
);
