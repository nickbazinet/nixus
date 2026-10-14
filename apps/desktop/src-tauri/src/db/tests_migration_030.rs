//! Migration 030 against REAL-SIZE images: the table rebuild that makes `image_bytes` nullable,
//! adds `image_sha256` and relaxes the size CHECK (AD-10).
//!
//! WHY its own module and its own fixtures: every other image test uses a handful of bytes, and a
//! handful of bytes cannot catch what a rebuild gets wrong. A multi-megabyte BLOB is copied through
//! SQLite's record format, spills across overflow pages and is the only payload where a truncation,
//! an encoding round trip or a silent `CAST` would actually show up. The payloads here are
//! deterministic pseudo-random bytes (incompressible, so nothing can be "equal" by accident) at the
//! sizes production really holds: one just under the 4 MiB ceiling, one mid-sized, and one byte.

use std::time::{Duration, Instant};

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::{open_configured, run_migrations_up_to};
use crate::projects::image::sha256_hex;

/// The schema as it was before this migration: the last version that still had `image_bytes NOT
/// NULL` and no `image_sha256`.
const SCHEMA_BEFORE_030: i64 = 29;

/// A deterministic, incompressible payload. The generator is a plain LCG rather than a crate so the
/// bytes are reproducible across platforms and the test carries no fixture files.
fn pseudo_random_image(seed: u64, len: usize) -> Vec<u8> {
    let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;

    (0..len)
        .map(|_| {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (state >> 33) as u8
        })
        .collect()
}

/// One pre-migration row, in the old table's shape.
struct LegacyImage {
    project_id: i64,
    bytes: Vec<u8>,
    mime_type: &'static str,
    thumbnail_bytes: Option<Vec<u8>>,
    thumbnail_mime: Option<&'static str>,
}

/// Every row shape the old table could hold, including the ones the new CHECKs would reject if the
/// migration copied them verbatim.
fn legacy_rows() -> Vec<LegacyImage> {
    vec![
        // Just under the 4 MiB ceiling: the row this whole migration is a cost risk for.
        LegacyImage {
            project_id: 1,
            bytes: pseudo_random_image(1, 4_194_303),
            mime_type: "image/jpeg",
            thumbnail_bytes: Some(pseudo_random_image(11, 2_048)),
            thumbnail_mime: Some("image/png"),
        },
        // Mid-sized, and a row written before migration 027 so it has no derivative at all.
        LegacyImage {
            project_id: 2,
            bytes: pseudo_random_image(2, 2_000_000),
            mime_type: "image/png",
            thumbnail_bytes: None,
            thumbnail_mime: None,
        },
        // One byte: the smallest payload the positive-size guard admits.
        LegacyImage {
            project_id: 3,
            bytes: vec![0x5a],
            mime_type: "image/png",
            thumbnail_bytes: None,
            thumbnail_mime: None,
        },
        // A thumbnail exactly at the 64 KiB ceiling, which must be KEPT, not normalised away.
        LegacyImage {
            project_id: 4,
            bytes: pseudo_random_image(4, 1_000_000),
            mime_type: "image/png",
            thumbnail_bytes: Some(pseudo_random_image(44, 65_536)),
            thumbnail_mime: Some("image/png"),
        },
        // Half a derivative: bytes with no mime. The old table had no guard against it.
        LegacyImage {
            project_id: 5,
            bytes: pseudo_random_image(5, 512),
            mime_type: "image/png",
            thumbnail_bytes: Some(pseudo_random_image(55, 128)),
            thumbnail_mime: None,
        },
        // A derivative over the ceiling and one in a format the allow-list refuses: both were
        // storable before 030 because 027 could only enforce those rules in Rust.
        LegacyImage {
            project_id: 6,
            bytes: pseudo_random_image(6, 512),
            mime_type: "image/png",
            thumbnail_bytes: Some(pseudo_random_image(66, 70_000)),
            thumbnail_mime: Some("image/png"),
        },
        LegacyImage {
            project_id: 7,
            bytes: pseudo_random_image(7, 512),
            mime_type: "image/png",
            thumbnail_bytes: Some(pseudo_random_image(77, 256)),
            thumbnail_mime: Some("image/gif"),
        },
    ]
}

fn open_at_schema_29(path: &std::path::Path) -> Connection {
    let conn = Connection::open(path).expect("the database opens");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .expect("the pragmas apply");
    run_migrations_up_to(&conn, SCHEMA_BEFORE_030).expect("the pre-030 schema applies");

    conn
}

