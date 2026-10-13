//! Snapshots: build one from the live dataset, frame it as an AD-8 object, and publish it (AD-9).
//!
//! A snapshot is a whole SQLite database file, not a message stream. That is what makes a new
//! computer's first load bounded (CAP-2): it restores a file and then applies only the tail. Three
//! rules shape every line below.
//!
//! 1. **The online backup API, never `VACUUM INTO`.** `VACUUM` rebuilds the database and may
//!    renumber rowids, and in this schema the rowids ARE the integer ids every foreign key points
//!    at (AD-2 keeps uuids in a side table precisely so the integers stay local and stable). A
//!    renumbered copy would restore as a different database.
//! 2. **Stripping happens in the COPY, on a connection with no hook.** The live dataset is never
//!    modified by a snapshot build, and the stripping writes must not be captured as changes to
//!    replicate (AD-9).
//! 3. **Nothing holds the UI.** Every heavy step runs inside `spawn_blocking`, the copy is stepped
//!    in bounded page batches, and the source is this module's own read connection, so the
//!    `Mutex<Connection>` the UI writes through is never taken at all.

use std::path::Path;
use std::time::{Duration, Instant};

use rusqlite::backup::{Backup, StepResult};
use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::error::AppError;

use super::gate::{
    CapabilitySource, DatasetLink, GateStateSource, GatedError, GatedStore, SyncGate,
};
use super::object::{hex_lower, ObjectHeader, ObjectHeaderError};
use super::store::{ETag, ImmutablePut, ObjectStore, StoreError};

/// AD-6's snapshot namespace, relative to `acct/<identity-id>/`.
pub const SNAP_KEY_PREFIX: &str = "snap/";

/// The one mutable key that says which snapshot is current (AD-6: `If-Match` compare-and-swap).
pub const SNAP_LATEST_KEY: &str = "snap/LATEST";

/// FROZEN with the object format version (AD-8; Consistency Conventions: "the payload encoding is
/// one pinned binary format chosen in the first story and frozen with the format version").
///
/// 3 is zstd's default and the level this feature is calibrated on: SQLite pages of short text and
/// integers compress several times over at it, while it stays fast enough that building a snapshot
/// does not become the cost it exists to avoid. Raising it changes every byte of every object, so
/// it moves only together with the format version.
pub const SNAPSHOT_COMPRESSION_LEVEL: i32 = 3;

/// The version of the `snap/LATEST` document. Separate from the object format version because
/// LATEST is a plain JSON pointer rather than a framed object.
pub const SNAP_LATEST_VERSION: u32 = 1;

/// A ceiling on what `read_snapshot` will decompress, so a malformed or hostile object cannot be
/// turned into unbounded memory. Generous rather than tuned: AD-18's real size caps are Story 26.
const MAX_SNAPSHOT_PAYLOAD_BYTES: usize = 256 * 1024 * 1024;

/// Pages copied per backup step. Small enough that SQLite releases its read lock on the source
/// often — a concurrent writer never waits for the whole copy — and large enough that a 10 MB
/// database is not thousands of round trips.
const BACKUP_PAGES_PER_STEP: i32 = 512;

/// How long a step waits when the source is locked, and how long the copy may keep retrying before
/// it reports a busy dataset instead of blocking forever.
const BACKUP_BUSY_PAUSE: Duration = Duration::from_millis(25);
const BACKUP_BUSY_BUDGET: Duration = Duration::from_secs(30);

/// The `config` keys that describe THIS computer's credential state and therefore never travel
/// (AD-5's deny list). Owned by `db::config` so the strip here and Story 9's carry-back on the
/// restore path cannot disagree about the list.
const CONFIG_DENY_LIST: &[&str] = crate::db::config::LOCAL_ONLY_KEYS;

/// Which step of a build failed. Counted and reported as a code, never as a message or a path
/// (AD-16).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildStage {
    TempDir,
    OpenSource,
    Copy,
    OpenCopy,
    Strip,
    ReadCopy,
    Compress,
    JoinBlockingTask,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnapshotError {
    Build { stage: BuildStage },
    /// The source database stayed locked for the whole budget. Retryable once the app settles.
    SourceBusy,
    Header(ObjectHeaderError),
    /// The compressed payload would not decompress, or decompressed past the ceiling.
    Corrupt,
    /// The payload's hash is not the hash the header claims: tampering, truncation or a bad mirror.
    HashMismatch { expected: String, found: String },
    /// Written by a newer build. Parked, never applied (AD-11, CAP-7).
    SchemaTooNew { found: u32, supported: u32 },
    /// `snap/LATEST` exists but is not a document this build can read.
    MalformedLatest,
    Store(GatedError),
}

impl From<GatedError> for SnapshotError {
    fn from(error: GatedError) -> Self {
        SnapshotError::Store(error)
    }
}

impl From<ObjectHeaderError> for SnapshotError {
    fn from(error: ObjectHeaderError) -> Self {
        SnapshotError::Header(error)
    }
}

impl std::fmt::Display for SnapshotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SnapshotError::Build { stage } => write!(f, "snapshot build failed at {stage:?}"),
            SnapshotError::SourceBusy => f.write_str("the dataset stayed locked during the copy"),
            SnapshotError::Header(error) => write!(f, "snapshot header: {error}"),
            SnapshotError::Corrupt => f.write_str("snapshot payload could not be decompressed"),
            SnapshotError::HashMismatch { expected, found } => {
                write!(f, "snapshot {expected} holds content hashing to {found}")
            }
            SnapshotError::SchemaTooNew { found, supported } => {
                write!(f, "snapshot schema version {found} is newer than {supported}")
            }
            SnapshotError::MalformedLatest => f.write_str("snap/LATEST is not readable"),
            SnapshotError::Store(error) => write!(f, "snapshot transfer: {error:?}"),
        }
    }
}

impl std::error::Error for SnapshotError {}

