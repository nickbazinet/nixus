//! The `ObjectStore` port: the vocabulary every sync transport must speak.
//!
//! The port exists because the object protocol (AD-6) is defined in terms of
//! conditional-write outcomes, not of S3: a caller must be able to tell "the key
//! already holds exactly these bytes" from "another install minted the same id",
//! and "absent" from "forbidden", without ever seeing an HTTP status. Keeping that
//! vocabulary here — rather than in `s3.rs` — is what lets the adapter stay the
//! single replaceable piece.
//!
//! Keys crossing this port are **relative to the account prefix** (`log/<install>/<seq>`,
//! `snap/LATEST`, `roster`). The adapter owns `acct/<identity-id>/` and joins, so no
//! caller can address another account's prefix and every key is inside the prefix the
//! vended credentials allow (AD-7).

use std::fmt;

/// An opaque S3 entity tag. Opaque on purpose: an ETag is a concurrency token for
/// `If-Match`, not a digest — multipart uploads and SSE-KMS both break that reading —
/// so object identity is carried by `content_sha256` instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ETag(String);

impl ETag {
    pub fn new(raw: impl Into<String>) -> Self {
        Self(raw.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ETag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Which port operation produced an error. Carried instead of a free-text message so
/// a fault can be counted and compared without ever formatting service prose into it
/// (AD-16: diagnostics are counts, states and codes, never values).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreOp {
    Get,
    Head,
    PutImmutable,
    PutIfAbsent,
    PutIfMatch,
    List,
}

impl fmt::Display for StoreOp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            StoreOp::Get => "get",
            StoreOp::Head => "head",
            StoreOp::PutImmutable => "put_immutable",
            StoreOp::PutIfAbsent => "put_if_absent",
            StoreOp::PutIfMatch => "put_if_match",
            StoreOp::List => "list",
        };
        f.write_str(name)
    }
}

/// Why a stored object could not be trusted to describe itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MalformedObject {
    /// The object carries no content hash, so an existing key cannot be proven to
    /// hold the bytes a create-only put just tried to write.
    MissingContentHash,
    /// A content hash is present but is not a decodable digest.
    UndecodableContentHash,
    /// The service answered a write without the entity tag the caller needs for the
    /// next compare-and-swap.
    MissingETag,
}

/// Why a relative key was refused before any request was made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidKey {
    Empty,
    /// A leading `/` would address the bucket root instead of the account prefix.
    Absolute,
    /// A `.` or `..` segment; S3 does not normalise these, but a proxy or an
    /// S3-compatible endpoint may, which would escape the account prefix.
    Traversal,
}

/// Every way an object-store operation can fail, as distinct outcomes rather than
/// strings. Story 10 maps these onto `AppError::Sync { code, message, recoverable }`
/// (AD-16); until then the port owns its own vocabulary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    /// The key does not exist. Also the answer when a 403 was proven to be absence
    /// rather than denial (see `s3.rs`).
    NotFound,
    /// A conditional write's precondition failed (HTTP 412): the mutable key moved
    /// under the caller, who must re-read and retry the compare-and-swap.
    PreconditionFailed,
    /// Two writers raced on the same conditional write (HTTP 409). Retryable as-is.
    ConditionalConflict,
    /// A create-only put hit an existing key whose stored content hash differs from
    /// the bytes being written. Per AD-6 this is an install-id collision, not a
    /// duplicate upload: the caller regenerates its install id and relinks.
    ContentHashMismatch,
    /// Denial proven by a listing probe, or an authentication fault that is not an
    /// expired token.
    Forbidden,
    /// The vended 1-hour credentials expired. Distinct from `Forbidden` because the
    /// cure is a refresh, and distinct from `NotFound` because an expired token is
    /// also a 4xx on a key that may well exist.
    CredentialsExpired,
    MalformedObject {
        key: String,
        reason: MalformedObject,
    },
    InvalidKey {
        reason: InvalidKey,
    },
    /// Anything else the service or the transport reported.
    Transport {
        operation: StoreOp,
        status: Option<u16>,
        code: Option<String>,
        retryable: bool,
    },
}

impl StoreError {
    /// Whether retrying the identical request can succeed. Deliberately not true for
    /// `PreconditionFailed`: that one needs a re-read first, which is a different
    /// request.
    pub fn retryable(&self) -> bool {
        match self {
            StoreError::ConditionalConflict => true,
            StoreError::Transport { retryable, .. } => *retryable,
            StoreError::NotFound
            | StoreError::PreconditionFailed
            | StoreError::ContentHashMismatch
            | StoreError::Forbidden
            | StoreError::CredentialsExpired
            | StoreError::MalformedObject { .. }
            | StoreError::InvalidKey { .. } => false,
        }
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::NotFound => f.write_str("object not found"),
            StoreError::PreconditionFailed => f.write_str("conditional write precondition failed"),
            StoreError::ConditionalConflict => f.write_str("conditional write conflict"),
            StoreError::ContentHashMismatch => {
                f.write_str("key exists with different content; install id collision")
            }
            StoreError::Forbidden => f.write_str("access to the object store was denied"),
            StoreError::CredentialsExpired => f.write_str("object store credentials expired"),
            StoreError::MalformedObject { key, reason } => {
                write!(f, "object {key} is malformed: {reason:?}")
            }
            StoreError::InvalidKey { reason } => write!(f, "invalid object key: {reason:?}"),
            StoreError::Transport {
                operation,
                status,
                code,
                ..
            } => write!(
                f,
                "object store {operation} failed (status {status:?}, code {code:?})"
            ),
        }
    }
}