/// A database at schema 29 holding every legacy row, closed so the next open is a real launch.
fn seeded_pre_030_database() -> (TempDir, std::path::PathBuf, Vec<LegacyImage>) {
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join("nixus.db");
    let conn = open_at_schema_29(&path);

    let rows = legacy_rows();
    for row in &rows {
        conn.execute(
            "INSERT INTO projects (id, name, target_cents) VALUES (?1, ?2, 500000)",
            rusqlite::params![row.project_id, format!("Project {}", row.project_id)],
        )
        .expect("the project seeds");
        conn.execute(
            "INSERT INTO project_images
                 (project_id, image_bytes, mime_type, original_filename, byte_size, uploaded_at,
                  thumbnail_bytes, thumbnail_mime)
             VALUES (?1, ?2, ?3, ?4, ?5, '2026-01-02 03:04:05', ?6, ?7)",
            rusqlite::params![
                row.project_id,
                row.bytes,
                row.mime_type,
                format!("cover-{}.png", row.project_id),
                i64::try_from(row.bytes.len()).expect("the length fits an i64"),
                row.thumbnail_bytes,
                row.thumbnail_mime,
            ],
        )
        .expect("the legacy image seeds");
    }

    drop(conn);

    (dir, path, rows)
}

/// Applies 030 the way a launch does, and reports how long it took.
fn migrate(path: &std::path::Path) -> (Connection, Duration) {
    let started = Instant::now();
    let conn = open_configured(path).expect("the migration runs on open");

    (conn, started.elapsed())
}