/// What the stripping removed, as counts so a build can be reported and asserted on (AD-16).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StripReport {
    pub local_only_tables: Vec<String>,
    pub local_only_rows: usize,
    pub config_keys: usize,
    pub blanked_images: usize,
}

/// A snapshot ready to upload: the framed object, its identity, and the numbers CAP-2 is measured
/// in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltSnapshot {
    pub snap_id: String,
    pub schema_version: u32,
    pub payload_sha256: String,
    pub payload_bytes: usize,
    pub object: Vec<u8>,
    pub build_duration: Duration,
    pub stripped: StripReport,
}

impl BuiltSnapshot {
    /// `snap/<snap-id>` — the immutable key this snapshot belongs at.
    pub fn key(&self) -> String {
        format!("{SNAP_KEY_PREFIX}{}", self.snap_id)
    }

    pub fn object_bytes(&self) -> usize {
        self.object.len()
    }
}

/// What `snap/LATEST` holds: enough to find the snapshot and to refuse it without downloading it.
///
/// Serialized by hand as compact JSON with sorted keys rather than through serde, for the same
/// reason as the Story-3 owner object: the document is a wire contract between app versions, so the
/// exact spelling is part of it and a `#[derive(Serialize)]` would let a rename of a field silently
/// change the bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LatestSnapshot {
    pub snap_id: String,
    pub hash: String,
    pub schema_version: u32,
    pub created_ms: i64,
}

impl LatestSnapshot {
    /// `snap/<snap-id>`, refusing a snap id that is not a sha256 digest.
    ///
    /// The validation is the point: `snap_id` arrives from a document another computer wrote, and
    /// an unchecked one would be concatenated into an object key. The port refuses traversal too
    /// (`store::validate_relative_key`), but a pointer that names something other than a snapshot
    /// should never get as far as a request.
    pub fn snapshot_key(&self) -> Result<String, SnapshotError> {
        let is_digest = self.snap_id.len() == 64
            && self
                .snap_id
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
        if !is_digest {
            return Err(SnapshotError::MalformedLatest);
        }

        Ok(format!("{SNAP_KEY_PREFIX}{}", self.snap_id))
    }

    pub fn body(&self) -> Vec<u8> {
        format!(
            "{{\"created_ms\":{},\"hash\":\"{}\",\"schema_version\":{},\"snap_id\":\"{}\",\"v\":{}}}",
            self.created_ms, self.hash, self.schema_version, self.snap_id, SNAP_LATEST_VERSION
        )
        .into_bytes()
    }

    /// Unknown fields are ignored and the four known ones are required, so a later version may add
    /// to the document without this build losing the ability to find the snapshot.
    pub fn parse(bytes: &[u8]) -> Result<Self, SnapshotError> {
        let document: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| SnapshotError::MalformedLatest)?;

        let text = |field: &str| -> Result<String, SnapshotError> {
            document
                .get(field)
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .ok_or(SnapshotError::MalformedLatest)
        };
        let number = |field: &str| -> Result<i64, SnapshotError> {
            document
                .get(field)
                .and_then(|value| value.as_i64())
                .ok_or(SnapshotError::MalformedLatest)
        };

        let schema_version =
            u32::try_from(number("schema_version")?).map_err(|_| SnapshotError::MalformedLatest)?;

        Ok(Self {
            snap_id: text("snap_id")?,
            hash: text("hash")?,
            schema_version,
            created_ms: number("created_ms")?,
        })
    }
}

/// The outcome of publishing a snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadOutcome {
    Published {
        snap_id: String,
        latest: ETag,
        /// Whether the immutable object was written now, or was already there byte for byte
        /// because this is a retry.
        created: bool,
    },
    /// Another computer moved `snap/LATEST` first. Nothing was overwritten. Story 10 turns this
    /// into the load-or-keep choice (CAP-5); the snapshot object itself is already stored, so
    /// accepting the remote copy costs nothing and keeping the local one needs no rebuild.
    RemoteChanged {
        theirs: LatestSnapshot,
        their_etag: ETag,
        ours: LatestSnapshot,
    },
}

/// A snapshot object whose header, hash and schema version have all been checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedSnapshot {
    pub schema_version: u32,
    pub payload_sha256: String,
    pub payload: Vec<u8>,
}

fn identity(bytes: &[u8]) -> ([u8; 32], String) {
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    let hex = hex_lower(&digest);

    (digest, hex)
}

/// Builds a snapshot of the dataset at `db_path`.
///
/// `schema_version` rides in the AD-8 header so a reader can refuse an object a newer build
/// produced without decompressing it.
pub async fn build_snapshot(
    db_path: &Path,
    schema_version: u32,
) -> Result<BuiltSnapshot, SnapshotError> {
    let db_path = db_path.to_path_buf();

    // The whole build is CPU- and disk-bound: a page copy, a strip, a multi-megabyte read and a
    // compression pass. On a runtime worker it would stall every other task on that worker.
    tokio::task::spawn_blocking(move || build_snapshot_blocking(&db_path, schema_version))
        .await
        .map_err(|_| SnapshotError::Build {
            stage: BuildStage::JoinBlockingTask,
        })?
}

fn build_snapshot_blocking(
    db_path: &Path,
    schema_version: u32,
) -> Result<BuiltSnapshot, SnapshotError> {
    let started = Instant::now();

    // In the dataset's own directory, so the copy never crosses a filesystem and lands where the
    // dataset's free-space assumptions already hold. Removed recursively on every exit path,
    // including a panic, because `TempDir` owns it.
    let parent = db_path.parent().unwrap_or_else(|| Path::new("."));
    let scratch = tempfile::Builder::new()
        .prefix("nixus-snapshot")
        .tempdir_in(parent)
        .map_err(|_| SnapshotError::Build {
            stage: BuildStage::TempDir,
        })?;
    let copy_path = scratch.path().join("snapshot.db");

    let stripped = copy_and_strip(db_path, &copy_path)?;

    let payload = std::fs::read(&copy_path).map_err(|_| SnapshotError::Build {
        stage: BuildStage::ReadCopy,
    })?;
    let (digest, payload_sha256) = identity(&payload);

    let compressed = zstd::encode_all(payload.as_slice(), SNAPSHOT_COMPRESSION_LEVEL).map_err(
        |_| SnapshotError::Build {
            stage: BuildStage::Compress,
        },
    )?;

    Ok(BuiltSnapshot {
        // Content-addressed: a retry of the same snapshot writes the same key with the same bytes,
        // which is exactly the case AD-6 lets a 412 report as success.
        snap_id: payload_sha256.clone(),
        schema_version,
        payload_sha256,
        payload_bytes: payload.len(),
        object: ObjectHeader::new(schema_version, digest).frame(&compressed),
        build_duration: started.elapsed(),
        stripped,
    })
}