impl std::error::Error for StoreError {}

/// What a stored object says about itself: the concurrency token and, when the writer
/// supplied one, the content hash AD-6 requires immutable objects to carry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectMeta {
    pub etag: ETag,
    pub content_sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredObject {
    pub meta: ObjectMeta,
    pub bytes: Vec<u8>,
}

/// The outcome of a conditional GET. `NotModified` is a success, not an error: it is
/// the normal answer when polling `roster` and `head/<install>`, and it is billed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConditionalGet {
    Modified(StoredObject),
    NotModified,
}

/// The outcome of a create-only put. `AlreadyStored` means the key was already there
/// holding byte-identical content, which makes the upload idempotent across retries;
/// a differing hash is `StoreError::ContentHashMismatch` instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImmutablePut {
    Created { etag: ETag },
    AlreadyStored { etag: ETag },
}

/// Refuse a relative key before it can be joined onto the account prefix.
pub fn validate_relative_key(key: &str) -> Result<(), StoreError> {
    if key.is_empty() {
        return Err(StoreError::InvalidKey {
            reason: InvalidKey::Empty,
        });
    }
    if key.starts_with('/') {
        return Err(StoreError::InvalidKey {
            reason: InvalidKey::Absolute,
        });
    }
    if key.split('/').any(|segment| segment == "." || segment == "..") {
        return Err(StoreError::InvalidKey {
            reason: InvalidKey::Traversal,
        });
    }
    Ok(())
}

/// The transport port. Implemented with `async fn` in trait, so it is used through a
/// type parameter rather than `dyn`: the adapter is chosen once when the sync manager
/// is constructed, and static dispatch keeps the port free of boxing ceremony.
pub trait ObjectStore {
    /// `acct/<identity-id>/` — the only prefix this store may address (AD-7).
    #[allow(dead_code)] // A diagnostic; Milestone 1 never needs to name the prefix.
    fn account_prefix(&self) -> &str;

    /// Create-only put for an immutable key (`If-None-Match: *`), carrying the bytes'
    /// sha256 as object metadata.
    async fn put_immutable(&self, key: &str, body: Vec<u8>) -> Result<ImmutablePut, StoreError>;

    /// First write of a mutable key (`If-None-Match: *`). Unlike `put_immutable` an
    /// existing key is a failure, never a success: `acct/<id>/owner` must be minted
    /// exactly once (AD-7).
    async fn put_if_absent(&self, key: &str, body: Vec<u8>) -> Result<ETag, StoreError>;

    /// Compare-and-swap a mutable key (`If-Match: <etag>`).
    async fn put_if_match(
        &self,
        key: &str,
        expected: &ETag,
        body: Vec<u8>,
    ) -> Result<ETag, StoreError>;

    async fn get(&self, key: &str) -> Result<StoredObject, StoreError>;

    /// Conditional GET (`If-None-Match: <etag>`).
    async fn get_if_none_match(
        &self,
        key: &str,
        known: &ETag,
    ) -> Result<ConditionalGet, StoreError>;

    async fn head(&self, key: &str) -> Result<ObjectMeta, StoreError>;

    /// Whether the exact key exists, answered by a one-key listing. This is AD-6's
    /// repair path and the disambiguation the prefix-conditioned `s3:ListBucket`
    /// grant forces on GET/HEAD (see `s3.rs`).
    async fn exists(&self, key: &str) -> Result<bool, StoreError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_relative_key_is_accepted() {
        assert!(validate_relative_key("log/0a1b2c3d/000001").is_ok());
        assert!(validate_relative_key("roster").is_ok());
        assert!(validate_relative_key("snap/LATEST").is_ok());
    }

    #[test]
    fn keys_that_could_escape_the_account_prefix_are_refused() {
        let refused = [
            ("", InvalidKey::Empty),
            ("/roster", InvalidKey::Absolute),
            ("../other/roster", InvalidKey::Traversal),
            ("log/../../roster", InvalidKey::Traversal),
            ("./roster", InvalidKey::Traversal),
        ];
        for (key, reason) in refused {
            assert_eq!(
                validate_relative_key(key),
                Err(StoreError::InvalidKey { reason }),
                "key {key:?} should be refused"
            );
        }
    }

    #[test]
    fn only_conflicts_and_flagged_transport_faults_are_retryable() {
        assert!(StoreError::ConditionalConflict.retryable());
        assert!(StoreError::Transport {
            operation: StoreOp::Get,
            status: Some(503),
            code: None,
            retryable: true,
        }
        .retryable());

        for not_retryable in [
            StoreError::NotFound,
            StoreError::PreconditionFailed,
            StoreError::ContentHashMismatch,
            StoreError::Forbidden,
            StoreError::CredentialsExpired,
        ] {
            assert!(
                !not_retryable.retryable(),
                "{not_retryable:?} must not invite a blind retry"
            );
        }
    }
}
