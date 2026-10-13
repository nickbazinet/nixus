-- Content-addressed, lazily-fetched project images (AD-10).
--
-- WHY a table rebuild and not two `ALTER TABLE`s: `image_bytes` has to become NULLABLE and
-- `project_images_byte_size_matches_payload` has to stop requiring a payload. SQLite can add a
-- column in place but can neither drop a NOT NULL nor rewrite a CHECK, so the twelve-step rebuild
-- is the only route. It is a one-time rewrite of every stored blob, which is exactly what AD-10
-- budgets for.
--
-- There is NO `VACUUM` and no `VACUUM INTO` here (project-context rule 12: no image path may call
-- `VACUUM`; AD-9: `VACUUM INTO` may renumber rowids). The pages the old table releases return to
-- SQLite's freelist and the next image reuses them.
--
-- `project_images` has no index and no trigger (migration 026 created neither, 027 added neither),
-- and nothing references it: the only foreign key is its own outgoing one to `projects`. So the
-- rebuild has nothing to re-create beyond the table itself, and the rename cannot strand a
-- referencing key. The column ORDER is preserved as 026 + 027 left it, with the two new columns
-- appended, so a positional read written against the old table still lands on the same values.

CREATE TABLE project_images_rebuilt (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,  -- the primary key IS the at-most-one-image-per-project rule

    -- NULLABLE as of this migration, and that is a STATE rather than a gap: the full image either
    -- has not been fetched from `blob/<sha256>` yet (a new computer, AD-10) or was deliberately
    -- blanked out of a snapshot copy (AD-9). The thumbnail below is what the UI renders meanwhile.
    image_bytes BLOB,

    mime_type TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    byte_size INTEGER NOT NULL,     -- denormalized so metadata reads never load the blob, and so the size survives the bytes being absent
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    thumbnail_bytes BLOB,
    thumbnail_mime TEXT,

    -- The sha256 of the FULL image bytes, lowercase hex. It is the identity of the picture, not a
    -- checksum of this row: `blob/<image_sha256>` is the object key (AD-6), so the hash has to
    -- outlive the bytes or a blanked row could never fetch itself back. NOT NULL for the same
    -- reason -- a row that cannot name its blob is unreachable, not lazy.
    image_sha256 TEXT NOT NULL,

    -- Named one guard per rule, never a conjunction: SQLite reports the failing constraint by name,
    -- so each rule is independently diagnosable and testable.
    CONSTRAINT project_images_byte_size_positive CHECK (byte_size > 0),
    CONSTRAINT project_images_byte_size_ceiling CHECK (byte_size <= 4194304),  -- 4 MiB

    -- RELAXED (was `byte_size = length(image_bytes)`): the size still has to describe the payload
    -- whenever there is one, but an absent payload is now legal. Dropping the rule instead would
    -- let a present payload disagree with its own length.
    CONSTRAINT project_images_byte_size_matches_payload
        CHECK (image_bytes IS NULL OR byte_size = length(image_bytes)),

    CONSTRAINT project_images_mime_allowed CHECK (mime_type IN ('image/png', 'image/jpeg')),

    CONSTRAINT project_images_image_sha256_is_hex
        CHECK (length(image_sha256) = 64 AND image_sha256 NOT GLOB '*[^0-9a-f]*'),

    -- The three rules migration 027 had to enforce in Rust instead of in the schema, because
    -- `ALTER TABLE ADD COLUMN` takes only a column definition. The rebuild is the first chance to
    -- state them where they cannot be bypassed; `db::projects::validated_thumbnail` stays as the
    -- path that reports them as errors rather than as constraint failures.
    CONSTRAINT project_images_thumbnail_is_whole_or_absent
        CHECK ((thumbnail_bytes IS NULL) = (thumbnail_mime IS NULL)),
    CONSTRAINT project_images_thumbnail_mime_allowed
        CHECK (thumbnail_mime IS NULL OR thumbnail_mime IN ('image/png', 'image/jpeg')),
    CONSTRAINT project_images_thumbnail_byte_ceiling
        CHECK (thumbnail_bytes IS NULL OR length(thumbnail_bytes) <= 65536)  -- 64 KiB
);

-- The full bytes are copied VERBATIM: this migration must not change a single stored byte.
--
-- The thumbnail is NORMALISED to NULL when a legacy row cannot satisfy one of the three new
-- guards. WHY normalise instead of letting the CHECK fire: a constraint that can fail on data
-- already on disk would turn this migration into a launch that never completes, and the thumbnail
-- is a regenerable derivative -- `get_project_thumbnails` re-derives a NULL one on the next list
-- read. The full image, which is NOT regenerable, is never touched by this rule.
--
-- `nixus_sha256_hex` is a connection-scoped scalar function registered by `db::run_migrations`
-- for exactly this statement and removed immediately afterwards. It is what lets the backfill and
-- the `NOT NULL` land in one atomic migration instead of a nullable column plus a later pass that
-- could be interrupted.
INSERT INTO project_images_rebuilt
    (project_id, image_bytes, mime_type, original_filename, byte_size, uploaded_at,
     thumbnail_bytes, thumbnail_mime, image_sha256)
SELECT
    project_id,
    image_bytes,
    mime_type,
    original_filename,
    byte_size,
    uploaded_at,
    CASE
        WHEN thumbnail_bytes IS NULL OR thumbnail_mime IS NULL THEN NULL
        WHEN thumbnail_mime NOT IN ('image/png', 'image/jpeg') THEN NULL
        WHEN length(thumbnail_bytes) > 65536 THEN NULL
        ELSE thumbnail_bytes
    END,
    CASE
        WHEN thumbnail_bytes IS NULL OR thumbnail_mime IS NULL THEN NULL
        WHEN thumbnail_mime NOT IN ('image/png', 'image/jpeg') THEN NULL
        WHEN length(thumbnail_bytes) > 65536 THEN NULL
        ELSE thumbnail_mime
    END,
    nixus_sha256_hex(image_bytes)
FROM project_images;

DROP TABLE project_images;

ALTER TABLE project_images_rebuilt RENAME TO project_images;
