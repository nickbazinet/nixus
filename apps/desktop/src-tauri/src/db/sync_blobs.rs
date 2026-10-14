//! Every statement of the lazy project-image path (AD-10): which full images this computer
//! still owes the cloud, and which one a fetch has to go and get.
//!
//! It lives in `db/` because that is where this project keeps SQL, and it is separate from
//! `db/projects.rs` because the questions are about SYNC bookkeeping rather than about a
//! project: `project_images` is read here only as the left side of "what is not uploaded yet".

use rusqlite::{params, OptionalExtension};

use crate::error::AppError;

/// What a fetch of one project's picture has to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageFetchTarget {
    /// There is no picture for this project, so there is nothing to fetch.
    NoImage,
    /// The full bytes are already here: answer from the dataset and touch no network.
    AlreadyLocal,
    /// The row knows its picture only by hash (AD-10's lazy state).
    Needed { image_sha256: String },
}

/// The upload queue: content hashes, in a stable order so a retry resumes where it left off.
///
/// Hashes and not rows, and `DISTINCT`, because the cloud object is keyed by content: two
/// projects showing the same picture owe ONE upload between them (AD-6).
///
/// `image_bytes IS NOT NULL` is the whole of "never upload a picture this computer does not
/// have": a row that arrived in a snapshot, or one fetched and later blanked, has a hash but no
/// payload, and uploading on its behalf would mean inventing bytes. `NOT EXISTS` against the
/// marker is what makes the second sync cycle cost zero requests.
pub fn pending_image_blobs(conn: &rusqlite::Connection) -> Result<Vec<String>, AppError> {
    let mut statement = conn.prepare(
        "SELECT DISTINCT pi.image_sha256
         FROM project_images pi
         WHERE pi.image_bytes IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM sync_image_blobs sib WHERE sib.image_sha256 = pi.image_sha256
           )
         ORDER BY pi.image_sha256",
    )?;

    let rows = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;

    Ok(rows)
}

/// The payload to upload, addressed by CONTENT rather than by project.
///
/// Read one at a time, and by hash: the picture may have been replaced between the queue read
/// and this call, in which case there is nothing under that hash any more and the upload is
/// skipped instead of sending the new picture under the old key.
pub fn image_blob_bytes(
    conn: &rusqlite::Connection,
    image_sha256: &str,
) -> Result<Option<Vec<u8>>, AppError> {
    conn.query_row(
        "SELECT image_bytes FROM project_images
         WHERE image_sha256 = ?1 AND image_bytes IS NOT NULL
         LIMIT 1",
        params![image_sha256],
        |row| row.get(0),
    )
    .optional()
    .map_err(AppError::from)
}

/// Records that these bytes are in the cloud. Idempotent, because the same content can be
/// reached from two rows and an upload is safe to repeat.
pub fn mark_image_blob_uploaded(
    conn: &rusqlite::Connection,
    image_sha256: &str,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO sync_image_blobs (image_sha256) VALUES (?1)
         ON CONFLICT(image_sha256) DO NOTHING",
        params![image_sha256],
    )?;

    Ok(())
}