/// Copies the live database into `copy_path` and empties what must not travel.
///
/// Both connections are closed before this returns, so the caller reads a file no SQLite handle
/// still owns. That matters on Windows, where an open handle alone is enough to make a later copy,
/// rename or delete fail.
fn copy_and_strip(db_path: &Path, copy_path: &Path) -> Result<StripReport, SnapshotError> {
    {
        // The source is this module's OWN read connection to the dataset file, never the UI's.
        // Holding the UI's `Mutex<Connection>` for an entire multi-megabyte copy is the one thing
        // this build must not do; WAL gives this connection a consistent read view anyway, and a
        // fresh connection has no capture hook registered by construction (AD-9).
        let source = open_source(db_path).map_err(|_| SnapshotError::Build {
            stage: BuildStage::OpenSource,
        })?;
        let mut destination = Connection::open(copy_path).map_err(|_| SnapshotError::Build {
            stage: BuildStage::OpenCopy,
        })?;

        copy_in_steps(&source, &mut destination)?;
    }

    let copy = open_copy(copy_path).map_err(|_| SnapshotError::Build {
        stage: BuildStage::OpenCopy,
    })?;
    let strip = strip_in_copy(&copy)
        .and_then(|report| {
            // Folded back into the main file so the payload is one self-contained database rather
            // than a file plus a sidecar the upload would leave behind.
            copy.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
            Ok(report)
        })
        .map_err(|_| SnapshotError::Build {
            stage: BuildStage::Strip,
        });
    drop(copy);

    strip
}

/// The read side of the copy. `query_only` is what makes "a snapshot never modifies the live
/// dataset" a property of the connection rather than a promise about the code: SQLite refuses every
/// write on it. No `journal_mode` is set either, because setting one is itself a write to the file.
fn open_source(path: &Path) -> Result<Connection, AppError> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(BACKUP_BUSY_PAUSE * 4)?;
    conn.execute_batch("PRAGMA query_only=ON")?;

    Ok(conn)
}

/// The write side: the copy, where the stripping happens. No migration run — the copy is already at
/// the source's version, and migrating here would alter a file meant to be a faithful copy.
fn open_copy(path: &Path) -> Result<Connection, AppError> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(BACKUP_BUSY_PAUSE * 4)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    Ok(conn)
}

fn copy_in_steps(source: &Connection, destination: &mut Connection) -> Result<(), SnapshotError> {
    let backup = Backup::new(source, destination).map_err(|_| SnapshotError::Build {
        stage: BuildStage::Copy,
    })?;

    let deadline = Instant::now() + BACKUP_BUSY_BUDGET;
    loop {
        match backup.step(BACKUP_PAGES_PER_STEP) {
            Ok(StepResult::Done) => return Ok(()),
            // Between steps SQLite drops its read lock on the source, which is what keeps a
            // concurrent UI write from waiting for the whole copy.
            Ok(StepResult::More) => continue,
            Ok(StepResult::Busy | StepResult::Locked) => {
                if Instant::now() >= deadline {
                    return Err(SnapshotError::SourceBusy);
                }
                std::thread::sleep(BACKUP_BUSY_PAUSE);
            }
            // `StepResult` is `#[non_exhaustive]`, so a future variant must be treated as a
            // failure rather than silently looping forever on it.
            Err(_) | Ok(_) => {
                return Err(SnapshotError::Build {
                    stage: BuildStage::Copy,
                })
            }
        }
    }
}

/// Empties what AD-9 and AD-15 keep out of a snapshot, in one transaction, in the COPY.
///
/// `schema_version` is deliberately NOT emptied even though AD-5 classifies it `LocalOnly`. That
/// classification is about which rows become replication messages; a snapshot is a database FILE,
/// and one restored without its version row would have every migration re-applied over populated
/// tables the first time it was opened.
fn strip_in_copy(conn: &Connection) -> Result<StripReport, AppError> {
    // LOAD-BEARING, and the reason this is not just a `DELETE`: freeing a page does not erase it.
    // Without this, the multi-megabyte image payloads and the local-only rows would still be
    // sitting in the copy's free pages, and the object uploaded to the cloud would carry every byte
    // AD-9 and AD-10 say must not travel. `secure_delete` overwrites freed pages with zeros, which
    // also makes them compress away to nothing. It must be set outside a transaction.
    //
    // `VACUUM` would reclaim the pages instead, and is deliberately NOT used: it may renumber the
    // rowids of any table without an explicit `INTEGER PRIMARY KEY` (`config`, `sqlite_sequence`),
    // which is the very thing AD-9 forbids.
    conn.execute_batch("PRAGMA secure_delete=ON")?;

    let tx = conn.unchecked_transaction()?;
    let mut report = StripReport::default();

    // Discovered from the copy's own schema rather than listed here: `sync_log` and the rest of the
    // Milestone-2 tables do not exist yet, and a hard-coded list would either fail on the missing
    // ones now or silently miss the new ones later (AD-15 names them all `sync_*`).
    let names: Vec<String> = {
        let mut tables = tx.prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'table' AND name LIKE 'sync\\_%' ESCAPE '\\' ORDER BY name",
        )?;
        let found = tables
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        found
    };

    for name in names {
        // The name comes from `sqlite_master`, never from user input, and is quoted regardless.
        report.local_only_rows += tx.execute(&format!("DELETE FROM \"{name}\""), [])?;
        report.local_only_tables.push(name);
    }

    for key in CONFIG_DENY_LIST {
        report.config_keys += tx.execute("DELETE FROM config WHERE key = ?1", [key])?;
    }

    report.blanked_images = crate::db::projects::blank_project_image_bytes(&tx)?;

    tx.commit()?;

    Ok(report)
}

