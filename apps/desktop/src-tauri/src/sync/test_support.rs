//! An in-memory `ObjectStore` with the REAL conditional-write semantics (AD-6), for tests that have
//! to prove a protocol rather than a return value.
//!
//! WHY it is shared rather than per-test: Stories 9 and 12 replay the same create-only / `If-Match`
//! / `304` / `412` / `409` / `404` matrix against bootstrap and against the final proof, and a
//! second hand-rolled fake would be a second set of assumptions about what S3 answers. The call
//! counters are what let a test assert that a blocked dataset made *zero* requests — an assertion on
//! the returned error would pass even if the request had gone out.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::db::sync_state::FrozenReason;
use crate::entitlements::AccountCapabilities;
use crate::models::DatasetKind;
use crate::sync::auth::{AccountPin, AuthError};
use crate::sync::gate::{CapabilitySource, GateStateSource, GatedStore, SyncGate};
use crate::sync::state::GateState;
use crate::sync::store::{
    ConditionalGet, ETag, ImmutablePut, ObjectMeta, ObjectStore, StoreError, StoredObject,
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
}

struct Stored {
    bytes: Vec<u8>,
    etag: ETag,
}

#[derive(Default)]
struct Counters {
    total: u64,
    by_op: HashMap<FakeOp, u64>,
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

    fn mint_etag(&self) -> ETag {
        ETag::new(format!(
            "\"{}\"",
            self.next_etag.fetch_add(1, Ordering::SeqCst)
        ))
    }

    /// One place where a call is counted, a queued fault is taken and the throttle is paid, so no
    /// operation can be added that silently escapes any of the three.
    async fn enter(&self, op: FakeOp, bytes: u64) -> Result<(), StoreError> {
        {
            let mut counters = self.counters.lock().expect("not poisoned");
            counters.total += 1;
            *counters.by_op.entry(op).or_insert(0) += 1;
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
        self.enter(FakeOp::PutImmutable, body.len() as u64).await?;

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
            },
        );

        Ok(ImmutablePut::Created { etag })
    }

    async fn put_if_absent(&self, key: &str, body: Vec<u8>) -> Result<ETag, StoreError> {
        self.enter(FakeOp::PutIfAbsent, body.len() as u64).await?;

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
        self.enter(FakeOp::PutIfMatch, body.len() as u64).await?;

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
        self.enter(FakeOp::Get, size as u64).await?;

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
        self.enter(FakeOp::GetIfNoneMatch, size as u64).await?;

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
        self.enter(FakeOp::Head, 0).await?;

        let objects = self.objects.lock().expect("not poisoned");
        let stored = objects.get(key).ok_or(StoreError::NotFound)?;

        Ok(ObjectMeta {
            content_sha256: Some(crate::projects::image::sha256_hex(&stored.bytes)),
            etag: stored.etag.clone(),
        })
    }

    async fn exists(&self, key: &str) -> Result<bool, StoreError> {
        self.enter(FakeOp::Exists, 0).await?;

        Ok(self
            .objects
            .lock()
            .expect("not poisoned")
            .contains_key(key))
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
}

pub(crate) struct FixedCapabilities(bool);

impl CapabilitySource for FixedCapabilities {
    async fn capabilities(&self) -> AccountCapabilities {
        AccountCapabilities::from_cloud_entitlement(self.0)
    }
}

pub(crate) struct FixedGateState(Option<FrozenReason>);

impl GateStateSource for FixedGateState {
    fn gate_state(&self) -> Result<GateState, AuthError> {
        Ok(GateState {
            pin: Some(AccountPin::new("us-east-1:0000", "sub-0")),
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
    GatedStore::new(
        store,
        SyncGate::new(kind, FixedCapabilities(entitled), FixedGateState(frozen)),
    )
}

/// The ordinary case: cloud-linked, entitled, not frozen.
pub(crate) fn syncing_fake(store: Arc<FakeObjectStore>) -> FakeGatedStore {
    gated_fake(store, DatasetKind::CloudLinked, true, None)
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