pub fn image_fetch_target(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> Result<ImageFetchTarget, AppError> {
    let found: Option<(bool, String)> = conn
        .query_row(
            "SELECT image_bytes IS NOT NULL, image_sha256 FROM project_images
             WHERE project_id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    Ok(match found {
        None => ImageFetchTarget::NoImage,
        Some((true, _)) => ImageFetchTarget::AlreadyLocal,
        Some((false, image_sha256)) => ImageFetchTarget::Needed { image_sha256 },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::projects::{
        set_project_image_bytes, upsert_project_image, ProjectImageWrite,
    };
    use crate::projects::image::sha256_hex;
    use rusqlite::Connection;
    use tempfile::TempDir;

    fn dataset() -> (TempDir, Connection) {
        let dir = TempDir::new().expect("a temp dir");
        let conn = crate::db::init_db(dir.path()).expect("the dataset migrates");
        conn.execute_batch(
            "INSERT INTO projects (id, name, target_cents) VALUES (1, 'One', 100), (2, 'Two', 100)",
        )
        .expect("two projects exist");

        (dir, conn)
    }

    fn store_image(conn: &Connection, project_id: i64, bytes: &[u8]) -> String {
        upsert_project_image(
            conn,
            project_id,
            &ProjectImageWrite {
                mime_type: "image/png",
                original_filename: "cover.png",
                bytes,
                thumbnail: None,
            },
        )
        .expect("the image stores");

        sha256_hex(bytes)
    }

    #[test]
    fn a_locally_present_image_is_pending_until_it_is_marked() {
        let (_dir, conn) = dataset();
        let hash = store_image(&conn, 1, b"a picture");

        assert_eq!(
            pending_image_blobs(&conn).expect("the queue reads"),
            vec![hash.clone()]
        );

        mark_image_blob_uploaded(&conn, &hash).expect("the marker writes");

        assert_eq!(
            pending_image_blobs(&conn).expect("the queue reads"),
            Vec::<String>::new()
        );
    }

    /// The marker is keyed by content, so the second row costs no second upload — which is the
    /// whole point of `blob/<sha256>` being content-addressed (AD-6).
    #[test]
    fn two_projects_sharing_one_picture_are_one_upload() {
        let (_dir, conn) = dataset();
        let hash = store_image(&conn, 1, b"same picture");
        store_image(&conn, 2, b"same picture");

        assert_eq!(
            pending_image_blobs(&conn).expect("the queue reads"),
            vec![hash.clone()],
            "one hash, not one row per project"
        );

        mark_image_blob_uploaded(&conn, &hash).expect("the marker writes");

        assert_eq!(
            pending_image_blobs(&conn).expect("the queue reads"),
            Vec::<String>::new()
        );
    }

    /// AD-10's lazy row: a hash with no payload is never uploaded, because this computer has no
    /// bytes to upload for it.
    #[test]
    fn a_row_whose_bytes_are_absent_is_never_pending_and_is_fetchable() {
        let (_dir, conn) = dataset();
        let hash = store_image(&conn, 1, b"a picture");
        crate::db::projects::blank_project_image_bytes(&conn).expect("the payload is dropped");

        assert_eq!(
            pending_image_blobs(&conn).expect("the queue reads"),
            Vec::<String>::new()
        );
        assert_eq!(
            image_fetch_target(&conn, 1).expect("the target reads"),
            ImageFetchTarget::Needed {
                image_sha256: hash.clone()
            }
        );
        assert_eq!(
            image_blob_bytes(&conn, &hash).expect("the payload reads"),
            None,
            "there is nothing to upload for a blanked row"
        );

        set_project_image_bytes(&conn, 1, &hash, b"a picture").expect("the write-back runs");

        assert_eq!(
            image_fetch_target(&conn, 1).expect("the target reads"),
            ImageFetchTarget::AlreadyLocal
        );
    }

    #[test]
    fn a_project_without_a_picture_has_nothing_to_fetch() {
        let (_dir, conn) = dataset();

        assert_eq!(
            image_fetch_target(&conn, 2).expect("the target reads"),
            ImageFetchTarget::NoImage
        );
    }

    #[test]
    fn the_payload_read_is_addressed_by_content() {
        let (_dir, conn) = dataset();
        let hash = store_image(&conn, 1, b"a picture");

        assert_eq!(
            image_blob_bytes(&conn, &hash).expect("the payload reads"),
            Some(b"a picture".to_vec())
        );
        assert_eq!(
            image_blob_bytes(&conn, &sha256_hex(b"another picture")).expect("the payload reads"),
            None
        );
    }

    /// A key assembled from a non-digest is how a caller would address something that is not a
    /// blob, so the schema refuses one rather than trusting every writer.
    #[test]
    fn the_marker_refuses_anything_that_is_not_a_lowercase_hex_digest() {
        let (_dir, conn) = dataset();

        for refused in ["", "abc", &"A".repeat(64), &"a".repeat(63), &"z".repeat(64)] {
            let error = mark_image_blob_uploaded(&conn, refused)
                .expect_err(&format!("{refused:?} must be refused"))
                .to_string();

            assert!(
                error.contains("sync_image_blobs_hash_is_hex")
                    || error.contains("sync_image_blobs.image_sha256"),
                "the refusal must name the invariant, got {error}"
            );
        }
    }
}