/// Checks a stored snapshot object and returns the database bytes it carries.
///
/// Every refusal below is a refusal to hand back something that might not be the snapshot the
/// caller asked for: Story 9 writes this payload over a live database file, so "probably fine" is
/// not an available answer.
pub fn read_snapshot(object: &[u8]) -> Result<VerifiedSnapshot, SnapshotError> {
    let (header, compressed) = ObjectHeader::parse(object)?;

    // Checked before the payload is decompressed: an object this build cannot apply should cost
    // nothing to refuse (AD-11 parks it until the app updates).
    let supported = u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX);
    if header.schema_version > supported {
        return Err(SnapshotError::SchemaTooNew {
            found: header.schema_version,
            supported,
        });
    }

    let payload = decode_bounded(compressed)?;

    let (digest, payload_sha256) = identity(&payload);
    if digest != header.content_sha256 {
        return Err(SnapshotError::HashMismatch {
            expected: hex_lower(&header.content_sha256),
            found: payload_sha256,
        });
    }

    Ok(VerifiedSnapshot {
        schema_version: header.schema_version,
        payload_sha256,
        payload,
    })
}

/// Decompresses with a hard ceiling, so a small object cannot expand into unbounded memory. The
/// limit is applied while decoding rather than after, which is the difference between refusing a
/// bomb and allocating it first.
fn decode_bounded(compressed: &[u8]) -> Result<Vec<u8>, SnapshotError> {
    use std::io::Read;

    let mut decoder =
        zstd::stream::read::Decoder::new(compressed).map_err(|_| SnapshotError::Corrupt)?;
    let mut payload = Vec::new();
    let read = decoder
        .by_ref()
        .take(MAX_SNAPSHOT_PAYLOAD_BYTES as u64 + 1)
        .read_to_end(&mut payload)
        .map_err(|_| SnapshotError::Corrupt)?;

    if read > MAX_SNAPSHOT_PAYLOAD_BYTES {
        return Err(SnapshotError::Corrupt);
    }

    Ok(payload)
}

/// Stores the snapshot and points `snap/LATEST` at it, never overwriting a LATEST that moved.
///
/// `known_latest` is the ETag of the LATEST this computer last pulled; `None` means it has never
/// seen one, which is the first computer to enable sync (AD-9).
pub async fn upload_snapshot<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    snapshot: &BuiltSnapshot,
    known_latest: Option<&ETag>,
    created_ms: i64,
) -> Result<UploadOutcome, SnapshotError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    let created = match store
        .put_immutable(&snapshot.key(), snapshot.object.clone())
        .await?
    {
        ImmutablePut::Created { .. } => true,
        ImmutablePut::AlreadyStored { .. } => false,
    };

    let ours = LatestSnapshot {
        snap_id: snapshot.snap_id.clone(),
        hash: snapshot.payload_sha256.clone(),
        schema_version: snapshot.schema_version,
        created_ms,
    };

    let published = match known_latest {
        Some(expected) => {
            store
                .put_if_match(SNAP_LATEST_KEY, expected, ours.body())
                .await
        }
        None => store.put_if_absent(SNAP_LATEST_KEY, ours.body()).await,
    };

    match published {
        Ok(latest) => Ok(UploadOutcome::Published {
            snap_id: ours.snap_id,
            latest,
            created,
        }),
        // AD-6: a conditional write that lost the race is re-read, never retried blind. A 404 under
        // `If-Match` lands here too — LATEST was there when this computer read it and is gone now,
        // so what it believes about the cloud is stale either way.
        Err(GatedError::Store(
            StoreError::PreconditionFailed | StoreError::ConditionalConflict | StoreError::NotFound,
        )) => remote_changed(store, ours).await,
        Err(error) => Err(SnapshotError::Store(error)),
    }
}

async fn remote_changed<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    ours: LatestSnapshot,
) -> Result<UploadOutcome, SnapshotError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    let stored = store.get(SNAP_LATEST_KEY).await?;

    Ok(UploadOutcome::RemoteChanged {
        theirs: LatestSnapshot::parse(&stored.bytes)?,
        their_etag: stored.meta.etag,
        ours,
    })
}

