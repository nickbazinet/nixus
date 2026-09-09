CREATE TABLE project_images (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,  -- the primary key IS the at-most-one-image-per-project rule
    image_bytes BLOB NOT NULL,
    mime_type TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    byte_size INTEGER NOT NULL,     -- denormalized so metadata reads never load the blob
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- Named one guard per rule, never a conjunction: SQLite reports the failing
    -- constraint by name, so each rule is independently diagnosable and testable.
    CONSTRAINT project_images_byte_size_positive CHECK (byte_size > 0),
    CONSTRAINT project_images_byte_size_ceiling CHECK (byte_size <= 4194304),  -- 4 MiB
    CONSTRAINT project_images_byte_size_matches_payload CHECK (byte_size = length(image_bytes)),
    CONSTRAINT project_images_mime_allowed CHECK (mime_type IN ('image/png', 'image/jpeg'))
);
