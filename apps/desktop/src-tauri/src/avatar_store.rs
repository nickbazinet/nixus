//! The subject-scoped store for one account's profile picture.
//!
//! Deliberately its own SQLite file, `profiles/avatars.db`, rather than a table in
//! `nkbaz-finance.db`: an avatar belongs to the Cognito account, not to a dataset. Putting it in
//! the dataset would put it into every dataset backup, make it vanish when the user switches
//! datasets, and let a restore from another machine's export overwrite the face of whoever is
//! signed in here. It lives beside the demographic profile documents instead, under the same
//! `profiles/` directory, so `profile_store::delete_all_profiles`'s recursive removal takes it
//! structurally rather than by anyone remembering to add a second delete.
//!
//! Only the bounded derivative is stored — 256 px longest edge, at most 64 KiB — never the source
//! the user picked. Both places an avatar renders are small and round, so the source would be a
//! write-only megabyte per account, and the lazy read command's payload has to stay bounded
//! because the always-mounted account trigger is one of its callers.
//!
//! Validation is not reimplemented here: `projects::image` already owns the header proof, the
//! 4 MiB / 12 MP source ceilings, and the downscale ladder, and a second copy of that parser is
//! the one thing this module must not become.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;
use crate::profile_store;
use crate::projects::image;

const DB_FILE_NAME: &str = "avatars.db";

/// The `field` of the `AppError::Validation` raised when a file passed every source check but no
/// derivative under the ceiling could be produced from it.
///
/// Its own literal rather than reusing a `project_image_*` one: every other refusal describes the
/// file the user chose, while this one describes a failure to shrink a file that was perfectly
/// acceptable, and telling someone their valid photograph "is not a usable PNG or JPEG" sends
/// them to replace a file that was never the problem. The other half of this contract lives in
/// `userAvatarMessageKey` in `src/lib/appError.ts`.
pub const UNPROCESSABLE: &str = "user_avatar_unprocessable";

/// One stored row. `image_bytes` is already the derivative, so there is no second size to track:
/// `length(image_bytes)` is the only payload length that exists and the schema checks it directly.
#[derive(Debug, Clone)]
pub struct StoredAvatar {
    pub image_bytes: Vec<u8>,
    pub mime_type: String,
    pub uploaded_at: String,
}

pub fn avatars_db_path(dir: &Path) -> PathBuf {
    dir.join(DB_FILE_NAME)
}

fn unprocessable() -> AppError {
    AppError::Validation {
        message: "That image could not be prepared as a profile picture.".to_string(),
        field: Some(UNPROCESSABLE.to_string()),
    }
}

/// The bounded derivative a profile picture is stored as, read straight from the picked path.
///
/// One seam over `projects::image`, so the avatar path inherits the header proof and both source
/// ceilings unchanged. The returned mime type is the DERIVATIVE's, not the source's: the ladder
/// trades PNG for JPEG when PNG cannot fit the ceiling, so storing the source's type would label
/// half the rows wrong.
pub fn derive_from_file(file_path: &str) -> Result<(Vec<u8>, &'static str), AppError> {
    let (format, bytes) = image::read(file_path)?;

    image::thumbnail(&bytes, format).ok_or_else(unprocessable)
}

/// Opens — and on first use creates — the avatar database.
///
/// No WAL and no migration runner, unlike a dataset: this file holds one row per account with no
/// schema history to walk, and WAL would leave `-wal`/`-shm` siblings that the `profiles/`
/// recursive delete would have to be trusted to catch. `IF NOT EXISTS` is the whole schema
/// lifecycle.
///
/// Every guard is a separately named `CHECK`, matching `project_images`: SQLite reports the
/// failing constraint by name, so each rule stays independently diagnosable rather than
/// collapsing into one anonymous "CHECK constraint failed".
fn open(dir: &Path) -> Result<Connection, AppError> {
    std::fs::create_dir_all(dir).map_err(|e| AppError::File {
        message: format!("Failed to create profiles dir: {}", e),
    })?;

    let conn = Connection::open(avatars_db_path(dir))?;

    // The ceiling is interpolated from the same constant the derivation obeys, so the schema and
    // the encoder cannot drift into a state where a produced derivative is rejected on write.
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS user_avatars (
             cognito_sub TEXT PRIMARY KEY,
             image_bytes BLOB NOT NULL,
             mime_type TEXT NOT NULL,
             uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
             CONSTRAINT user_avatars_payload_positive CHECK (length(image_bytes) > 0),
             CONSTRAINT user_avatars_payload_ceiling CHECK (length(image_bytes) <= {}),
             CONSTRAINT user_avatars_mime_allowed CHECK (mime_type IN ('image/png', 'image/jpeg'))
         )",
        image::MAX_PROJECT_THUMBNAIL_BYTES
    ))?;

    Ok(conn)
}