fn stored(conn: &Connection, project_id: i64) -> (Option<Vec<u8>>, String, i64, String, String) {
    conn.query_row(
        "SELECT image_bytes, image_sha256, byte_size, mime_type, uploaded_at
         FROM project_images WHERE project_id = ?1",
        rusqlite::params![project_id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )
    .expect("the migrated row reads")
}

fn stored_thumbnail(conn: &Connection, project_id: i64) -> (Option<Vec<u8>>, Option<String>) {
    conn.query_row(
        "SELECT thumbnail_bytes, thumbnail_mime FROM project_images WHERE project_id = ?1",
        rusqlite::params![project_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .expect("the migrated row reads")
}

/// The one assertion this migration absolutely cannot fail: a rewrite that changes a stored
/// picture by a single byte has destroyed the user's data.
#[test]
fn every_stored_image_survives_the_rebuild_byte_for_byte_with_its_hash_backfilled() {
    let (_dir, path, rows) = seeded_pre_030_database();
    let (conn, _) = migrate(&path);

    for row in &rows {
        let (bytes, hash, byte_size, mime_type, uploaded_at) = stored(&conn, row.project_id);

        assert_eq!(
            bytes.as_deref(),
            Some(row.bytes.as_slice()),
            "project {} must keep its exact payload",
            row.project_id
        );
        assert_eq!(
            hash,
            sha256_hex(&row.bytes),
            "project {} must carry the sha256 of its own bytes",
            row.project_id
        );
        assert_eq!(byte_size, i64::try_from(row.bytes.len()).unwrap());
        assert_eq!(mime_type, row.mime_type);
        assert_eq!(
            uploaded_at, "2026-01-02 03:04:05",
            "the upload timestamp is the user's and must not be re-stamped"
        );
    }
}

#[test]
fn a_usable_thumbnail_is_kept_and_only_an_unusable_one_is_dropped() {
    let (_dir, path, rows) = seeded_pre_030_database();
    let (conn, _) = migrate(&path);

    let kept = |project_id: i64| {
        let row = rows
            .iter()
            .find(|row| row.project_id == project_id)
            .expect("the row exists");
        assert_eq!(
            stored_thumbnail(&conn, project_id),
            (
                row.thumbnail_bytes.clone(),
                row.thumbnail_mime.map(str::to_string)
            ),
            "project {project_id} must keep its derivative untouched"
        );
    };

    kept(1);
    kept(2);
    kept(3);
    kept(4);

    // Half-written, oversized and unknown-format derivatives are normalised to absent rather than
    // failing the new CHECKs, which is what keeps the migration from bricking a launch. They are
    // re-derived by the existing lazy backfill.
    for normalised in [5, 6, 7] {
        assert_eq!(
            stored_thumbnail(&conn, normalised),
            (None, None),
            "project {normalised} must come out with no derivative at all"
        );
    }
}

#[test]
fn the_rebuilt_table_accepts_an_absent_payload_and_leaves_the_table_shape_intact() {
    let (_dir, path, _) = seeded_pre_030_database();
    let (conn, _) = migrate(&path);

    let columns: Vec<(String, String, i64, i64)> = conn
        .prepare("SELECT name, type, \"notnull\", pk FROM pragma_table_info('project_images')")
        .expect("the pragma prepares")
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .expect("the pragma runs")
        .collect::<Result<Vec<_>, _>>()
        .expect("the pragma rows read");

    assert!(
        columns.contains(&("image_bytes".to_string(), "BLOB".to_string(), 0, 0)),
        "image_bytes must be nullable, got {columns:?}"
    );
    assert!(
        columns.contains(&("image_sha256".to_string(), "TEXT".to_string(), 1, 0)),
        "image_sha256 must be NOT NULL, got {columns:?}"
    );
    assert!(
        columns.contains(&("project_id".to_string(), "INTEGER".to_string(), 0, 1)),
        "project_id must still be the primary key, got {columns:?}"
    );
    for preserved in ["mime_type", "original_filename", "byte_size", "uploaded_at"] {
        assert!(
            columns
                .iter()
                .any(|(name, _, notnull, _)| name == preserved && *notnull == 1),
            "{preserved} must survive the rebuild as NOT NULL, got {columns:?}"
        );
    }

    // The relaxation itself: metadata complete, payload absent. This is the state a new computer
    // is in before the blob has been fetched.
    conn.execute(
        "UPDATE project_images SET image_bytes = NULL WHERE project_id = 2",
        [],
    )
    .expect("a payload may now be absent");
    let (bytes, hash, byte_size, _, _) = stored(&conn, 2);
    assert_eq!(bytes, None);
    assert_eq!(byte_size, 2_000_000, "the size must outlive the payload");
    assert_eq!(hash.len(), 64, "the hash must outlive the payload");

    // And the scratch table the rebuild went through must not survive it.
    let leftovers: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'project_images_rebuilt'",
            [],
            |row| row.get(0),
        )
        .expect("sqlite_master reads");
    assert_eq!(leftovers, 0, "the rebuild must leave no scratch table behind");
}

#[test]
fn each_storage_rule_of_the_rebuilt_table_refuses_by_name() {
    let (_dir, path, _) = seeded_pre_030_database();
    let (conn, _) = migrate(&path);

    let refusal = |columns: &str, values: &str| {
        conn.execute(
            &format!("INSERT INTO project_images ({columns}) VALUES ({values})"),
            [],
        )
        .expect_err("the row must violate a storage guard")
        .to_string()
    };

    let valid_hash = "a".repeat(64);
    let base = "project_id, mime_type, original_filename, byte_size, image_sha256";

    for (expected_constraint, columns, values) in [
        (
            "project_images_byte_size_positive",
            base.to_string(),
            format!("100, 'image/png', 'c.png', 0, '{valid_hash}'"),
        ),
        (
            "project_images_byte_size_ceiling",
            base.to_string(),
            format!("100, 'image/png', 'c.png', 4194305, '{valid_hash}'"),
        ),
        (
            "project_images_byte_size_matches_payload",
            format!("{base}, image_bytes"),
            format!("100, 'image/png', 'c.png', 9, '{valid_hash}', x'0102'"),
        ),
        (
            "project_images_mime_allowed",
            base.to_string(),
            format!("100, 'image/gif', 'c.gif', 4, '{valid_hash}'"),
        ),
        (
            "project_images_image_sha256_is_hex",
            base.to_string(),
            "100, 'image/png', 'c.png', 4, 'NOTAHASH'".to_string(),
        ),
        (
            "project_images_image_sha256_is_hex",
            base.to_string(),
            format!("100, 'image/png', 'c.png', 4, '{}'", "A".repeat(64)),
        ),
        (
            "project_images_thumbnail_is_whole_or_absent",
            format!("{base}, thumbnail_bytes"),
            format!("100, 'image/png', 'c.png', 4, '{valid_hash}', x'0102'"),
        ),
        (
            "project_images_thumbnail_mime_allowed",
            format!("{base}, thumbnail_bytes, thumbnail_mime"),
            format!("100, 'image/png', 'c.png', 4, '{valid_hash}', x'0102', 'image/gif'"),
        ),
        (
            "project_images_thumbnail_byte_ceiling",
            format!("{base}, thumbnail_bytes, thumbnail_mime"),
            format!(
                "100, 'image/png', 'c.png', 4, '{valid_hash}', zeroblob(65537), 'image/png'"
            ),
        ),
    ] {
        let error = refusal(&columns, &values);
        assert!(
            error.contains(expected_constraint),
            "expected {expected_constraint} by name, got: {error}"
        );
    }

    // A missing hash is refused by the column, which is the invariant that keeps every row able to
    // name its own blob.
    let error = refusal(
        "project_id, mime_type, original_filename, byte_size",
        "100, 'image/png', 'c.png', 4",
    );
    assert!(
        error.contains("image_sha256"),
        "expected the NOT NULL on image_sha256, got: {error}"
    );
}

#[test]
fn the_cascade_and_the_project_foreign_key_survive_the_rebuild() {
    let (_dir, path, _) = seeded_pre_030_database();
    let (conn, _) = migrate(&path);

    let foreign_keys: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .expect("the pragma reads");
    assert_eq!(foreign_keys, 1, "the connection must enforce foreign keys");

    conn.execute(
        "INSERT INTO project_images (project_id, mime_type, original_filename, byte_size,
                                     image_sha256)
         VALUES (999, 'image/png', 'orphan.png', 4, ?1)",
        rusqlite::params!["b".repeat(64)],
    )
    .expect_err("an image for a project that does not exist must be refused");

    conn.execute("DELETE FROM projects WHERE id = 1", [])
        .expect("the project deletes");
    let remaining: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM project_images WHERE project_id = 1",
            [],
            |row| row.get(0),
        )
        .expect("the count reads");
    assert_eq!(remaining, 0, "ON DELETE CASCADE must still be wired");
}

