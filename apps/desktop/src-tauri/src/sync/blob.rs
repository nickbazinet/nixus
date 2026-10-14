//! Full project images as content-addressed blobs (AD-10).
//!
//! An image is stored once per CONTENT: its object key is `blob/<sha256 of the image bytes>`
//! relative to the account prefix (AD-6), so two computers holding the same picture name the same
//! object and the second upload is a no-op instead of a duplicate. That is also what makes the
//! upload safe to retry — the key is immutable, written `If-None-Match: *`, and an existing key
//! whose stored hash matches is reported as `AlreadyStored` rather than as a conflict.
//!
//! Every transfer goes through `GatedStore`, so a local-only, un-entitled or Frozen dataset reaches
//! no network at all (AD-14, inherited AD-12). Nothing in `db/` calls into this module: local reads
//! and writes of an image are pure SQLite, and the sync path is the only thing that ever leaves the
//! machine.

use sha2::{Digest, Sha256};

use super::gate::{GatedError, GatedStore, SyncGate};
use super::object::{hex_lower, ObjectHeader, ObjectHeaderError};
use super::store::{ImmutablePut, ObjectStore};

/// AD-6's immutable blob namespace, relative to `acct/<identity-id>/`.
pub const BLOB_KEY_PREFIX: &str = "blob/";

/// A sha256 as 64 lowercase hex characters, which is what the schema's
/// `project_images_image_sha256_is_hex` guard also admits.
const SHA256_HEX_LEN: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlobError {
    /// The hash a caller asked for is not a sha256 digest, so it could name anything. Refused
    /// before a request is made: a key assembled from an unvalidated string is how a caller would
    /// otherwise address something that is not a blob.
    InvalidHash,
    /// The bytes that came back do not hash to the key they were fetched from. The download is
    /// discarded: writing it into `image_bytes` would store one picture under another's identity.
    ContentMismatch { expected: String, found: String },
    Header(ObjectHeaderError),
    Store(GatedError),
}

impl From<GatedError> for BlobError {
    fn from(error: GatedError) -> Self {
        BlobError::Store(error)
    }
}

impl From<ObjectHeaderError> for BlobError {
    fn from(error: ObjectHeaderError) -> Self {
        BlobError::Header(error)
    }
}

impl std::fmt::Display for BlobError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BlobError::InvalidHash => f.write_str("blob hash is not a sha256 digest"),
            BlobError::ContentMismatch { expected, found } => {
                write!(f, "blob {expected} holds content hashing to {found}")
            }
            BlobError::Header(error) => write!(f, "blob header: {error}"),
            BlobError::Store(error) => write!(f, "blob transfer: {error:?}"),
        }
    }
}

impl std::error::Error for BlobError {}

/// What an upload did. `Created` versus `AlreadyDeduplicated` is the whole value of
/// content-addressing, and AD-19's cost story is counted on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlobUpload {
    Created,
    AlreadyDeduplicated,
}

/// The object key for an image hash, refusing anything that is not a digest.
pub fn blob_key(sha256_hex: &str) -> Result<String, BlobError> {
    let is_digest = sha256_hex.len() == SHA256_HEX_LEN
        && sha256_hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if !is_digest {
        return Err(BlobError::InvalidHash);
    }

    Ok(format!("{BLOB_KEY_PREFIX}{sha256_hex}"))
}

/// The content identity of these exact bytes, as both the digest the AD-8 header carries and the
/// hex form the key and `project_images.image_sha256` use. Hashed ONCE for both, because the bytes
/// are up to 4 MiB.
fn identity(bytes: &[u8]) -> ([u8; 32], String) {
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    let hex = hex_lower(&digest);

    (digest, hex)
}

