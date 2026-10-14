//! An in-memory `ObjectStore` with the REAL conditional-write semantics (AD-6), for tests that have
//! to prove a protocol rather than a return value.
//!
//! WHY it is shared rather than per-test: Stories 9 and 12 replay the same create-only / `If-Match`
//! / `304` / `412` / `409` / `404` matrix against bootstrap and against the final proof, and a
//! second hand-rolled fake would be a second set of assumptions about what S3 answers. The call
//! counters are what let a test assert that a blocked dataset made *zero* requests — an assertion on
//! the returned error would pass even if the request had gone out.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::sync_state::FrozenReason;
use crate::entitlements::AccountCapabilities;
use crate::models::DatasetKind;
use crate::sync::auth::{AccountPin, AuthError};
use crate::sync::gate::{CapabilitySource, GateStateSource, GatedStore, SyncGate};
use crate::sync::limits::DatasetLimits;
use crate::sync::segment::{Applier, SegmentBatch, SegmentMessage};
use crate::sync::state::GateState;
use crate::sync::store::{
    ConditionalGet, ETag, ImmutablePut, ListedObject, ObjectMeta, ObjectStore, StoreError,
    StoredObject,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum FakeOp {
    Get,
    GetIfNoneMatch,
    Head,
    Exists,
    PutImmutable,
    PutIfAbsent,
    PutIfMatch,
    List,
    Delete,
}

struct Stored {
    bytes: Vec<u8>,
    etag: ETag,
    modified_ms: i64,
}

#[derive(Default)]
struct Counters {
    total: u64,
    by_op: HashMap<FakeOp, u64>,
    /// Every request in order, with the key it addressed. The per-op counters cannot answer
    /// "how many PUTs were blobs", because a snapshot object is written through the same
    /// immutable put as a blob is.
    keyed: Vec<(FakeOp, String)>,
}

pub(crate) struct FakeObjectStore {
    objects: Mutex<HashMap<String, Stored>>,
    counters: Mutex<Counters>,
    faults: Mutex<Vec<(FakeOp, StoreError)>>,
    next_etag: AtomicU64,
    /// Transfers sleep in proportion to their size when set, which is how the CAP-2 "5 s at
    /// 10 Mbps" gate in Story 9 gets a deterministic clock without a network.
    bytes_per_second: Mutex<Option<u64>>,
    transferred: AtomicU64,
    /// What the store stamps a new object with. AD-13 measures retention against the store's own
    /// clock, so a test has to be able to state it rather than wait 90 days.
    clock_ms: AtomicI64,
}

impl Default for FakeObjectStore {
    fn default() -> Self {
        Self {
            objects: Mutex::new(HashMap::new()),
            counters: Mutex::new(Counters::default()),
            faults: Mutex::new(Vec::new()),
            next_etag: AtomicU64::new(1),
            bytes_per_second: Mutex::new(None),
            transferred: AtomicU64::new(0),
            clock_ms: AtomicI64::new(0),
        }
    }
}

impl FakeObjectStore {
    /// How many requests reached the transport, over every operation.
    pub(crate) fn calls(&self) -> u64 {
        self.counters.lock().expect("not poisoned").total
    }

    pub(crate) fn calls_of(&self, op: FakeOp) -> u64 {
        self.counters
            .lock()
            .expect("not poisoned")
            .by_op
            .get(&op)
            .copied()
            .unwrap_or(0)
    }

    /// How many requests of `op` addressed a key under `prefix`.
    pub(crate) fn calls_of_prefix(&self, op: FakeOp, prefix: &str) -> u64 {
        self.counters
            .lock()
            .expect("not poisoned")
            .keyed
            .iter()
            .filter(|(seen, key)| *seen == op && key.starts_with(prefix))
            .count() as u64
    }

    pub(crate) fn transferred_bytes(&self) -> u64 {
        self.transferred.load(Ordering::SeqCst)
    }

    /// Caps every later transfer, so a test can measure a download the way a slow link delivers it.
    pub(crate) fn throttle_to(&self, bytes_per_second: u64) {
        *self.bytes_per_second.lock().expect("not poisoned") = Some(bytes_per_second);
    }

    /// Makes the next call to `op` fail with `error`, so retry and recovery paths are reachable
    /// without a second fake.
    pub(crate) fn fail_next(&self, op: FakeOp, error: StoreError) {
        self.faults.lock().expect("not poisoned").push((op, error));
    }

    /// Puts an object there without going through the protocol, for arranging a starting state.
    pub(crate) fn seed(&self, key: &str, bytes: Vec<u8>) -> ETag {
        let etag = self.mint_etag();
        self.objects.lock().expect("not poisoned").insert(
            key.to_string(),
            Stored {
                bytes,
                etag: etag.clone(),
                modified_ms: self.clock_ms.load(Ordering::SeqCst),
            },
        );

        etag
    }

    pub(crate) fn stored(&self, key: &str) -> Option<Vec<u8>> {
        self.objects
            .lock()
            .expect("not poisoned")
            .get(key)
            .map(|stored| stored.bytes.clone())
    }

    /// Takes an object away without going through the protocol, so a test can arrange the one
    /// state the app cannot produce itself: a key a row still names and the cloud no longer has
    /// (Milestone 1 grants no delete permission).
    pub(crate) fn remove(&self, key: &str) {
        self.objects.lock().expect("not poisoned").remove(key);
    }

    /// The concurrency token a stored object currently carries, so a test can assert that a
    /// compare-and-swap actually moved the pointer rather than only that it returned `Ok`.
    pub(crate) fn etag_of(&self, key: &str) -> Option<ETag> {
        self.objects
            .lock()
            .expect("not poisoned")
            .get(key)
            .map(|stored| stored.etag.clone())
    }

    pub(crate) fn keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = self
            .objects
            .lock()
            .expect("not poisoned")
            .keys()
            .cloned()
            .collect();
        keys.sort();

        keys
    }

    /// What later writes are stamped with.
    pub(crate) fn set_clock(&self, ms: i64) {
        self.clock_ms.store(ms, Ordering::SeqCst);
    }

    /// Ages one stored object, which is the only way to arrange AD-13's "older than 90 days".
    pub(crate) fn set_modified(&self, key: &str, ms: i64) {
        if let Some(stored) = self.objects.lock().expect("not poisoned").get_mut(key) {
            stored.modified_ms = ms;
        }
    }

    fn mint_etag(&self) -> ETag {
        ETag::new(format!(
            "\"{}\"",
            self.next_etag.fetch_add(1, Ordering::SeqCst)
        ))
    }

    /// One place where a call is counted, a queued fault is taken and the throttle is paid, so no
    /// operation can be added that silently escapes any of the three.
    async fn enter(&self, op: FakeOp, key: &str, bytes: u64) -> Result<(), StoreError> {
        {
            let mut counters = self.counters.lock().expect("not poisoned");
            counters.total += 1;
            *counters.by_op.entry(op).or_insert(0) += 1;
            counters.keyed.push((op, key.to_string()));
        }
        self.transferred.fetch_add(bytes, Ordering::SeqCst);

        let rate = *self.bytes_per_second.lock().expect("not poisoned");
        if let Some(rate) = rate.filter(|rate| *rate > 0) {
            tokio::time::sleep(Duration::from_secs_f64(bytes as f64 / rate as f64)).await;
        }

        let queued = {
            let mut faults = self.faults.lock().expect("not poisoned");
            faults
                .iter()
                .position(|(queued, _)| *queued == op)
                .map(|at| faults.remove(at).1)
        };
        match queued {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl ObjectStore for FakeObjectStore {
    fn account_prefix(&self) -> &str {
        "acct/us-east-1:0000/"
    }

    /// `If-None-Match: *` with AD-6's refinement: an existing key holding the SAME content is a
    /// success (the upload is idempotent), and a different content is an install-id collision.
    async fn put_immutable(&self, key: &str, body: Vec<u8>) -> Result<ImmutablePut, StoreError> {
        self.enter(FakeOp::PutImmutable, key, body.len() as u64).await?;

        let mut objects = self.objects.lock().expect("not poisoned");
        if let Some(stored) = objects.get(key) {
            // Compared as content HASHES, not as bytes, because that is the comparison AD-6 makes
            // and the one the real adapter makes against `x-amz-meta-content-sha256`.
            let hash = crate::projects::image::sha256_hex;
            return if hash(&stored.bytes) == hash(&body) {
                Ok(ImmutablePut::AlreadyStored {
                    etag: stored.etag.clone(),
                })
            } else {
                Err(StoreError::ContentHashMismatch)
            };
        }

        let etag = self.mint_etag();
        objects.insert(
            key.to_string(),
            Stored {
                bytes: body,
                etag: etag.clone(),
                modified_ms: self.clock_ms.load(Ordering::SeqCst),
            },
        );

        Ok(ImmutablePut::Created { etag })
    }

    async fn put_if_absent(&self, key: &str, body: Vec<u8>) -> Result<ETag, StoreError> {
        self.enter(FakeOp::PutIfAbsent, key, body.len() as u64).await?;

        let mut objects = self.objects.lock().expect("not poisoned");
        if objects.contains_key(key) {
            return Err(StoreError::PreconditionFailed);
        }

        let etag = self.mint_etag();
        objects.insert(
            key.to_string(),
            Stored {
                bytes: body,
                etag: etag.clone(),
                modified_ms: self.clock_ms.load(Ordering::SeqCst),
            },
        );

        Ok(etag)
    }

    async fn put_if_match(
        &self,
        key: &str,
        expected: &ETag,
        body: Vec<u8>,
    ) -> Result<ETag, StoreError> {
        self.enter(FakeOp::PutIfMatch, key, body.len() as u64).await?;

        let mut objects = self.objects.lock().expect("not poisoned");
        let Some(stored) = objects.get_mut(key) else {
            return Err(StoreError::NotFound);
        };
        if stored.etag != *expected {
            return Err(StoreError::PreconditionFailed);
        }

        let etag = self.mint_etag();
        stored.bytes = body;
        stored.etag = etag.clone();
        stored.modified_ms = self.clock_ms.load(Ordering::SeqCst);

        Ok(etag)
    }

    async fn get(&self, key: &str) -> Result<StoredObject, StoreError> {
        let found = self
            .objects
            .lock()
            .expect("not poisoned")
            .get(key)
            .map(|stored| (stored.bytes.clone(), stored.etag.clone()));

        let size = found.as_ref().map(|(bytes, _)| bytes.len()).unwrap_or(0);
        self.enter(FakeOp::Get, key, size as u64).await?;

        let (bytes, etag) = found.ok_or(StoreError::NotFound)?;

        Ok(StoredObject {
            meta: ObjectMeta {
                content_sha256: Some(crate::projects::image::sha256_hex(&bytes)),
                etag,
            },
            bytes,
        })
    }

    async fn get_if_none_match(
        &self,
        key: &str,
        known: &ETag,
    ) -> Result<ConditionalGet, StoreError> {
        let found = self
            .objects
            .lock()
            .expect("not poisoned")
            .get(key)
            .map(|stored| (stored.bytes.clone(), stored.etag.clone()));

        // A 304 carries no body, and AD-6 still bills it as a GET: counted, but no bytes moved.
        let unchanged = found
            .as_ref()
            .is_some_and(|(_, etag)| etag == known);
        let size = match (&found, unchanged) {
            (Some((bytes, _)), false) => bytes.len(),
            _ => 0,
        };
        self.enter(FakeOp::GetIfNoneMatch, key, size as u64).await?;

        let (bytes, etag) = found.ok_or(StoreError::NotFound)?;
        if unchanged {
            return Ok(ConditionalGet::NotModified);
        }

        Ok(ConditionalGet::Modified(StoredObject {
            meta: ObjectMeta {
                content_sha256: Some(crate::projects::image::sha256_hex(&bytes)),
                etag,
            },
            bytes,
        }))
    }

    async fn head(&self, key: &str) -> Result<ObjectMeta, StoreError> {
        self.enter(FakeOp::Head, key, 0).await?;

        let objects = self.objects.lock().expect("not poisoned");
        let stored = objects.get(key).ok_or(StoreError::NotFound)?;

        Ok(ObjectMeta {
            content_sha256: Some(crate::projects::image::sha256_hex(&stored.bytes)),
            etag: stored.etag.clone(),
        })
    }

    async fn exists(&self, key: &str) -> Result<bool, StoreError> {
        self.enter(FakeOp::Exists, key, 0).await?;

        Ok(self
            .objects
            .lock()
            .expect("not poisoned")
            .contains_key(key))
    }

    async fn list(&self, prefix: &str) -> Result<Vec<ListedObject>, StoreError> {
        self.enter(FakeOp::List, prefix, 0).await?;

        let objects = self.objects.lock().expect("not poisoned");
        let mut listed: Vec<ListedObject> = objects
            .iter()
            .filter(|(key, _)| key.starts_with(prefix))
            .map(|(key, stored)| ListedObject {
                key: key.clone(),
                size: stored.bytes.len() as u64,
                last_modified_ms: stored.modified_ms,
            })
            .collect();
        listed.sort_by(|left, right| left.key.cmp(&right.key));

        Ok(listed)
    }

    async fn delete(&self, key: &str) -> Result<(), StoreError> {
        self.enter(FakeOp::Delete, key, 0).await?;
        self.objects.lock().expect("not poisoned").remove(key);

        Ok(())
    }
}

impl ObjectStore for Arc<FakeObjectStore> {
    fn account_prefix(&self) -> &str {
        (**self).account_prefix()
    }

    async fn put_immutable(&self, key: &str, body: Vec<u8>) -> Result<ImmutablePut, StoreError> {
        (**self).put_immutable(key, body).await
    }

    async fn put_if_absent(&self, key: &str, body: Vec<u8>) -> Result<ETag, StoreError> {
        (**self).put_if_absent(key, body).await
    }

    async fn put_if_match(
        &self,
        key: &str,
        expected: &ETag,
        body: Vec<u8>,
    ) -> Result<ETag, StoreError> {
        (**self).put_if_match(key, expected, body).await
    }

    async fn get(&self, key: &str) -> Result<StoredObject, StoreError> {
        (**self).get(key).await
    }

    async fn get_if_none_match(
        &self,
        key: &str,
        known: &ETag,
    ) -> Result<ConditionalGet, StoreError> {
        (**self).get_if_none_match(key, known).await
    }

    async fn head(&self, key: &str) -> Result<ObjectMeta, StoreError> {
        (**self).head(key).await
    }

    async fn exists(&self, key: &str) -> Result<bool, StoreError> {
        (**self).exists(key).await
    }

    async fn list(&self, prefix: &str) -> Result<Vec<ListedObject>, StoreError> {
        (**self).list(prefix).await
    }

    async fn delete(&self, key: &str) -> Result<(), StoreError> {
        (**self).delete(key).await
    }
}

pub(crate) struct FixedCapabilities(bool);

impl CapabilitySource for FixedCapabilities {
    async fn capabilities(&self) -> AccountCapabilities {
        AccountCapabilities::from_cloud_entitlement(self.0)
    }
}

/// The account every fake vends for. It has to match `FixedGateState`'s pin, or the gate
/// would refuse its own fake as a different account.
pub(crate) const FAKE_IDENTITY_ID: &str = "us-east-1:0000";
pub(crate) const FAKE_OWNER_SUB: &str = "sub-0";

pub(crate) struct FixedGateState(Option<FrozenReason>);

impl GateStateSource for FixedGateState {
    fn gate_state(&self) -> Result<GateState, AuthError> {
        Ok(GateState {
            pin: Some(AccountPin::new(FAKE_IDENTITY_ID, FAKE_OWNER_SUB)),
            frozen_reason: self.0,
        })
    }
}

/// The store is wrapped so a test keeps its own handle to the counters after `GatedStore` has taken
/// ownership: `GatedStore` hands out no reference to what it wraps, which is the property that makes
/// the gate unbypassable and is deliberately not weakened for tests.
pub(crate) type FakeGate = SyncGate<DatasetKind, FixedCapabilities, FixedGateState>;
pub(crate) type FakeGatedStore = GatedStore<Arc<FakeObjectStore>, FakeGate>;

/// A gated fake in whatever state the test needs. Taking the three conditions as arguments rather
/// than offering only a happy path is what makes the AD-14 "zero calls" assertions cheap.
pub(crate) fn gated_fake(
    store: Arc<FakeObjectStore>,
    kind: DatasetKind,
    entitled: bool,
    frozen: Option<FrozenReason>,
) -> FakeGatedStore {
    gated_fake_limited(
        store,
        kind,
        entitled,
        frozen,
        Arc::new(DatasetLimits::default()),
    )
}

/// The same gated fake with AD-18's bounds supplied, which is how a test tightens the rate cap or
/// keeps a handle on the counters after `GatedStore` has taken ownership.
pub(crate) fn gated_fake_limited(
    store: Arc<FakeObjectStore>,
    kind: DatasetKind,
    entitled: bool,
    frozen: Option<FrozenReason>,
    limits: Arc<DatasetLimits>,
) -> FakeGatedStore {
    GatedStore::new(
        store,
        SyncGate::new(kind, FixedCapabilities(entitled), FixedGateState(frozen)),
        limits,
    )
}

/// The ordinary case: cloud-linked, entitled, not frozen.
pub(crate) fn syncing_fake(store: Arc<FakeObjectStore>) -> FakeGatedStore {
    gated_fake(store, DatasetKind::CloudLinked, true, None)
}

/// What the fake applier saw. This is Story 20's slot: the pull side is finished at Story 19, so
/// what can be proven today is exactly which batches were handed on, in which order, once each.
#[derive(Debug, Default)]
pub(crate) struct Recorded {
    /// `(install, seq, message count)` in the order the batches arrived.
    pub batches: Vec<(String, i64, usize)>,
    pub messages: Vec<SegmentMessage>,
    /// Makes the next apply fail, which is how a test proves a refused batch stays owed.
    pub refuse: bool,
    /// What the applier answers `take_clock_skew` with, draining it like the real one does.
    ///
    /// The seam and not a real clock: the apply path's `Clock` is built inside `DatasetApplier`
    /// from the dataset's own install id and reads the system wall clock (Story 20 recorded that it
    /// is deliberately not injectable), so a manager-level test cannot move it. `Clock`'s own unit
    /// tests prove the drift detection; this proves what the ACTOR does with it.
    pub clock_skew_ms: Option<i64>,
}

/// The recording fake Story 19 hands fetched messages to.
pub(crate) struct RecordingApplier(Arc<Mutex<Recorded>>);

impl Applier for RecordingApplier {
    fn apply(&mut self, batch: &SegmentBatch) -> Result<usize, crate::error::AppError> {
        let mut recorded = self.0.lock().expect("the applier lock");
        if recorded.refuse {
            return Err(crate::error::AppError::NotConfigured);
        }

        recorded
            .batches
            .push((batch.install.clone(), batch.seq, batch.messages.len()));
        recorded.messages.extend(batch.messages.iter().cloned());

        Ok(batch.messages.len())
    }

    fn take_clock_skew(&mut self) -> Option<i64> {
        self.0.lock().expect("the applier lock").clock_skew_ms.take()
    }
}

/// One simulated computer: its own app-data directory, its own dataset file, its own
/// connections, and a `SyncHost` the actor can be built from.
///
/// This is the harness Story 12 and the final Milestone-1 proof drive: two of these over
/// ONE shared `FakeObjectStore` is "two computers, one cloud account", with no network, no
/// AWS and no Tauri app in the way.
///
/// It is split into the host (which the actor takes ownership of) and a probe (which the
/// test keeps), because `SyncActor` owns its host and a test still has to write rows, read
/// rows and list dated backups afterwards. Everything shared between the two halves is
/// behind an `Arc`, including the `TempDir`, so the directory outlives both.
pub(crate) struct TestComputer {
    id: String,
    label: String,
    root: PathBuf,
    db_path: PathBuf,
    backup_dir: PathBuf,
    own: Arc<Mutex<Option<Connection>>>,
    store: Arc<FakeObjectStore>,
    kind: DatasetKind,
    entitled: Arc<AtomicBool>,
    frozen: Arc<Mutex<Option<FrozenReason>>>,
    clock: Arc<AtomicI64>,
    /// The schema version this simulated computer's BUILD understands (AD-11).
    ///
    /// Shared with the probe and settable, because version skew is by definition two builds and a
    /// test has only one: lowering it here is "this computer is the old one", and raising it again
    /// is "the user updated Nixus".
    schema_version: Arc<AtomicU32>,
    slot: FakeSlot,
    applied: Arc<Mutex<Recorded>>,
    /// Whether `applier()` hands back the REAL apply path instead of the recorder.
    ///
    /// Opt-in because most tests here count requests and assert on the messages a batch carried;
    /// the row-level convergence proofs (Story 23) need the batch to actually land in the tables.
    apply_for_real: bool,
    limits: Arc<DatasetLimits>,
    _dir: Arc<TempDir>,
}

/// The test's half of a `TestComputer`.
pub(crate) struct ComputerProbe {
    root: PathBuf,
    db_path: PathBuf,
    backup_dir: PathBuf,
    live: Arc<Mutex<Option<Connection>>>,
    store: Arc<FakeObjectStore>,
    entitled: Arc<AtomicBool>,
    frozen: Arc<Mutex<Option<FrozenReason>>>,
    applied: Arc<Mutex<Recorded>>,
    schema_version: Arc<AtomicU32>,
    id: String,
    _dir: Arc<TempDir>,
}

/// Closes and republishes both connections to one simulated computer's dataset file: the
/// actor's own and the "UI's". The production slot does exactly this over `DbState`.
pub(crate) struct FakeSlot {
    own: Arc<Mutex<Option<Connection>>>,
    live: Arc<Mutex<Option<Connection>>>,
}

impl crate::db::backup::DatasetSlot for FakeSlot {
    fn close(&self) -> Result<(), crate::error::AppError> {
        for cell in [&self.own, &self.live] {
            if let Ok(mut guard) = cell.lock() {
                drop(guard.take());
            }
        }

        Ok(())
    }

    fn adopt(&self, conn: Connection) -> Result<(), crate::error::AppError> {
        if let Ok(mut guard) = self.live.lock() {
            *guard = Some(conn);
        }

        Ok(())
    }
}

/// A cloud-linked, entitled, un-frozen computer with a freshly migrated empty dataset.
///
/// `clock_base` is the value `now_ms` starts at and is why two computers produce different
/// `created_ms` values without a real clock: each call advances by one second.
pub(crate) fn test_computer(
    id: &str,
    store: Arc<FakeObjectStore>,
    clock_base: i64,
) -> (TestComputer, ComputerProbe) {
    let dir = Arc::new(tempfile::tempdir().expect("a temp app-data dir"));
    let root = dir.path().to_path_buf();
    let db_path = root.join(crate::datasets::DB_FILE_NAME);
    let backup_dir = root.join("backups");

    // Created through the real `open_configured`, so every migration and CHECK applies.
    let live = Arc::new(Mutex::new(Some(crate::db::test_dataset::migrated_dataset(
        &db_path,
    ))));
    let own = Arc::new(Mutex::new(None));
    let entitled = Arc::new(AtomicBool::new(true));
    let frozen = Arc::new(Mutex::new(None));
    let applied = Arc::new(Mutex::new(Recorded::default()));
    let schema_version = Arc::new(AtomicU32::new(
        u32::try_from(crate::db::latest_schema_version()).expect("the schema version fits"),
    ));

    let host = TestComputer {
        id: id.to_string(),
        label: format!("Computer {id}"),
        root,
        db_path: db_path.clone(),
        backup_dir: backup_dir.clone(),
        own: Arc::clone(&own),
        store: Arc::clone(&store),
        kind: DatasetKind::CloudLinked,
        entitled: Arc::clone(&entitled),
        frozen: Arc::clone(&frozen),
        clock: Arc::new(AtomicI64::new(clock_base)),
        schema_version: Arc::clone(&schema_version),
        slot: FakeSlot {
            own,
            live: Arc::clone(&live),
        },
        applied: Arc::clone(&applied),
        apply_for_real: false,
        limits: Arc::new(DatasetLimits::default()),
        _dir: Arc::clone(&dir),
    };

    let probe = ComputerProbe {
        root: dir.path().to_path_buf(),
        db_path,
        backup_dir,
        live,
        store,
        entitled,
        frozen,
        applied,
        schema_version,
        id: id.to_string(),
        _dir: dir,
    };

    (host, probe)
}

impl TestComputer {
    /// The same computer, but on a profile that is not cloud-linked: inherited AD-12's
    /// "no sync code path runs for a local-only dataset".
    pub(crate) fn local_only(mut self) -> Self {
        self.kind = DatasetKind::Local;
        self
    }

    pub(crate) fn applying_for_real(mut self) -> Self {
        self.apply_for_real = true;
        self
    }
}

impl ComputerProbe {
    pub(crate) fn store(&self) -> &Arc<FakeObjectStore> {
        &self.store
    }

    pub(crate) fn db_path(&self) -> &std::path::Path {
        &self.db_path
    }

    /// The app-data root of this simulated computer: where CAP-5 *separate* provisions the
    /// second profile and where its dataset registry lives.
    pub(crate) fn root(&self) -> &std::path::Path {
        &self.root
    }

    /// Closes the connection standing in for the UI's, so the dataset file can be compared
    /// byte for byte with no `-wal` left beside it. Reopened lazily by the next read.
    pub(crate) fn close_live(&self) {
        if let Ok(mut guard) = self.live.lock() {
            if let Some(conn) = guard.as_ref() {
                let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
            }
            drop(guard.take());
        }
    }

    /// A read through a connection of the test's own, for the assertions that compare two
    /// computers' datasets table by table.
    pub(crate) fn read<T>(&self, read: impl FnOnce(&Connection) -> T) -> T {
        self.with_live(read)
    }

    /// A local write, through the connection that stands in for the UI's. This is what
    /// `PRAGMA data_version` on the actor's own connection is supposed to notice, and what
    /// has to keep working while sync is Frozen.
    pub(crate) fn write_row(&self, name: &str) {
        self.with_live(|conn| crate::db::test_dataset::insert_marker_rows(conn, &[name]));
    }

    pub(crate) fn rows(&self) -> Vec<String> {
        self.with_live(crate::db::test_dataset::marker_rows)
    }

    fn with_live<T>(&self, operation: impl FnOnce(&Connection) -> T) -> T {
        let mut guard = self.live.lock().expect("the live connection lock");
        if guard.is_none() {
            *guard = Some(crate::db::test_dataset::migrated_dataset(&self.db_path));
        }

        operation(guard.as_ref().expect("the live connection is open"))
    }

    /// The files CAP-5's *replace* path leaves behind.
    pub(crate) fn dated_backups(&self) -> Vec<PathBuf> {
        let Ok(entries) = std::fs::read_dir(&self.backup_dir) else {
            return Vec::new();
        };

        let mut paths: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect();
        paths.sort();

        paths
    }

    /// Takes the `multi_device_sync` capability away, or gives it back (AD-14, CAP-8).
    pub(crate) fn set_entitled(&self, entitled: bool) {
        self.entitled.store(entitled, Ordering::SeqCst);
    }

    /// Gives this computer a project with a full-size picture, and answers with the content hash
    /// AD-10 addresses it by. A thumbnail is attached because that is what a real upload stores
    /// and what has to survive the snapshot's blanking.
    pub(crate) fn store_project_image(&self, project_id: i64, bytes: &[u8]) -> String {
        self.with_live(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO projects (id, name, target_cents) VALUES (?1, ?2, 100000)",
                rusqlite::params![project_id, format!("Project {project_id}")],
            )
            .expect("the project exists");

            crate::db::projects::upsert_project_image(
                conn,
                project_id,
                &crate::db::projects::ProjectImageWrite {
                    mime_type: "image/png",
                    original_filename: "cover.png",
                    bytes,
                    thumbnail: Some((&bytes[..bytes.len().min(512)], "image/png")),
                },
            )
            .expect("the picture stores");
        });

        crate::projects::image::sha256_hex(bytes)
    }

    pub(crate) fn project_image(
        &self,
        project_id: i64,
    ) -> Option<crate::db::projects::ProjectImageRow> {
        self.with_live(|conn| {
            crate::db::projects::get_project_image(conn, project_id).expect("the picture reads")
        })
    }

    pub(crate) fn frozen_reason(&self) -> Option<FrozenReason> {
        *self.frozen.lock().expect("the frozen reason lock")
    }

    /// A local write through the REAL capture path, so the dataset ends up holding real
    /// `sync_log` rows for the segment cutter to ship. `write_row` deliberately does not: a raw
    /// statement outside `ActiveDataset::write` is exactly the unmigrated write site the hook
    /// buffers and discards (Story 15), which is what the M1 snapshot tests need.
    pub(crate) fn write_captured(&self, name: &str) {
        self.captured(|tx| {
            crate::db::test_dataset::insert_marker_rows(tx, &[name]);
            Ok(())
        })
        .expect("a captured write succeeds");
    }

    /// The same real transaction and the same real hook `write_captured` uses, with the caller's
    /// own statements instead of one marker row.
    ///
    /// A two-computer proof has to edit accounts, expenses and the rest of the real schema, and it
    /// has to do it through `ActiveDataset::write` — a raw statement is the unmigrated write site
    /// the hook buffers and discards (Story 15), which would prove nothing about replication. The
    /// `Err` is handed back rather than unwrapped because a refused write is itself a claim some
    /// tests make.
    pub(crate) fn captured<T>(
        &self,
        write: impl FnOnce(&crate::db::WriteTx) -> Result<T, crate::error::AppError>,
    ) -> Result<T, crate::error::AppError> {
        self.with_active(|active| active.write(write))
    }

    /// Hands the caller the real `ActiveDataset` of this computer — a real connection with a real
    /// attached capture hook — so a proof can drive a production entry point that takes one
    /// (`sync::restore::{list, restore}`, `ActiveDataset::write_uncaptured` for the wipe) instead
    /// of re-implementing what it does.
    pub(crate) fn with_active<T>(
        &self,
        run: impl FnOnce(&crate::db::ActiveDataset) -> T,
    ) -> T {
        let mut guard = self.live.lock().expect("the live connection lock");
        if guard.is_none() {
            *guard = Some(crate::db::test_dataset::migrated_dataset(&self.db_path));
        }

        let conn = guard.take().expect("the live connection is open");
        let capture = crate::sync::capture::Capture::for_dataset(DatasetKind::CloudLinked, &conn)
            .expect("capture is built")
            .expect("a cloud-linked dataset captures");
        capture.attach(&conn).expect("the hook is installed");

        let dataset = crate::db::ActiveDataset {
            id: Some(self.id.clone()),
            conn: Some(conn),
            capture: Some(capture),
        };
        let outcome = run(&dataset);

        let crate::db::ActiveDataset { conn, .. } = dataset;
        *guard = conn;

        outcome
    }

    /// This computer's install id (AD-4), as the keys it writes spell it.
    pub(crate) fn install_id(&self) -> String {
        self.with_live(|conn| {
            crate::sync::state::ensure_install_on(conn)
                .expect("the install row reads")
                .install_id
        })
    }

    pub(crate) fn unshipped(&self) -> i64 {
        let install = self.install_id();
        self.with_live(|conn| {
            crate::db::sync_segment::unshipped_count(conn, &install).expect("the tail counts")
        })
    }

    /// Every batch the applier was handed, as `(install, seq, message count)`.
    pub(crate) fn applied_batches(&self) -> Vec<(String, i64, usize)> {
        self.applied.lock().expect("the applier lock").batches.clone()
    }

    pub(crate) fn applied_messages(&self) -> Vec<SegmentMessage> {
        self.applied.lock().expect("the applier lock").messages.clone()
    }

    /// What this computer's build understands (AD-11). Lowering it makes it the old computer;
    /// raising it back is the update that unparks what it refused.
    pub(crate) fn set_schema_version(&self, version: u32) {
        self.schema_version.store(version, Ordering::SeqCst);
    }

    pub(crate) fn schema_version(&self) -> u32 {
        self.schema_version.load(Ordering::SeqCst)
    }

    /// Makes the next `take_clock_skew` answer with this drift, exactly as the real applier's
    /// clock would after refusing a stamp that far ahead (AD-4).
    pub(crate) fn report_clock_skew(&self, ahead_ms: i64) {
        self.applied.lock().expect("the applier lock").clock_skew_ms = Some(ahead_ms);
    }

    pub(crate) fn refuse_apply(&self, refuse: bool) {
        self.applied.lock().expect("the applier lock").refuse = refuse;
    }

    /// Freezes this computer the way a support action or AD-7's refusal does, which is a
    /// different input from a lapsed entitlement even though both end in `Frozen`.
    pub(crate) fn set_frozen(&self, reason: Option<FrozenReason>) {
        *self.frozen.lock().expect("the frozen reason lock") = reason;
    }
}

impl crate::sync::manager::SyncHost for TestComputer {
    type Store = Arc<FakeObjectStore>;
    type Link = DatasetKind;
    type Caps = FixedCapabilities;
    type GateState = FixedGateState;
    type Slot = FakeSlot;

    fn dataset_id(&self) -> &str {
        &self.id
    }

    fn db_path(&self) -> &std::path::Path {
        &self.db_path
    }

    fn backup_dir(&self) -> &std::path::Path {
        &self.backup_dir
    }

    fn root(&self) -> &std::path::Path {
        &self.root
    }

    fn label(&self) -> &str {
        &self.label
    }

    fn schema_version(&self) -> u32 {
        self.schema_version.load(Ordering::SeqCst)
    }

    fn now_ms(&self) -> i64 {
        self.clock.fetch_add(1_000, Ordering::SeqCst)
    }

    fn data_version(&self) -> Result<i64, crate::sync::manager::SyncFault> {
        self.with_own(crate::db::data_version)
    }

    fn local_data(
        &self,
    ) -> Result<crate::db::backup::LocalData, crate::sync::manager::SyncFault> {
        self.with_own(crate::db::backup::local_data_summary)
    }

    fn with_dataset<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, crate::error::AppError>,
    ) -> Result<T, crate::sync::manager::SyncFault> {
        self.with_own(operation)
    }

    fn slot(&self) -> &Self::Slot {
        &self.slot
    }

    fn applier(&self) -> Box<dyn Applier + Send> {
        if self.apply_for_real {
            if let Ok(applier) = crate::sync::apply::DatasetApplier::open(&self.db_path, None) {
                return Box::new(applier);
            }
        }

        Box::new(RecordingApplier(Arc::clone(&self.applied)))
    }

    fn release(&self) {
        if let Ok(mut guard) = self.own.lock() {
            drop(guard.take());
        }
    }

    fn freeze(&self, reason: FrozenReason) {
        *self.frozen.lock().expect("the frozen reason lock") = Some(reason);
    }

    fn forget_credentials(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + '_>> {
        Box::pin(std::future::ready(()))
    }

    fn limits(&self) -> &Arc<DatasetLimits> {
        &self.limits
    }

    fn connect(
        &self,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<
                        crate::sync::manager::SyncSession<
                            Arc<FakeObjectStore>,
                            DatasetKind,
                            FixedCapabilities,
                            FixedGateState,
                        >,
                        crate::sync::manager::SyncFault,
                    >,
                > + '_,
        >,
    > {
        Box::pin(async move {
            // Rebuilt per call, exactly like the production host rebuilds the S3 adapter
            // from a fresh vend: that is what lets a test lapse an entitlement or freeze a
            // dataset mid-run and have the very next operation see it.
            Ok(crate::sync::manager::SyncSession {
                store: gated_fake_limited(
                    Arc::clone(&self.store),
                    self.kind.clone(),
                    self.entitled.load(Ordering::SeqCst),
                    *self.frozen.lock().expect("the frozen reason lock"),
                    Arc::clone(&self.limits),
                ),
                pin: AccountPin::new(FAKE_IDENTITY_ID, FAKE_OWNER_SUB),
            })
        })
    }
}

impl TestComputer {
    fn with_own<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, crate::error::AppError>,
    ) -> Result<T, crate::sync::manager::SyncFault> {
        let mut guard = self
            .own
            .lock()
            .map_err(|_| crate::sync::manager::SyncFault::StateUnavailable)?;

        if guard.is_none() {
            *guard = Some(crate::db::test_dataset::migrated_dataset(&self.db_path));
        }

        let conn = guard
            .as_ref()
            .ok_or(crate::sync::manager::SyncFault::StateUnavailable)?;

        operation(conn).map_err(|_| crate::sync::manager::SyncFault::StateUnavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> FakeObjectStore {
        FakeObjectStore::default()
    }

    #[tokio::test]
    async fn an_immutable_key_is_written_once_and_a_retry_of_the_same_bytes_succeeds() {
        let fake = store();

        assert!(matches!(
            fake.put_immutable("snap/a", b"one".to_vec()).await,
            Ok(ImmutablePut::Created { .. })
        ));
        assert!(matches!(
            fake.put_immutable("snap/a", b"one".to_vec()).await,
            Ok(ImmutablePut::AlreadyStored { .. })
        ));
        assert_eq!(
            fake.put_immutable("snap/a", b"two".to_vec()).await,
            Err(StoreError::ContentHashMismatch)
        );
    }

    #[tokio::test]
    async fn a_mutable_key_moves_only_for_the_etag_it_currently_holds() {
        let fake = store();

        let first = fake
            .put_if_absent("snap/LATEST", b"one".to_vec())
            .await
            .expect("the first write creates it");
        assert_eq!(
            fake.put_if_absent("snap/LATEST", b"two".to_vec()).await,
            Err(StoreError::PreconditionFailed)
        );

        let second = fake
            .put_if_match("snap/LATEST", &first, b"two".to_vec())
            .await
            .expect("the swap succeeds");
        assert_eq!(
            fake.put_if_match("snap/LATEST", &first, b"three".to_vec())
                .await,
            Err(StoreError::PreconditionFailed),
            "a stale etag must not win"
        );
        assert_eq!(fake.stored("snap/LATEST").as_deref(), Some(&b"two"[..]));

        assert_eq!(
            fake.put_if_match("roster", &second, b"x".to_vec()).await,
            Err(StoreError::NotFound)
        );
    }

    #[tokio::test]
    async fn a_conditional_get_answers_not_modified_for_the_etag_it_was_given() {
        let fake = store();
        let etag = fake.seed("roster", b"installs".to_vec());

        assert_eq!(
            fake.get_if_none_match("roster", &etag).await,
            Ok(ConditionalGet::NotModified)
        );
        assert!(matches!(
            fake.get_if_none_match("roster", &ETag::new("\"other\"")).await,
            Ok(ConditionalGet::Modified(_))
        ));
        assert_eq!(
            fake.get_if_none_match("absent", &etag).await,
            Err(StoreError::NotFound)
        );
    }

    #[tokio::test]
    async fn every_request_is_counted_and_a_queued_fault_is_taken_once() {
        let fake = store();
        fake.fail_next(FakeOp::Get, StoreError::ConditionalConflict);
        fake.seed("snap/LATEST", b"body".to_vec());

        assert_eq!(
            fake.get("snap/LATEST").await.map(|_| ()),
            Err(StoreError::ConditionalConflict)
        );
        assert!(fake.get("snap/LATEST").await.is_ok(), "the fault is spent");
        assert_eq!(fake.calls(), 2);
        assert_eq!(fake.calls_of(FakeOp::Get), 2);
        assert_eq!(fake.calls_of(FakeOp::Head), 0);
    }

    /// The throttle has to be proportional to the payload, or Story 9's timing gate would measure
    /// the fake's constant overhead instead of a download.
    #[tokio::test(start_paused = true)]
    async fn a_throttled_transfer_takes_as_long_as_its_size_implies() {
        let fake = store();
        fake.seed("snap/big", vec![0u8; 1_250_000]);
        fake.throttle_to(1_250_000);

        let started = tokio::time::Instant::now();
        fake.get("snap/big").await.expect("the download succeeds");

        assert_eq!(started.elapsed(), Duration::from_secs(1));
        assert_eq!(fake.transferred_bytes(), 1_250_000);
    }
}