#[test]
fn re_opening_the_migrated_database_changes_nothing() {
    let (_dir, path, rows) = seeded_pre_030_database();
    let (conn, first) = migrate(&path);
    drop(conn);

    let (conn, second) = migrate(&path);

    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
            row.get(0)
        })
        .expect("the version reads");
    assert_eq!(
        version,
        crate::db::latest_schema_version(),
        "a re-open must not re-apply or advance anything"
    );

    let applications: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_version WHERE version = 30",
            [],
            |row| row.get(0),
        )
        .expect("the count reads");
    assert_eq!(applications, 1, "030 must be recorded exactly once");

    for row in &rows {
        let (bytes, hash, _, _, _) = stored(&conn, row.project_id);
        assert_eq!(bytes.as_deref(), Some(row.bytes.as_slice()));
        assert_eq!(hash, sha256_hex(&row.bytes));
    }

    // The second open applies no migration at all, so it cannot be slower than the one that
    // rewrote every blob. This is the cheapest available proof that the rewrite is not repeated on
    // every launch -- a re-run would read as a comparable duration.
    assert!(
        second < first,
        "a no-op open ({second:?}) must be faster than the rewriting one ({first:?})"
    );
}

/// The cost of the rewrite, measured rather than assumed, because "a one-time rewrite of stored
/// blobs" is only acceptable if it is seconds and not minutes. Two images just under the ceiling
/// plus their hashes; the recorded local figure is in the story's spec. The ceiling is loose on
/// purpose: it is a regression guard against an accidental O(n^2) rebuild, not a benchmark.
#[test]
fn the_one_time_rewrite_of_two_near_ceiling_images_is_measured_and_bounded() {
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join("nixus.db");
    let conn = open_at_schema_29(&path);

    let large = [pseudo_random_image(81, 4_000_000), pseudo_random_image(82, 4_000_000)];
    for (index, bytes) in large.iter().enumerate() {
        let project_id = i64::try_from(index).unwrap() + 1;
        conn.execute(
            "INSERT INTO projects (id, name, target_cents) VALUES (?1, 'Big', 500000)",
            rusqlite::params![project_id],
        )
        .expect("the project seeds");
        conn.execute(
            "INSERT INTO project_images
                 (project_id, image_bytes, mime_type, original_filename, byte_size)
             VALUES (?1, ?2, 'image/jpeg', 'big.jpg', ?3)",
            rusqlite::params![project_id, bytes, i64::try_from(bytes.len()).unwrap()],
        )
        .expect("the legacy image seeds");
    }
    drop(conn);

    let (conn, elapsed) = migrate(&path);
    println!("migration 030 rewrote 2 x 4 MB images in {elapsed:?}");

    for (index, bytes) in large.iter().enumerate() {
        let project_id = i64::try_from(index).unwrap() + 1;
        let (stored_bytes, hash, _, _, _) = stored(&conn, project_id);
        assert_eq!(stored_bytes.as_deref(), Some(bytes.as_slice()));
        assert_eq!(hash, sha256_hex(bytes));
    }

    assert!(
        elapsed < Duration::from_secs(10),
        "the one-time rewrite of two near-ceiling images took {elapsed:?}"
    );
}