/// Uploads one full image, create-only, under its own content hash.
///
/// `schema_version` rides in the AD-8 header so a reader can tell which schema produced the
/// object; the blob's payload is the raw image bytes and is never transformed, which is what keeps
/// the key's hash equal to `project_images.image_sha256`.
pub async fn put_image_blob<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    schema_version: u32,
    bytes: &[u8],
) -> Result<(String, BlobUpload), BlobError>
where
    S: ObjectStore,
    L: super::gate::DatasetLink,
    C: super::gate::CapabilitySource,
    T: super::gate::GateStateSource,
{
    let (digest, hex) = identity(bytes);
    let key = blob_key(&hex)?;
    let body = ObjectHeader::new(schema_version, digest).frame(bytes);

    let outcome = match store.put_immutable(&key, body).await? {
        ImmutablePut::Created { .. } => BlobUpload::Created,
        ImmutablePut::AlreadyStored { .. } => BlobUpload::AlreadyDeduplicated,
    };

    Ok((hex, outcome))
}

/// Whether the cloud already holds this image, as a request that moves no body.
///
/// Worth one extra round trip because the alternative is not free: `put_immutable` has to send the
/// whole multi-megabyte payload before S3 can tell it the key exists, and a blob uploaded by
/// ANOTHER computer on the same account is exactly the common case after a bootstrap. A probe of
/// 0 bytes answering "already there" turns that re-upload into a marker write.
pub async fn blob_present<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    sha256_hex: &str,
) -> Result<bool, BlobError>
where
    S: ObjectStore,
    L: super::gate::DatasetLink,
    C: super::gate::CapabilitySource,
    T: super::gate::GateStateSource,
{
    let key = blob_key(sha256_hex)?;

    Ok(store.exists(&key).await?)
}