/// Reads `snap/LATEST`, or `None` when no computer has ever published one.
pub async fn fetch_latest<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
) -> Result<Option<(LatestSnapshot, ETag)>, SnapshotError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    match store.get(SNAP_LATEST_KEY).await {
        Ok(stored) => Ok(Some((
            LatestSnapshot::parse(&stored.bytes)?,
            stored.meta.etag,
        ))),
        Err(GatedError::Store(StoreError::NotFound)) => Ok(None),
        Err(error) => Err(SnapshotError::Store(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sync_state::FrozenReason;
    use crate::db::test_dataset::{heavy_year_dataset, HeavyYear};
    use crate::models::DatasetKind;
    use crate::sync::test_support::{gated_fake, syncing_fake, FakeObjectStore, FakeOp};
    use std::collections::BTreeMap;
    use std::sync::Arc;

    /// The columns AD-9 and AD-10 make claims about, named so the assertions below read as claims
    /// rather than as tuple indices.
    struct RestoredImage {
        project_id: i64,
        image_sha256: String,
        byte_size: i64,
        image_bytes: Option<Vec<u8>>,
        thumbnail_bytes: Option<Vec<u8>>,
    }

    fn schema_version() -> u32 {
        u32::try_from(crate::db::latest_schema_version()).expect("the schema version fits")
    }

    async fn heavy_snapshot() -> (HeavyYear, BuiltSnapshot) {
        let heavy = heavy_year_dataset();
        let built = build_snapshot(&heavy.db_path, schema_version())
            .await
            .expect("the snapshot builds");

        (heavy, built)
    }

    fn restore_to_file(payload: &[u8]) -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().expect("a temp dir");
        let path = dir.path().join("restored.db");
        std::fs::write(&path, payload).expect("the payload writes");
        let conn = Connection::open(&path).expect("the restored database opens");

        (dir, conn)
    }

    /// Every table, and per table every row rendered with its rowid, so a comparison can tell "the
    /// same rows" from "the same rows renumbered".
    fn dump(conn: &Connection) -> BTreeMap<String, Vec<String>> {
        let names: Vec<String> = {
            let mut tables = conn
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                .expect("the table list prepares");
            tables
                .query_map([], |row| row.get::<_, String>(0))
                .expect("the table list reads")
                .collect::<Result<_, _>>()
                .expect("the table list collects")
        };

        let mut dumped = BTreeMap::new();
        for name in names {
            let mut rows = conn
                .prepare(&format!(
                    "SELECT _rowid_, * FROM \"{name}\" ORDER BY _rowid_"
                ))
                .expect("the row dump prepares");
            let values: Vec<String> = rows
                .query_map([], |row| {
                    let mut rendered = String::new();
                    let mut column = 0;
                    while let Ok(value) = row.get_ref(column) {
                        rendered.push_str(&format!("{value:?}|"));
                        column += 1;
                    }
                    Ok(rendered)
                })
                .expect("the rows read")
                .collect::<Result<_, _>>()
                .expect("the rows collect");
            dumped.insert(name, values);
        }

        dumped
    }

    #[tokio::test]
    async fn a_snapshot_of_a_heavy_year_is_built_compressed_and_measured() {
        let (heavy, built) = heavy_snapshot().await;

        let source_bytes = std::fs::metadata(&heavy.db_path)
            .expect("the dataset is there")
            .len() as usize;
        println!(
            "heavy-year snapshot: source {source_bytes} B, payload {} B, object {} B, \
             ratio {:.2}x, build {:?}, stripped {:?}",
            built.payload_bytes,
            built.object_bytes(),
            built.payload_bytes as f64 / built.object_bytes() as f64,
            built.build_duration,
            built.stripped,
        );

        assert_eq!(built.schema_version, schema_version());
        assert_eq!(built.snap_id, built.payload_sha256);
        assert!(
            built.object_bytes() < built.payload_bytes / 4,
            "a database of text and integers whose image pages are zeroed must compress hard: \
             {} vs {}",
            built.object_bytes(),
            built.payload_bytes
        );

        // The assertion that actually matters, and the one a size comparison cannot make: the image
        // payloads must be ABSENT from the bytes, not merely unreferenced. Freeing a page leaves its
        // content in the file, so without `secure_delete` every megabyte would still be uploaded.
        let live = Connection::open(&heavy.db_path).expect("the dataset opens");
        let mut statement = live
            .prepare("SELECT image_bytes FROM project_images ORDER BY project_id")
            .expect("the image read prepares");
        let originals: Vec<Vec<u8>> = statement
            .query_map([], |row| row.get::<_, Vec<u8>>(0))
            .expect("the images read")
            .collect::<Result<_, _>>()
            .expect("the images collect");
        assert_eq!(originals.len(), heavy.project_images);

        let payload = read_snapshot(&built.object)
            .expect("the object verifies")
            .payload;
        for (index, image) in originals.iter().enumerate() {
            let needle = &image[image.len() / 2..image.len() / 2 + 256];
            assert!(
                !payload.windows(needle.len()).any(|window| window == needle),
                "image {index} still appears in the snapshot payload"
            );
        }

        assert_eq!(built.stripped.blanked_images, heavy.project_images);
        assert_eq!(built.stripped.config_keys, CONFIG_DENY_LIST.len());
        assert_eq!(built.stripped.local_only_tables, vec!["sync_state"]);
        assert_eq!(
            built.stripped.local_only_rows, 1,
            "the install identity row must be deleted, not merely found"
        );
    }

    /// The build must not touch the live dataset: the user's images, credential-state keys and
    /// install identity are all still there afterwards, byte for byte.
    #[tokio::test]
    async fn building_a_snapshot_leaves_the_live_dataset_untouched() {
        let heavy = heavy_year_dataset();
        let before = std::fs::read(&heavy.db_path).expect("the dataset reads");

        build_snapshot(&heavy.db_path, schema_version())
            .await
            .expect("the snapshot builds");

        let conn = Connection::open(&heavy.db_path).expect("the dataset opens");
        let count = |sql: &str| -> i64 {
            conn.query_row(sql, [], |row| row.get(0)).expect("it counts")
        };
        assert_eq!(
            count("SELECT COUNT(*) FROM project_images WHERE image_bytes IS NOT NULL"),
            heavy.project_images as i64
        );
        assert_eq!(
            count(
                "SELECT COUNT(*) FROM config
                 WHERE key IN ('ai_configured', 'ai_provider', 'aws_region')"
            ),
            CONFIG_DENY_LIST.len() as i64
        );
        drop(conn);

        assert_eq!(
            std::fs::read(&heavy.db_path).expect("the dataset reads"),
            before,
            "not one byte of the live file may change"
        );
    }

    /// The round trip is the whole promise of a snapshot: restore it and the tables are the same
    /// tables, with the same rowids, minus exactly what AD-9 says travels empty.
    #[tokio::test]
    async fn a_restored_snapshot_matches_the_original_minus_the_stripped_parts() {
        let (heavy, built) = heavy_snapshot().await;

        let verified = read_snapshot(&built.object).expect("the object verifies");
        let (_restored_dir, restored) = restore_to_file(&verified.payload);
        let original = Connection::open(&heavy.db_path).expect("the original opens");

        let integrity: String = restored
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .expect("the integrity check runs");
        assert_eq!(integrity, "ok");

        let before = dump(&original);
        let after = dump(&restored);
        assert_eq!(
            before.keys().collect::<Vec<_>>(),
            after.keys().collect::<Vec<_>>(),
            "the restore must carry every table"
        );

        for (table, rows) in &before {
            match table.as_str() {
                // Emptied on purpose (AD-15); the new computer mints its own install identity.
                "sync_state" => assert!(after[table].is_empty(), "sync_state must travel empty"),
                "config" => {
                    assert_eq!(after[table].len(), rows.len() - CONFIG_DENY_LIST.len());
                    let present = |conn: &Connection, key: &str| -> i64 {
                        conn.query_row("SELECT COUNT(*) FROM config WHERE key = ?1", [key], |row| {
                            row.get(0)
                        })
                        .expect("the key counts")
                    };
                    for key in CONFIG_DENY_LIST {
                        assert_eq!(present(&restored, key), 0, "{key} must not travel");
                    }
                    assert_eq!(
                        present(&restored, "onboarding_complete"),
                        1,
                        "an ordinary setting must survive"
                    );
                }
                // Same rows and same rowids; only `image_bytes` is gone (AD-10).
                "project_images" => {
                    assert_eq!(after[table].len(), rows.len());
                    let mut statement = restored
                        .prepare(
                            "SELECT project_id, image_sha256, byte_size, image_bytes,
                                    thumbnail_bytes
                             FROM project_images ORDER BY project_id",
                        )
                        .expect("the image read prepares");
                    let kept: Vec<RestoredImage> = statement
                        .query_map([], |row| {
                            Ok(RestoredImage {
                                project_id: row.get(0)?,
                                image_sha256: row.get(1)?,
                                byte_size: row.get(2)?,
                                image_bytes: row.get(3)?,
                                thumbnail_bytes: row.get(4)?,
                            })
                        })
                        .expect("the images read")
                        .collect::<Result<_, _>>()
                        .expect("the images collect");

                    assert_eq!(kept.len(), heavy.project_images);
                    for image in kept {
                        assert!(
                            image.image_bytes.is_none(),
                            "project {} still carries bytes",
                            image.project_id
                        );
                        assert_eq!(
                            image.image_sha256.len(),
                            64,
                            "the hash is what refetches the blob"
                        );
                        assert_eq!(image.byte_size as usize, heavy.image_payload_bytes);
                        assert!(image.thumbnail_bytes.is_some(), "thumbnails stay (AD-9)");
                    }
                }
                _ => assert_eq!(
                    &after[table], rows,
                    "{table} must survive row for row, rowid for rowid"
                ),
            }
        }
    }

    /// `VACUUM INTO` would have been the short way to write this module and would have renumbered
    /// rowids, which are this schema's integer ids. Asserted as explicit bounds and sequence
    /// counters so a failure names the cause instead of printing a row diff.
    #[tokio::test]
    async fn every_remaining_table_keeps_its_rowids_and_autoincrement_counters() {
        let (heavy, built) = heavy_snapshot().await;
        let verified = read_snapshot(&built.object).expect("the object verifies");
        let (_restored_dir, restored) = restore_to_file(&verified.payload);
        let original = Connection::open(&heavy.db_path).expect("the original opens");

        for table in [
            "expenses",
            "audit_log",
            "chat_messages",
            "accounts",
            "projects",
            "project_images",
        ] {
            let bounds = |conn: &Connection| -> (i64, i64, i64) {
                conn.query_row(
                    &format!(
                        "SELECT COUNT(*), COALESCE(MIN(_rowid_), 0), COALESCE(MAX(_rowid_), 0)
                         FROM \"{table}\""
                    ),
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .expect("the bounds read")
            };
            assert_eq!(bounds(&original), bounds(&restored), "{table} rowids moved");
        }

        let sequences = |conn: &Connection| -> Vec<(String, i64)> {
            let mut statement = conn
                .prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name")
                .expect("the sequence read prepares");
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("the sequences read")
                .collect::<Result<_, _>>()
                .expect("the sequences collect")
        };
        assert_eq!(
            sequences(&original),
            sequences(&restored),
            "an AUTOINCREMENT counter that rewound would hand a new row an id already used"
        );
    }

    #[test]
    fn the_frozen_compression_level_is_part_of_the_format() {
        assert_eq!(
            SNAPSHOT_COMPRESSION_LEVEL, 3,
            "the level is frozen with the object format version (AD-8): changing it changes every \
             byte of every object and is a format decision, not a tuning knob"
        );

        let payload = b"a snapshot payload that repeats, repeats, repeats".repeat(100);
        let (digest, _) = identity(&payload);
        let object = ObjectHeader::new(1, digest).frame(
            &zstd::encode_all(payload.as_slice(), SNAPSHOT_COMPRESSION_LEVEL)
                .expect("the payload compresses"),
        );

        let verified = read_snapshot(&object).expect("the object verifies");
        assert_eq!(verified.payload, payload);
        assert_eq!(verified.schema_version, 1);
    }

    #[tokio::test]
    async fn a_tampered_truncated_or_unreadable_object_is_refused() {
        let (_heavy, built) = heavy_snapshot().await;

        let mut flipped = built.object.clone();
        let last = flipped.len() - 1;
        flipped[last] ^= 0xff;
        assert!(
            matches!(
                read_snapshot(&flipped),
                Err(SnapshotError::Corrupt | SnapshotError::HashMismatch { .. })
            ),
            "a flipped payload byte must not read as a snapshot"
        );

        // A header rewritten to claim a different digest is the shape a mirror serving the wrong
        // body produces: the compression still decodes, so only the hash catches it.
        let honest = read_snapshot(&built.object).expect("the object verifies");
        let (other, _) = identity(b"a different database");
        let swapped = ObjectHeader::new(built.schema_version, other).frame(
            &zstd::encode_all(honest.payload.as_slice(), SNAPSHOT_COMPRESSION_LEVEL)
                .expect("it recompresses"),
        );
        assert!(matches!(
            read_snapshot(&swapped),
            Err(SnapshotError::HashMismatch { .. })
        ));

        assert_eq!(
            read_snapshot(&built.object[..built.object.len() / 2]),
            Err(SnapshotError::Corrupt),
            "half an object is not a snapshot"
        );
        assert_eq!(
            read_snapshot(&built.object[..10]),
            Err(SnapshotError::Header(ObjectHeaderError::Truncated))
        );
        assert_eq!(
            read_snapshot(b"not a sync object at all, only text, padded past a header's length"),
            Err(SnapshotError::Header(ObjectHeaderError::NotAnObject))
        );
    }

    #[test]
    fn a_snapshot_from_a_newer_build_is_refused_before_it_is_decompressed() {
        let supported = schema_version();
        let (digest, _) = identity(b"future");
        let object = ObjectHeader::new(supported + 1, digest).frame(b"not even valid zstd");

        assert_eq!(
            read_snapshot(&object),
            Err(SnapshotError::SchemaTooNew {
                found: supported + 1,
                supported,
            }),
            "the version is checked first, so a newer object costs nothing to park"
        );
    }

    /// Story 9 turns a pointer into a key, so a pointer that names anything but a digest must not
    /// produce one.
    #[test]
    fn a_pointer_only_yields_a_key_when_it_names_a_digest() {
        let digest = "a".repeat(64);
        let pointer = |snap_id: &str| LatestSnapshot {
            snap_id: snap_id.to_string(),
            hash: digest.clone(),
            schema_version: 30,
            created_ms: 1,
        };

        assert_eq!(
            pointer(&digest).snapshot_key().expect("a digest is a key"),
            format!("snap/{digest}")
        );
        for refused in [
            "",
            "LATEST",
            "../../other-account/snap/x",
            &"A".repeat(64),
            &"a".repeat(63),
            &format!("{}z", "a".repeat(63)),
        ] {
            assert_eq!(
                pointer(refused).snapshot_key(),
                Err(SnapshotError::MalformedLatest),
                "{refused:?}"
            );
        }
    }

    #[test]
    fn the_latest_document_round_trips_and_refuses_what_it_cannot_read() {
        let latest = LatestSnapshot {
            snap_id: "a".repeat(64),
            hash: "b".repeat(64),
            schema_version: 30,
            created_ms: 1_760_000_000_000,
        };

        let body = latest.body();
        assert_eq!(
            String::from_utf8(body.clone()).expect("it is utf-8"),
            format!(
                "{{\"created_ms\":1760000000000,\"hash\":\"{}\",\"schema_version\":30,\
                 \"snap_id\":\"{}\",\"v\":1}}",
                "b".repeat(64),
                "a".repeat(64)
            )
        );
        assert_eq!(LatestSnapshot::parse(&body), Ok(latest));

        let with_unknown_fields = br#"{"created_ms":1,"hash":"ff","schema_version":2,"snap_id":"aa","v":1,"future":{"x":1}}"#;
        assert_eq!(
            LatestSnapshot::parse(with_unknown_fields).expect("unknown fields are ignored"),
            LatestSnapshot {
                snap_id: "aa".to_string(),
                hash: "ff".to_string(),
                schema_version: 2,
                created_ms: 1,
            }
        );

        for refused in [
            &b""[..],
            b"not json",
            br#"{"hash":"ff","schema_version":2,"snap_id":"aa"}"#,
            br#"{"created_ms":1,"schema_version":2,"snap_id":"aa"}"#,
            br#"{"created_ms":1,"hash":"ff","snap_id":"aa"}"#,
            br#"{"created_ms":1,"hash":"ff","schema_version":-1,"snap_id":"aa"}"#,
            br#"{"created_ms":1,"hash":5,"schema_version":2,"snap_id":"aa"}"#,
        ] {
            assert_eq!(
                LatestSnapshot::parse(refused),
                Err(SnapshotError::MalformedLatest),
                "{}",
                String::from_utf8_lossy(refused)
            );
        }
    }

    #[tokio::test]
    async fn the_first_upload_stores_the_snapshot_and_mints_latest() {
        let (_heavy, built) = heavy_snapshot().await;
        let fake = Arc::new(FakeObjectStore::default());
        let store = syncing_fake(Arc::clone(&fake));

        let outcome = upload_snapshot(&store, &built, None, 1_760_000_000_000)
            .await
            .expect("the upload succeeds");

        let UploadOutcome::Published {
            snap_id,
            latest,
            created,
        } = outcome
        else {
            panic!("the first upload has nothing to conflict with");
        };
        assert_eq!(snap_id, built.snap_id);
        assert!(created);
        let mut expected = vec![built.key(), SNAP_LATEST_KEY.to_string()];
        expected.sort();
        // Sorted on both sides: `keys()` orders lexicographically, and a snap id is a
        // hash, so whether it sorts before or after `snap/LATEST` is luck rather than a
        // property worth asserting.
        assert_eq!(fake.keys(), expected);
        assert_eq!(fake.stored(&built.key()).as_deref(), Some(&built.object[..]));

        let (published, etag) = fetch_latest(&store)
            .await
            .expect("latest reads")
            .expect("latest is there");
        assert_eq!(etag, latest);
        assert_eq!(
            published,
            LatestSnapshot {
                snap_id: built.snap_id.clone(),
                hash: built.payload_sha256.clone(),
                schema_version: built.schema_version,
                created_ms: 1_760_000_000_000,
            }
        );

        // A retry of the same snapshot is idempotent: the immutable key already holds exactly these
        // bytes, which AD-6 reports as success rather than as an install-id collision.
        let again = upload_snapshot(&store, &built, Some(&etag), 1_760_000_000_001)
            .await
            .expect("the retry succeeds");
        assert!(matches!(
            again,
            UploadOutcome::Published { created: false, .. }
        ));
    }

    /// The conflict case AD-6 and CAP-5 exist for: nothing is overwritten, and the caller gets what
    /// Story 10 needs to offer load-or-keep.
    #[tokio::test]
    async fn a_latest_that_moved_is_reported_and_never_overwritten() {
        let (_heavy, built) = heavy_snapshot().await;
        let fake = Arc::new(FakeObjectStore::default());

        let theirs = LatestSnapshot {
            snap_id: "c".repeat(64),
            hash: "c".repeat(64),
            schema_version: built.schema_version,
            created_ms: 1_760_000_500_000,
        };
        fake.seed(SNAP_LATEST_KEY, theirs.body());
        let store = syncing_fake(Arc::clone(&fake));

        let stale = ETag::new("\"pulled-before-they-wrote\"");
        let outcome = upload_snapshot(&store, &built, Some(&stale), 1_760_000_000_000)
            .await
            .expect("a conflict is an outcome, not a failure");

        let UploadOutcome::RemoteChanged {
            theirs: read, ours, ..
        } = outcome
        else {
            panic!("a stale etag must not publish");
        };
        assert_eq!(read, theirs);
        assert_eq!(ours.snap_id, built.snap_id);
        assert_eq!(
            fake.stored(SNAP_LATEST_KEY).as_deref(),
            Some(&theirs.body()[..]),
            "their pointer must still be the one in the cloud"
        );
        // The snapshot object itself IS stored, so accepting or keeping later needs no rebuild.
        assert!(fake.stored(&built.key()).is_some());
    }

    /// The same refusal when this computer believed LATEST had never existed.
    #[tokio::test]
    async fn a_first_upload_that_races_another_computer_does_not_overwrite_it() {
        let (_heavy, built) = heavy_snapshot().await;
        let fake = Arc::new(FakeObjectStore::default());

        let theirs = LatestSnapshot {
            snap_id: "d".repeat(64),
            hash: "d".repeat(64),
            schema_version: built.schema_version,
            created_ms: 1,
        };
        fake.seed(SNAP_LATEST_KEY, theirs.body());
        let store = syncing_fake(Arc::clone(&fake));

        let outcome = upload_snapshot(&store, &built, None, 2)
            .await
            .expect("the race is an outcome");

        assert!(matches!(outcome, UploadOutcome::RemoteChanged { .. }));
        assert_eq!(
            fake.stored(SNAP_LATEST_KEY).as_deref(),
            Some(&theirs.body()[..])
        );
    }

    /// A LATEST that vanished between the read and the swap is the same stale-belief situation, and
    /// must not be re-created blind: the computer that deleted or replaced it knows something this
    /// one does not.
    #[tokio::test]
    async fn an_if_match_that_answers_not_found_is_reported_rather_than_recreated() {
        let (_heavy, built) = heavy_snapshot().await;
        let fake = Arc::new(FakeObjectStore::default());
        let theirs = LatestSnapshot {
            snap_id: "f".repeat(64),
            hash: "f".repeat(64),
            schema_version: built.schema_version,
            created_ms: 3,
        };
        let etag = fake.seed(SNAP_LATEST_KEY, theirs.body());
        fake.fail_next(FakeOp::PutIfMatch, StoreError::NotFound);
        let store = syncing_fake(Arc::clone(&fake));

        let outcome = upload_snapshot(&store, &built, Some(&etag), 4)
            .await
            .expect("it is reported, not failed");

        assert!(matches!(outcome, UploadOutcome::RemoteChanged { .. }));
    }

    #[tokio::test]
    async fn fetch_latest_tells_absence_from_a_pointer() {
        let fake = Arc::new(FakeObjectStore::default());
        let store = syncing_fake(Arc::clone(&fake));

        assert_eq!(fetch_latest(&store).await, Ok(None));

        let latest = LatestSnapshot {
            snap_id: "e".repeat(64),
            hash: "e".repeat(64),
            schema_version: 30,
            created_ms: 7,
        };
        let etag = fake.seed(SNAP_LATEST_KEY, latest.body());

        assert_eq!(fetch_latest(&store).await, Ok(Some((latest, etag))));

        fake.seed(SNAP_LATEST_KEY, b"not a pointer".to_vec());
        assert_eq!(
            fetch_latest(&store).await,
            Err(SnapshotError::MalformedLatest)
        );
    }

    /// AD-14 and inherited AD-12: a blocked dataset makes ZERO requests. Proven by the counter, not
    /// by the returned error — an error would also appear after the request had gone out.
    #[tokio::test]
    async fn a_blocked_dataset_uploads_nothing_at_all() {
        let (_heavy, built) = heavy_snapshot().await;

        for (kind, entitled, frozen) in [
            (DatasetKind::Local, true, None),
            (DatasetKind::CloudLinked, false, None),
            (
                DatasetKind::CloudLinked,
                true,
                Some(FrozenReason::EntitlementLapsed),
            ),
            (
                DatasetKind::CloudLinked,
                true,
                Some(FrozenReason::OwnerMismatch),
            ),
            (DatasetKind::CloudLinked, true, Some(FrozenReason::Support)),
        ] {
            let case = format!("{kind:?}/{entitled}/{frozen:?}");
            let fake = Arc::new(FakeObjectStore::default());
            let store = gated_fake(Arc::clone(&fake), kind, entitled, frozen);

            let refused = upload_snapshot(&store, &built, None, 1).await;
            assert!(
                matches!(refused, Err(SnapshotError::Store(GatedError::Blocked(_)))),
                "{case} must be refused, got {refused:?}"
            );
            assert!(matches!(
                fetch_latest(&store).await,
                Err(SnapshotError::Store(GatedError::Blocked(_)))
            ));
            assert_eq!(fake.calls(), 0, "{case} reached the transport");
            assert_eq!(fake.calls_of(FakeOp::PutImmutable), 0);
            assert!(fake.keys().is_empty());
        }
    }
}