/// This subject's avatar, or `None` when it has never set one.
///
/// The subject is validated through `profile_store` rather than here, so there is exactly one
/// charset authority for an identity key regardless of which store it reaches. An absent database
/// file is `None`, not an error: no avatar has ever been stored on this machine.
pub fn load_avatar(dir: &Path, sub: &str) -> Result<Option<StoredAvatar>, AppError> {
    profile_store::validate_sub(sub)?;

    if !avatars_db_path(dir).exists() {
        return Ok(None);
    }

    let conn = open(dir)?;

    conn.query_row(
        "SELECT image_bytes, mime_type, uploaded_at FROM user_avatars WHERE cognito_sub = ?1",
        params![sub],
        |row| {
            Ok(StoredAvatar {
                image_bytes: row.get(0)?,
                mime_type: row.get(1)?,
                uploaded_at: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(AppError::from)
}

/// Stores the derivative for this subject, replacing any previous one.
///
/// A single-row upsert keyed on the subject IS the "one avatar per account" rule, the same way
/// `project_images`' primary key is: replacement cannot leave the prior derivative behind, and no
/// second row can accumulate for the same identity. `uploaded_at` comes from SQLite's clock so a
/// caller cannot backdate it.
pub fn save_avatar(
    dir: &Path,
    sub: &str,
    image_bytes: &[u8],
    mime_type: &str,
) -> Result<StoredAvatar, AppError> {
    profile_store::validate_sub(sub)?;

    let conn = open(dir)?;

    conn.execute(
        "INSERT INTO user_avatars (cognito_sub, image_bytes, mime_type, uploaded_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(cognito_sub) DO UPDATE SET
             image_bytes = excluded.image_bytes,
             mime_type = excluded.mime_type,
             uploaded_at = excluded.uploaded_at",
        params![sub, image_bytes, mime_type],
    )?;

    // Read back rather than echo the arguments: `uploaded_at` is SQLite's clock, and a failed
    // write must not be able to return a row that was never stored.
    load_avatar(dir, sub)?.ok_or_else(|| AppError::Database {
        message: "The stored profile picture could not be read back".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    const SUB: &str = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const OTHER_SUB: &str = "99999999-8888-7777-6666-555555555555";

    fn profiles_dir(root: &TempDir) -> PathBuf {
        profile_store::profiles_dir(root.path())
    }

    fn field_of(error: &AppError) -> Option<String> {
        match error {
            AppError::Validation { field, .. } => field.clone(),
            _ => None,
        }
    }

    /// The smallest genuinely decodable payload, so the schema's checks are exercised against
    /// real bytes rather than a fabricated blob the encoder would never produce.
    fn derivative(edge: u32) -> Vec<u8> {
        image::rendered_test_image(edge, edge, false, image::ProjectImageFormat::Png)
    }

    fn temp_source(name: &str, bytes: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nixus-avatar-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(bytes).unwrap();
        path
    }

    /// The name of every failing constraint SQLite reported, so a test can assert WHICH rule
    /// refused rather than merely that something did.
    fn constraint_names(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_avatars'")
            .unwrap();
        let sql: String = stmt.query_row([], |row| row.get(0)).unwrap();

        sql.split("CONSTRAINT ")
            .skip(1)
            .filter_map(|fragment| fragment.split_whitespace().next())
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn the_database_lives_inside_the_profiles_directory() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);

        assert_eq!(avatars_db_path(&dir), dir.join("avatars.db"));
        assert!(
            avatars_db_path(&dir).starts_with(&dir),
            "the recursive profiles wipe is what removes this file, so it must sit inside it"
        );
    }

    // A read must not be able to create the store: `/profile` and the always-mounted account
    // trigger both call it on every launch, and a file appearing for an account that has never
    // uploaded anything is state the user never asked for.
    #[test]
    fn a_read_with_no_database_answers_none_and_creates_nothing() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);

        assert!(load_avatar(&dir, SUB).expect("load succeeds").is_none());
        assert!(!dir.exists(), "the read must not create the profiles dir");
        assert!(!avatars_db_path(&dir).exists());
    }

    #[test]
    fn a_saved_avatar_round_trips_with_its_mime_type() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);
        let payload = derivative(64);

        let saved = save_avatar(&dir, SUB, &payload, "image/png").expect("save succeeds");
        assert_eq!(saved.image_bytes, payload);
        assert_eq!(saved.mime_type, "image/png");
        assert!(!saved.uploaded_at.is_empty(), "SQLite's clock fills this in");

        let loaded = load_avatar(&dir, SUB)
            .expect("load succeeds")
            .expect("row present");
        assert_eq!(loaded.image_bytes, payload);
        assert_eq!(loaded.mime_type, "image/png");
    }

    // The replacement contract: one row, whatever the upload count. Two rows would mean the
    // previous derivative is still on disk after the user replaced it.
    #[test]
    fn replacing_an_avatar_upserts_one_row_rather_than_accumulating() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);
        let first = derivative(64);
        let second = image::rendered_test_image(48, 32, false, image::ProjectImageFormat::Jpeg);
        assert_ne!(first, second, "the fixtures must differ or this proves nothing");

        save_avatar(&dir, SUB, &first, "image/png").expect("first save succeeds");
        let replaced = save_avatar(&dir, SUB, &second, "image/jpeg").expect("second save succeeds");

        assert_eq!(replaced.image_bytes, second);
        assert_eq!(replaced.mime_type, "image/jpeg");

        let conn = open(&dir).expect("open succeeds");
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM user_avatars", [], |row| row.get(0))
            .expect("count succeeds");
        assert_eq!(rows, 1);
    }

    // The isolation invariant, and the reason the subject is resolved in Rust: one account's
    // upload may never be readable as another's, and the prior subject's row must not surface
    // when a different one signs in.
    #[test]
    fn each_subject_reads_only_its_own_avatar() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);
        let mine = derivative(64);
        let theirs = image::rendered_test_image(48, 48, true, image::ProjectImageFormat::Png);
        assert_ne!(mine, theirs);

        save_avatar(&dir, SUB, &mine, "image/png").expect("save succeeds");
        save_avatar(&dir, OTHER_SUB, &theirs, "image/png").expect("save succeeds");

        assert_eq!(
            load_avatar(&dir, SUB).expect("load").expect("row").image_bytes,
            mine
        );
        assert_eq!(
            load_avatar(&dir, OTHER_SUB)
                .expect("load")
                .expect("row")
                .image_bytes,
            theirs
        );
        assert!(
            load_avatar(&dir, "44444444-3333-2222-1111-000000000000")
                .expect("load succeeds")
                .is_none(),
            "a third subject has no avatar even though the table is populated"
        );
    }

    #[test]
    fn an_invalid_subject_is_rejected_on_both_read_and_write_without_touching_the_store() {
        let long = "x".repeat(129);
        for case in ["a/b", "../etc", "a.b", "", long.as_str()] {
            let root = TempDir::new().expect("temp dir");
            let dir = profiles_dir(&root);

            for error in [
                load_avatar(&dir, case).expect_err("load rejects"),
                save_avatar(&dir, case, &derivative(32), "image/png").expect_err("save rejects"),
            ] {
                assert_eq!(
                    field_of(&error).as_deref(),
                    Some("cognito_sub"),
                    "the one charset authority is profile_store's"
                );
            }

            assert!(!dir.exists(), "a rejected subject must touch no file");
        }
    }

    /// Named one guard per rule, so SQLite can say which rule refused. A conjunction would make
    /// all three indistinguishable in a failure report.
    #[test]
    fn every_schema_guard_is_separately_named() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);
        let conn = open(&dir).expect("open succeeds");

        let mut names = constraint_names(&conn);
        names.sort();

        assert_eq!(
            names,
            vec![
                "user_avatars_mime_allowed".to_string(),
                "user_avatars_payload_ceiling".to_string(),
                "user_avatars_payload_positive".to_string(),
            ]
        );
    }

    // The ceiling is the whole reason the lazy read stays bounded, so it is enforced by the
    // schema and not only by the encoder that happens to feed it today.
    #[test]
    fn a_payload_over_the_stored_ceiling_is_refused_by_the_named_constraint() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);
        let over = vec![7u8; usize::try_from(image::MAX_PROJECT_THUMBNAIL_BYTES).unwrap() + 1];

        let error = save_avatar(&dir, SUB, &over, "image/png").expect_err("the schema refuses");

        assert!(
            error.to_string().contains("user_avatars_payload_ceiling"),
            "the failing rule must be nameable: {error}"
        );
        assert!(load_avatar(&dir, SUB).expect("load succeeds").is_none());
    }

    #[test]
    fn an_empty_payload_is_refused_by_the_named_constraint() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);

        let error = save_avatar(&dir, SUB, &[], "image/png").expect_err("the schema refuses");

        assert!(
            error.to_string().contains("user_avatars_payload_positive"),
            "the failing rule must be nameable: {error}"
        );
    }

    #[test]
    fn a_mime_type_outside_the_two_the_encoder_produces_is_refused() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);

        for candidate in ["image/webp", "image/gif", "image/PNG", "text/plain", ""] {
            let error = save_avatar(&dir, SUB, &derivative(32), candidate)
                .expect_err(candidate)
                .to_string();

            assert!(
                error.contains("user_avatars_mime_allowed"),
                "{candidate}: {error}"
            );
        }
    }

    // A refused write must leave the previous face intact: the user still has an avatar, and
    // losing it to a failed replacement is worse than the replacement not landing.
    #[test]
    fn a_refused_replacement_leaves_the_previous_avatar_in_place() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);
        let original = derivative(64);
        save_avatar(&dir, SUB, &original, "image/png").expect("first save succeeds");

        save_avatar(&dir, SUB, &derivative(32), "image/webp").expect_err("the schema refuses");

        let loaded = load_avatar(&dir, SUB)
            .expect("load succeeds")
            .expect("the previous row survives");
        assert_eq!(loaded.image_bytes, original);
        assert_eq!(loaded.mime_type, "image/png");
    }

    // The wipe is structural, not a second delete anyone has to remember: the file is inside the
    // directory `delete_all_profiles` removes recursively.
    #[test]
    fn the_recursive_profiles_wipe_removes_the_avatar_database() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);
        save_avatar(&dir, SUB, &derivative(64), "image/png").expect("save succeeds");
        assert!(avatars_db_path(&dir).exists(), "the fixture must exist first");

        profile_store::delete_all_profiles(&dir).expect("the wipe succeeds");

        assert!(!avatars_db_path(&dir).exists());
        assert!(load_avatar(&dir, SUB).expect("load succeeds").is_none());
    }

    // No WAL: a sibling `-wal`/`-shm` would hold committed bytes outside the one file, and the
    // recursive wipe's guarantee is the whole reason this store has no sidecars.
    #[test]
    fn the_store_leaves_no_write_ahead_log_siblings() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(&root);

        save_avatar(&dir, SUB, &derivative(64), "image/png").expect("save succeeds");

        assert!(!dir.join("avatars.db-wal").exists());
        assert!(!dir.join("avatars.db-shm").exists());
    }

    /// The derivation seam. A real PNG well over the 256 px edge must come back downscaled and
    /// under the stored ceiling, which is what makes the schema's ceiling satisfiable.
    #[test]
    fn a_valid_source_derives_a_bounded_downscaled_derivative() {
        let source = image::rendered_test_image(800, 600, false, image::ProjectImageFormat::Png);
        let path = temp_source("portrait.png", &source);

        let (bytes, mime) = derive_from_file(path.to_str().unwrap()).expect("accepted");

        assert!(u64::try_from(bytes.len()).unwrap() <= image::MAX_PROJECT_THUMBNAIL_BYTES);
        assert!(mime == "image/png" || mime == "image/jpeg");
        let decoded = ::image::load_from_memory(&bytes).expect("the derivative decodes");
        assert_eq!(decoded.width(), image::THUMBNAIL_EDGE);
    }

    /// The source ceilings are inherited, not re-implemented: each refusal must still arrive with
    /// the `project_image_*` field the shared validator emits, so one i18n map covers both
    /// surfaces.
    #[test]
    fn the_inherited_source_refusals_keep_their_contracted_fields() {
        let cases: Vec<(&str, Vec<u8>, &str)> = vec![
            ("notes.txt", b"plain text".to_vec(), "project_image_unsupported_type"),
            ("blank.png", Vec::new(), "project_image_empty"),
            (
                "prose.png",
                b"this is plain text, not an image".to_vec(),
                "project_image_content_mismatch",
            ),
            (
                "over.png",
                vec![b'x'; usize::try_from(image::MAX_PROJECT_IMAGE_BYTES).unwrap() + 1],
                "project_image_too_large",
            ),
        ];

        for (name, bytes, expected) in cases {
            let path = temp_source(name, &bytes);
            let error = derive_from_file(path.to_str().unwrap()).expect_err("refused");

            assert_eq!(field_of(&error).as_deref(), Some(expected), "{name}");
        }
    }

    /// A header the validator accepts with no pixel data behind it: the source check passes and
    /// the downscale cannot run, which is the one case that needs its own field so the message is
    /// not "that file is not a usable image".
    #[test]
    fn a_source_that_cannot_be_downscaled_reports_the_unprocessable_field() {
        let mut header = b"\x89PNG\r\n\x1a\n".to_vec();
        header.extend_from_slice(&13u32.to_be_bytes());
        header.extend_from_slice(b"IHDR");
        header.extend_from_slice(&64u32.to_be_bytes());
        header.extend_from_slice(&64u32.to_be_bytes());
        header.extend_from_slice(&[8, 6, 0, 0, 0]);
        let path = temp_source("headeronly.png", &header);

        let error = derive_from_file(path.to_str().unwrap()).expect_err("refused");

        assert_eq!(field_of(&error).as_deref(), Some(UNPROCESSABLE));
    }

    /// Pinned as a literal because the other half of this contract lives in
    /// `src/lib/appError.ts`: renaming it here would compile, ship, and silently degrade the
    /// refusal to the generic fallback wording.
    #[test]
    fn the_unprocessable_field_is_the_contracted_literal() {
        assert_eq!(UNPROCESSABLE, "user_avatar_unprocessable");
    }

    /// AD-11: the picked path is the one value that must never reach a user-visible string, and
    /// this boundary reads a file the user chose from anywhere on disk.
    #[test]
    fn no_refusal_message_contains_the_source_path() {
        let marker = "nixus-avatar-privacy-marker";
        let dir = std::env::temp_dir().join(format!("{marker}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        for (name, bytes) in [
            ("a.txt", b"plain".to_vec()),
            ("b.png", Vec::new()),
            ("c.png", b"plain text, not an image".to_vec()),
        ] {
            let path = dir.join(name);
            std::fs::write(&path, &bytes).unwrap();
            let as_str = path.to_str().unwrap();

            let rendered = derive_from_file(as_str).unwrap_err().to_string();

            assert!(!rendered.contains(marker), "{name}: {rendered}");
            assert!(!rendered.contains(as_str), "{name}: {rendered}");
        }
    }
}