/// Downloads one full image by its hash and proves it is that image before returning it.
///
/// The verification is not belt-and-braces: a blob is written once and read on a different
/// computer, possibly years later, through a transport that can mirror, truncate or re-encode. The
/// hash is the only thing that says the bytes are the picture the row names, so a mismatch is a
/// refusal with both hashes reported, never a best-effort return.
pub async fn fetch_image_blob<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    sha256_hex: &str,
) -> Result<Vec<u8>, BlobError>
where
    S: ObjectStore,
    L: super::gate::DatasetLink,
    C: super::gate::CapabilitySource,
    T: super::gate::GateStateSource,
{
    let key = blob_key(sha256_hex)?;
    let stored = store.get(&key).await?;

    let (header, payload) = ObjectHeader::parse(&stored.bytes)?;
    let (digest, found) = identity(payload);

    if found != sha256_hex || digest != header.content_sha256 {
        return Err(BlobError::ContentMismatch {
            expected: sha256_hex.to_string(),
            found,
        });
    }

    Ok(payload.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sync_state::FrozenReason;
    use crate::entitlements::AccountCapabilities;
    use crate::models::DatasetKind;
    use crate::projects::image::sha256_hex;
    use crate::sync::auth::{AccountPin, AuthError};
    use crate::sync::gate::{CapabilitySource, GateStateSource, SyncBlocked};
    use crate::sync::object::OBJECT_HEADER_LEN;
    use crate::sync::state::GateState;
    use crate::sync::store::{
        ConditionalGet, ETag, ObjectMeta, StoreError, StoredObject,
    };
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// An object store that actually stores, so create-only semantics and the round trip can be
    /// exercised end to end instead of being asserted against a stub's canned answer.
    #[derive(Default)]
    struct MemoryStore {
        objects: Mutex<HashMap<String, Vec<u8>>>,
    }

    impl MemoryStore {
        fn insert(&self, key: &str, bytes: Vec<u8>) {
            self.objects
                .lock()
                .expect("the lock is not poisoned")
                .insert(key.to_string(), bytes);
        }
    }

    impl ObjectStore for MemoryStore {
        fn account_prefix(&self) -> &str {
            "acct/us-east-1:abc/"
        }

        async fn put_immutable(
            &self,
            key: &str,
            body: Vec<u8>,
        ) -> Result<ImmutablePut, StoreError> {
            let mut objects = self.objects.lock().expect("the lock is not poisoned");
            match objects.get(key) {
                Some(stored) if *stored == body => Ok(ImmutablePut::AlreadyStored {
                    etag: ETag::new("etag"),
                }),
                Some(_) => Err(StoreError::ContentHashMismatch),
                None => {
                    objects.insert(key.to_string(), body);
                    Ok(ImmutablePut::Created {
                        etag: ETag::new("etag"),
                    })
                }
            }
        }

        async fn put_if_absent(&self, _key: &str, _body: Vec<u8>) -> Result<ETag, StoreError> {
            unimplemented!("a blob is never written to a mutable key")
        }

        async fn put_if_match(
            &self,
            _key: &str,
            _expected: &ETag,
            _body: Vec<u8>,
        ) -> Result<ETag, StoreError> {
            unimplemented!("a blob is never written to a mutable key")
        }

        async fn get(&self, key: &str) -> Result<StoredObject, StoreError> {
            let objects = self.objects.lock().expect("the lock is not poisoned");
            let bytes = objects.get(key).ok_or(StoreError::NotFound)?.clone();

            Ok(StoredObject {
                meta: ObjectMeta {
                    etag: ETag::new("etag"),
                    content_sha256: None,
                },
                bytes,
            })
        }

        async fn get_if_none_match(
            &self,
            _key: &str,
            _known: &ETag,
        ) -> Result<ConditionalGet, StoreError> {
            unimplemented!("a blob is immutable, so it is never polled")
        }

        async fn head(&self, _key: &str) -> Result<ObjectMeta, StoreError> {
            unimplemented!("not part of the blob path")
        }

        async fn exists(&self, _key: &str) -> Result<bool, StoreError> {
            unimplemented!("not part of the blob path")
        }
    }

    struct FixedCapabilities(bool);

    impl CapabilitySource for FixedCapabilities {
        async fn capabilities(&self) -> AccountCapabilities {
            AccountCapabilities::from_cloud_entitlement(self.0)
        }
    }

    struct FixedState(Option<FrozenReason>);

    impl GateStateSource for FixedState {
        fn gate_state(&self) -> Result<GateState, AuthError> {
            Ok(GateState {
                pin: Some(AccountPin::new("us-east-1:abc", "sub-1")),
                frozen_reason: self.0,
            })
        }
    }

    type TestGate = SyncGate<DatasetKind, FixedCapabilities, FixedState>;

    fn gated(
        store: MemoryStore,
        kind: DatasetKind,
        entitled: bool,
        frozen: Option<FrozenReason>,
    ) -> GatedStore<MemoryStore, TestGate> {
        GatedStore::new(
            store,
            SyncGate::new(kind, FixedCapabilities(entitled), FixedState(frozen)),
        )
    }

    fn syncing(store: MemoryStore) -> GatedStore<MemoryStore, TestGate> {
        gated(store, DatasetKind::CloudLinked, true, None)
    }

    /// Deterministic bytes of a realistic size, so the round trip is not proven on three bytes.
    fn image_bytes(seed: u8, len: usize) -> Vec<u8> {
        let mut state = u64::from(seed).wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
        (0..len)
            .map(|_| {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                (state >> 33) as u8
            })
            .collect()
    }

    #[test]
    fn a_blob_key_is_the_hash_under_the_blob_prefix() {
        let hex = sha256_hex(b"picture");

        assert_eq!(blob_key(&hex).expect("a digest is a key"), format!("blob/{hex}"));
    }

    /// The db layer and the transport must agree on what an image's identity IS, or a row would
    /// name a key nothing was ever uploaded to.
    #[test]
    fn the_stored_hash_and_the_uploaded_key_are_the_same_digest() {
        let bytes = image_bytes(3, 4096);
        let (_, hex) = identity(&bytes);

        assert_eq!(hex, sha256_hex(&bytes));
    }

    #[test]
    fn anything_that_is_not_a_sha256_digest_is_not_a_key() {
        for refused in [
            "",
            "abc",
            &"a".repeat(63),
            &"a".repeat(65),
            &"A".repeat(64),
            &format!("{}/", "a".repeat(63)),
            &format!("{}z", "a".repeat(63)),
        ] {
            assert_eq!(blob_key(refused), Err(BlobError::InvalidHash), "{refused:?}");
        }
    }

    #[tokio::test]
    async fn an_upload_round_trips_the_exact_bytes_and_dedups_the_second_one() {
        let bytes = image_bytes(1, 3_500_000);
        let store = syncing(MemoryStore::default());

        let (hex, first) = put_image_blob(&store, 30, &bytes)
            .await
            .expect("the upload succeeds");
        assert_eq!(first, BlobUpload::Created);
        assert_eq!(hex, sha256_hex(&bytes));

        let (again, second) = put_image_blob(&store, 30, &bytes)
            .await
            .expect("the retry succeeds");
        assert_eq!((again, second), (hex.clone(), BlobUpload::AlreadyDeduplicated));

        let fetched = fetch_image_blob(&store, &hex).await.expect("the fetch succeeds");
        assert_eq!(fetched, bytes, "the payload must survive byte for byte");
    }

    /// The payload is framed by the AD-8 header, which is what makes the object self-describing.
    #[tokio::test]
    async fn the_uploaded_object_carries_the_header_and_then_the_image() {
        let bytes = image_bytes(2, 1024);
        let store = syncing(MemoryStore::default());

        let (hex, _) = put_image_blob(&store, 30, &bytes)
            .await
            .expect("the upload succeeds");

        let stored = store.get(&blob_key(&hex).unwrap()).await.expect("the object is there");
        assert_eq!(stored.bytes.len(), OBJECT_HEADER_LEN + bytes.len());
        let (header, payload) = ObjectHeader::parse(&stored.bytes).expect("the header parses");
        assert_eq!(header.schema_version, 30);
        assert_eq!(payload, bytes.as_slice());
    }

    #[tokio::test]
    async fn a_payload_that_does_not_hash_to_its_key_is_refused_rather_than_returned() {
        let honest = image_bytes(4, 2048);
        let tampered = image_bytes(5, 2048);
        let hex = sha256_hex(&honest);
        let (_, tampered_hex) = identity(&tampered);

        let store = MemoryStore::default();
        // The header still claims the honest digest, which is exactly the shape a mirror that
        // served the wrong body would produce.
        let (honest_digest, _) = identity(&honest);
        store.insert(
            &blob_key(&hex).unwrap(),
            ObjectHeader::new(30, honest_digest).frame(&tampered),
        );
        let store = syncing(store);

        assert_eq!(
            fetch_image_blob(&store, &hex).await,
            Err(BlobError::ContentMismatch {
                expected: hex,
                found: tampered_hex,
            })
        );
    }

    #[tokio::test]
    async fn an_object_without_the_header_is_refused() {
        let bytes = image_bytes(6, 512);
        let hex = sha256_hex(&bytes);

        let store = MemoryStore::default();
        store.insert(&blob_key(&hex).unwrap(), bytes);
        let store = syncing(store);

        assert!(matches!(
            fetch_image_blob(&store, &hex).await,
            Err(BlobError::Header(_))
        ));
    }

    /// AD-14 and inherited AD-12: a blocked dataset transfers nothing. An empty store proves the
    /// refusal came from the gate and not from the transport — a `NotFound` would be a different
    /// error, and the upload would have created the object if it had been allowed through.
    #[tokio::test]
    async fn a_blocked_dataset_transfers_no_blob_at_all() {
        let bytes = image_bytes(7, 1024);
        let hex = sha256_hex(&bytes);

        for (kind, entitled, frozen, expected) in [
            (
                DatasetKind::Local,
                true,
                None,
                SyncBlocked::LocalOnlyDataset,
            ),
            (
                DatasetKind::CloudLinked,
                false,
                None,
                SyncBlocked::CapabilityMissing {
                    capability: crate::entitlements::MULTI_DEVICE_SYNC,
                },
            ),
            (
                DatasetKind::CloudLinked,
                true,
                Some(FrozenReason::EntitlementLapsed),
                SyncBlocked::Frozen {
                    reason: FrozenReason::EntitlementLapsed,
                },
            ),
        ] {
            let store = gated(MemoryStore::default(), kind, entitled, frozen);

            assert_eq!(
                put_image_blob(&store, 30, &bytes).await,
                Err(BlobError::Store(GatedError::Blocked(expected)))
            );
            assert_eq!(
                fetch_image_blob(&store, &hex).await,
                Err(BlobError::Store(GatedError::Blocked(expected)))
            );
        }
    }
}
