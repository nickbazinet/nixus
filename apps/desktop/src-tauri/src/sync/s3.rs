//! The S3 adapter for the `ObjectStore` port, and the **only** file in this crate
//! that names the S3 SDK (`sync/tests_port_boundary.rs` fails the build if that
//! stops being true). Everything above it sees the port's outcome vocabulary.
//!
//! Two things make this adapter more than a thin wrapper.
//!
//! **412 is not one answer.** AD-6 writes immutable objects create-only, so an
//! existing key may mean "this exact upload already landed" (a retry, a success) or
//! "another install minted the same id" (a collision that must relink). Telling them
//! apart needs the stored content hash, which is why every immutable put carries it.
//!
//! **403 is not always denial.** The authenticated role's `s3:ListBucket` is
//! conditioned on `s3:prefix` (AD-7), and S3 answers 403 `AccessDenied` instead of
//! 404 for a GET or HEAD on a *missing* key whenever the caller has no ListBucket
//! permission in that request's context. A sync client that read 403 as "forbidden"
//! would report an error on the single most ordinary event in the protocol — polling
//! a key that does not exist yet. So a 403 is disambiguated with one one-key listing.

use std::collections::HashMap;

use aws_sdk_s3::config::http::HttpResponse;
use aws_sdk_s3::error::{ProvideErrorMetadata, SdkError};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::ChecksumMode;
use aws_sdk_s3::Client;
use base64::Engine;
use sha2::{Digest, Sha256};

use super::store::{
    validate_relative_key, ConditionalGet, ETag, ImmutablePut, MalformedObject, ObjectMeta,
    ObjectStore, StoreError, StoreOp, StoredObject,
};

/// User metadata key (sent as `x-amz-meta-content-sha256`) holding the lowercase hex
/// sha256 of the object's bytes, per AD-6. User metadata is returned by every HEAD
/// without an extra request parameter, which is why it — and not the native checksum
/// — is the primary source for the 412 comparison.
const CONTENT_SHA256_METADATA_KEY: &str = "content-sha256";

/// Service error codes that mean "the vended credentials are no longer valid". These
/// must never be mistaken for absence: they arrive as 4xx on keys that may well exist.
const EXPIRED_CREDENTIAL_CODES: [&str; 4] = [
    "ExpiredToken",
    "ExpiredTokenException",
    "RequestExpired",
    "TokenRefreshRequired",
];

/// Codes that are worth retrying with the identical request.
const RETRYABLE_CODES: [&str; 7] = [
    "SlowDown",
    "RequestTimeout",
    "Throttling",
    "ThrottlingException",
    "RequestThrottled",
    "InternalError",
    "ServiceUnavailable",
];

pub struct S3ObjectStore {
    client: Client,
    bucket: String,
    account_prefix: String,
}

impl S3ObjectStore {
    /// Scoped to `crate::sync` so an un-gated store cannot be constructed anywhere else:
    /// `gate::GatedStore` is the only way to reach these operations, and
    /// `tests_gate_boundary.rs` fails the build if this widens (AD-14).
    pub(in crate::sync) fn new(
        client: Client,
        bucket: impl Into<String>,
        identity_id: &str,
    ) -> Self {
        Self {
            client,
            bucket: bucket.into(),
            account_prefix: format!("acct/{identity_id}/"),
        }
    }

    fn absolute(&self, key: &str) -> Result<String, StoreError> {
        validate_relative_key(key)?;
        Ok(format!("{}{key}", self.account_prefix))
    }

    /// Resolve a fault that may be ambiguous. Only `AccessDenied` pays for the extra
    /// listing request; the 200, 304, 404, 409 and 412 paths never reach a probe.
    async fn resolve(&self, operation: StoreOp, absolute_key: &str, fault: Fault) -> StoreError {
        match fault {
            Fault::AccessDenied => match self.exact_key_exists(absolute_key).await {
                Ok(true) => StoreError::Forbidden,
                Ok(false) => StoreError::NotFound,
                Err(probe_failure) => probe_failure,
            },
            other => other.into_unambiguous(operation),
        }
    }

    /// `ListObjectsV2(prefix = <full key>, max-keys = 1)`, compared on the exact key:
    /// a prefix match alone would let `log/a/1` be "proven" to exist by `log/a/10`.
    async fn exact_key_exists(&self, absolute_key: &str) -> Result<bool, StoreError> {
        let listed = self
            .client
            .list_objects_v2()
            .bucket(&self.bucket)
            .prefix(absolute_key)
            .max_keys(1)
            .send()
            .await;

        match listed {
            Ok(output) => Ok(output
                .contents()
                .iter()
                .any(|object| object.key() == Some(absolute_key))),
            // A denied probe is the one case that is genuinely forbidden: the caller
            // cannot even ask about its own prefix.
            Err(error) => Err(match classify(&error) {
                Fault::AccessDenied => StoreError::Forbidden,
                other => other.into_unambiguous(StoreOp::List),
            }),
        }
    }

    async fn stored_object(
        &self,
        meta: ObjectMeta,
        body: ByteStream,
    ) -> Result<StoredObject, StoreError> {
        let bytes = body
            .collect()
            .await
            .map_err(|_| StoreError::Transport {
                operation: StoreOp::Get,
                status: None,
                code: None,
                // A body that stops mid-stream is a transport fault, and the whole
                // object is re-fetched rather than applied half-read.
                retryable: true,
            })?
            .to_vec();
        Ok(StoredObject { meta, bytes })
    }
}

impl ObjectStore for S3ObjectStore {
    fn account_prefix(&self) -> &str {
        &self.account_prefix
    }

    async fn put_immutable(&self, key: &str, body: Vec<u8>) -> Result<ImmutablePut, StoreError> {
        let absolute = self.absolute(key)?;
        let digest = Sha256::digest(&body);
        let hex = hex_lower(&digest);

        let written = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(&absolute)
            .if_none_match("*")
            .metadata(CONTENT_SHA256_METADATA_KEY, &hex)
            // The native checksum makes S3 itself reject a corrupted upload, so the
            // metadata hash can never describe bytes that did not arrive intact.
            .checksum_sha256(base64::engine::general_purpose::STANDARD.encode(digest))
            .body(ByteStream::from(body))
            .send()
            .await;

        match written {
            Ok(output) => Ok(ImmutablePut::Created {
                etag: require_etag(&absolute, output.e_tag())?,
            }),
            Err(error) => match classify(&error) {
                Fault::PreconditionFailed => {
                    let existing = match self.head(key).await {
                        Ok(existing) => existing,
                        // The key existed for the put and was gone by the HEAD, so
                        // the create-only write can simply be attempted again. The
                        // caller must never see a PUT answered with "not found".
                        Err(StoreError::NotFound) => return Err(StoreError::ConditionalConflict),
                        Err(other) => return Err(other),
                    };
                    match &existing.content_sha256 {
                        Some(stored) if stored.eq_ignore_ascii_case(&hex) => {
                            Ok(ImmutablePut::AlreadyStored {
                                etag: existing.etag,
                            })
                        }
                        Some(_) => Err(StoreError::ContentHashMismatch),
                        // Without a stored hash the key cannot be proven identical,
                        // and guessing "success" would silently drop this upload.
                        None => Err(StoreError::MalformedObject {
                            key: absolute,
                            reason: MalformedObject::MissingContentHash,
                        }),
                    }
                }
                other => Err(other.into_unambiguous(StoreOp::PutImmutable)),
            },
        }
    }

    async fn put_if_absent(&self, key: &str, body: Vec<u8>) -> Result<ETag, StoreError> {
        let absolute = self.absolute(key)?;
        let written = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(&absolute)
            .if_none_match("*")
            .body(ByteStream::from(body))
            .send()
            .await;

        match written {
            Ok(output) => require_etag(&absolute, output.e_tag()),
            Err(error) => Err(classify(&error).into_unambiguous(StoreOp::PutIfAbsent)),
        }
    }

    async fn put_if_match(
        &self,
        key: &str,
        expected: &ETag,
        body: Vec<u8>,
    ) -> Result<ETag, StoreError> {
        let absolute = self.absolute(key)?;
        let written = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(&absolute)
            .if_match(expected.as_str())
            .body(ByteStream::from(body))
            .send()
            .await;

        match written {
            Ok(output) => require_etag(&absolute, output.e_tag()),
            Err(error) => Err(classify(&error).into_unambiguous(StoreOp::PutIfMatch)),
        }
    }

    async fn get(&self, key: &str) -> Result<StoredObject, StoreError> {
        let absolute = self.absolute(key)?;
        let fetched = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(&absolute)
            .checksum_mode(ChecksumMode::Enabled)
            .send()
            .await;

        match fetched {
            Ok(output) => {
                let meta = object_meta(
                    &absolute,
                    output.e_tag(),
                    output.metadata(),
                    output.checksum_sha256(),
                )?;
                self.stored_object(meta, output.body).await
            }
            Err(error) => Err(self.resolve(StoreOp::Get, &absolute, classify(&error)).await),
        }
    }

    async fn get_if_none_match(
        &self,
        key: &str,
        known: &ETag,
    ) -> Result<ConditionalGet, StoreError> {
        let absolute = self.absolute(key)?;
        let fetched = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(&absolute)
            .if_none_match(known.as_str())
            .checksum_mode(ChecksumMode::Enabled)
            .send()
            .await;

        match fetched {
            Ok(output) => {
                let meta = object_meta(
                    &absolute,
                    output.e_tag(),
                    output.metadata(),
                    output.checksum_sha256(),
                )?;
                Ok(ConditionalGet::Modified(
                    self.stored_object(meta, output.body).await?,
                ))
            }
            Err(error) => match classify(&error) {
                Fault::NotModified => Ok(ConditionalGet::NotModified),
                other => Err(self.resolve(StoreOp::Get, &absolute, other).await),
            },
        }
    }

    async fn head(&self, key: &str) -> Result<ObjectMeta, StoreError> {
        let absolute = self.absolute(key)?;
        let described = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(&absolute)
            .checksum_mode(ChecksumMode::Enabled)
            .send()
            .await;

        match described {
            Ok(output) => object_meta(
                &absolute,
                output.e_tag(),
                output.metadata(),
                output.checksum_sha256(),
            ),
            Err(error) => {
                Err(self
                    .resolve(StoreOp::Head, &absolute, classify(&error))
                    .await)
            }
        }
    }

    async fn exists(&self, key: &str) -> Result<bool, StoreError> {
        let absolute = self.absolute(key)?;
        self.exact_key_exists(&absolute).await
    }
}

fn require_etag(absolute_key: &str, etag: Option<&str>) -> Result<ETag, StoreError> {
    etag.map(ETag::new)
        .ok_or_else(|| StoreError::MalformedObject {
            key: absolute_key.to_string(),
            reason: MalformedObject::MissingETag,
        })
}

fn object_meta(
    absolute_key: &str,
    etag: Option<&str>,
    metadata: Option<&HashMap<String, String>>,
    checksum_sha256: Option<&str>,
) -> Result<ObjectMeta, StoreError> {
    let from_metadata = metadata.and_then(|entries| entries.get(CONTENT_SHA256_METADATA_KEY));

    let content_sha256 = match from_metadata {
        Some(hex) => Some(hex.to_ascii_lowercase()),
        // Objects written before the metadata convention, or by a tool that only set
        // the native checksum, can still prove their identity.
        None => match checksum_sha256 {
            Some(encoded) => Some(
                base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map(|raw| hex_lower(&raw))
                    .map_err(|_| StoreError::MalformedObject {
                        key: absolute_key.to_string(),
                        reason: MalformedObject::UndecodableContentHash,
                    })?,
            ),
            None => None,
        },
    };

    Ok(ObjectMeta {
        etag: require_etag(absolute_key, etag)?,
        content_sha256,
    })
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        hex.push(char::from_digit((byte >> 4) as u32, 16).expect("a nibble is a hex digit"));
        hex.push(char::from_digit((byte & 0x0f) as u32, 16).expect("a nibble is a hex digit"));
    }
    hex
}

/// What the wire said, before any knowledge of which operation asked. `AccessDenied`
/// is kept separate from `Forbidden` precisely because it is the ambiguous one.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Fault {
    NotFound,
    NotModified,
    PreconditionFailed,
    ConditionalConflict,
    AccessDenied,
    Forbidden,
    CredentialsExpired,
    Transport {
        status: Option<u16>,
        code: Option<String>,
        retryable: bool,
    },
}

impl Fault {
    fn into_unambiguous(self, operation: StoreOp) -> StoreError {
        match self {
            Fault::NotFound => StoreError::NotFound,
            Fault::PreconditionFailed => StoreError::PreconditionFailed,
            Fault::ConditionalConflict => StoreError::ConditionalConflict,
            Fault::AccessDenied | Fault::Forbidden => StoreError::Forbidden,
            Fault::CredentialsExpired => StoreError::CredentialsExpired,
            // 304 only has a meaning for a conditional GET, which intercepts it
            // before this point; anywhere else it is an unexpected answer.
            Fault::NotModified => StoreError::Transport {
                operation,
                status: Some(304),
                code: None,
                retryable: false,
            },
            Fault::Transport {
                status,
                code,
                retryable,
            } => StoreError::Transport {
                operation,
                status,
                code,
                retryable,
            },
        }
    }
}

fn classify<E>(error: &SdkError<E, HttpResponse>) -> Fault
where
    E: ProvideErrorMetadata,
{
    let status = error.raw_response().map(|response| response.status().as_u16());
    let code = error.code().map(str::to_string);

    // Checked first and unconditionally: an expired token is a 4xx that would
    // otherwise be read as denial and then, after the listing probe, as absence.
    if code
        .as_deref()
        .is_some_and(|code| EXPIRED_CREDENTIAL_CODES.contains(&code))
    {
        return Fault::CredentialsExpired;
    }

    match status {
        Some(304) => return Fault::NotModified,
        Some(404) => return Fault::NotFound,
        Some(409) => return Fault::ConditionalConflict,
        Some(412) => return Fault::PreconditionFailed,
        Some(403) => {
            return if code.as_deref() == Some("AccessDenied") {
                Fault::AccessDenied
            } else {
                // Signature and key-id faults are 403 too, and no listing can turn
                // them into absence.
                Fault::Forbidden
            };
        }
        _ => {}
    }

    // Reached when the SDK failed before or without a response (construction,
    // dispatch, timeout) and the service error code is the only signal.
    match code.as_deref() {
        Some("NoSuchKey" | "NotFound") => return Fault::NotFound,
        Some("PreconditionFailed") => return Fault::PreconditionFailed,
        Some("ConditionalRequestConflict") => return Fault::ConditionalConflict,
        Some("AccessDenied") => return Fault::AccessDenied,
        _ => {}
    }

    Fault::Transport {
        retryable: is_retryable(error, status, code.as_deref()),
        status,
        code,
    }
}

fn is_retryable<E>(
    error: &SdkError<E, HttpResponse>,
    status: Option<u16>,
    code: Option<&str>,
) -> bool {
    if matches!(
        error,
        SdkError::TimeoutError(_) | SdkError::DispatchFailure(_)
    ) {
        return true;
    }
    if status.is_some_and(|status| status >= 500) {
        return true;
    }
    code.is_some_and(|code| RETRYABLE_CODES.contains(&code))
}

/// Connection settings for an arbitrary S3-compatible endpoint. Test-only, and it
/// lives here so `tests_s3_endpoint.rs` can build a real client without naming the
/// SDK and breaking the single-adapter-file guard.
#[cfg(test)]
pub(crate) struct EndpointSettings {
    pub endpoint_url: String,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub bucket: String,
    pub identity_id: String,
}

#[cfg(test)]
impl S3ObjectStore {
    pub(crate) fn for_endpoint(settings: &EndpointSettings) -> Self {
        let config = aws_sdk_s3::Config::builder()
            .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
            .region(aws_sdk_s3::config::Region::new(settings.region.clone()))
            .endpoint_url(&settings.endpoint_url)
            // S3-compatible servers are almost never reachable as virtual-hosted
            // subdomains of a bare host:port.
            .force_path_style(true)
            .credentials_provider(aws_sdk_s3::config::Credentials::new(
                &settings.access_key_id,
                &settings.secret_access_key,
                None,
                None,
                "nixus-sync-endpoint-test",
            ))
            .build();
        Self::new(
            Client::from_conf(config),
            settings.bucket.clone(),
            &settings.identity_id,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aws_sdk_s3::operation::get_object::GetObjectOutput;
    use aws_sdk_s3::operation::head_object::HeadObjectOutput;
    use aws_sdk_s3::operation::list_objects_v2::ListObjectsV2Output;
    use aws_sdk_s3::operation::put_object::PutObjectOutput;
    use aws_sdk_s3::primitives::SdkBody;
    use aws_smithy_mocks::{mock, Rule, RuleMode};
    use aws_smithy_runtime_api::http::StatusCode;

    const IDENTITY: &str = "us-east-1:11111111-2222-3333-4444-555555555555";
    const BUCKET: &str = "nixus-sync-test-bucket";

    fn store(rules: Vec<&Rule>) -> S3ObjectStore {
        let mut interceptor =
            aws_smithy_mocks::MockResponseInterceptor::new().rule_mode(RuleMode::MatchAny);
        for rule in rules {
            interceptor = interceptor.with_rule(rule);
        }
        let config = aws_sdk_s3::Config::builder()
            .with_test_defaults()
            .region(aws_sdk_s3::config::Region::new("us-east-1"))
            // Load-bearing, and the reason these tests are trustworthy at all: the
            // interceptor alone stubs responses but leaves the real connector in
            // place, so an unmatched request would reach the live S3 endpoint.
            .http_client(aws_smithy_mocks::create_mock_http_client())
            .interceptor(interceptor)
            .build();
        S3ObjectStore::new(Client::from_conf(config), BUCKET, IDENTITY)
    }

    fn error_xml(code: &str) -> String {
        format!(
            "<?xml version=\"1.0\"?><Error><Code>{code}</Code><Message>mocked</Message></Error>"
        )
    }

    fn fault_with_code(status: u16, code: &'static str) -> impl Fn() -> HttpResponse {
        move || {
            HttpResponse::new(
                StatusCode::try_from(status).expect("a valid HTTP status"),
                SdkBody::from(error_xml(code)),
            )
        }
    }

    #[test]
    fn the_account_prefix_is_the_only_addressable_space() {
        let adapter = store(vec![]);
        assert_eq!(adapter.account_prefix(), format!("acct/{IDENTITY}/"));
        assert_eq!(
            adapter.absolute("log/aabb/000001").expect("a valid key"),
            format!("acct/{IDENTITY}/log/aabb/000001")
        );
        assert!(adapter.absolute("../other/roster").is_err());
    }

    #[tokio::test]
    async fn a_created_immutable_object_reports_created_and_carries_its_hash() {
        let put = mock!(Client::put_object)
            .match_requests(|request| {
                request.if_none_match() == Some("*")
                    && request
                        .metadata()
                        .and_then(|meta| meta.get(CONTENT_SHA256_METADATA_KEY))
                        .is_some()
            })
            .then_output(|| PutObjectOutput::builder().e_tag("\"etag-1\"").build());

        let outcome = store(vec![&put])
            .put_immutable("log/aabb/000001", b"payload".to_vec())
            .await
            .expect("the create-only put succeeds");

        assert_eq!(
            outcome,
            ImmutablePut::Created {
                etag: ETag::new("\"etag-1\"")
            }
        );
    }

    #[tokio::test]
    async fn a_412_on_an_immutable_put_is_success_when_the_stored_hash_matches() {
        let body = b"payload".to_vec();
        let stored_hex = hex_lower(&Sha256::digest(&body));

        let put = mock!(Client::put_object).then_http_response(fault_with_code(412, "PreconditionFailed"));
        let head = mock!(Client::head_object).then_output(move || {
            HeadObjectOutput::builder()
                .e_tag("\"etag-existing\"")
                .metadata(CONTENT_SHA256_METADATA_KEY, stored_hex.clone())
                .build()
        });

        let outcome = store(vec![&put, &head])
            .put_immutable("log/aabb/000001", body)
            .await
            .expect("an identical object already stored is a success");

        assert_eq!(
            outcome,
            ImmutablePut::AlreadyStored {
                etag: ETag::new("\"etag-existing\"")
            }
        );
    }

    #[tokio::test]
    async fn a_412_on_an_immutable_put_is_a_collision_when_the_stored_hash_differs() {
        let put = mock!(Client::put_object).then_http_response(fault_with_code(412, "PreconditionFailed"));
        let head = mock!(Client::head_object).then_output(|| {
            HeadObjectOutput::builder()
                .e_tag("\"etag-existing\"")
                .metadata(CONTENT_SHA256_METADATA_KEY, hex_lower(&Sha256::digest(b"other bytes")))
                .build()
        });

        let failure = store(vec![&put, &head])
            .put_immutable("log/aabb/000001", b"payload".to_vec())
            .await
            .expect_err("a differing hash is an install-id collision");

        assert_eq!(failure, StoreError::ContentHashMismatch);
    }

    #[tokio::test]
    async fn a_412_on_an_immutable_put_without_a_stored_hash_is_never_a_silent_success() {
        let put = mock!(Client::put_object).then_http_response(fault_with_code(412, "PreconditionFailed"));
        let head = mock!(Client::head_object)
            .then_output(|| HeadObjectOutput::builder().e_tag("\"etag-existing\"").build());

        let failure = store(vec![&put, &head])
            .put_immutable("log/aabb/000001", b"payload".to_vec())
            .await
            .expect_err("an unprovable key cannot be reported as stored");

        assert!(matches!(
            failure,
            StoreError::MalformedObject {
                reason: MalformedObject::MissingContentHash,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn a_key_that_vanishes_between_the_412_and_the_head_is_a_retryable_conflict() {
        let put =
            mock!(Client::put_object).then_http_response(fault_with_code(412, "PreconditionFailed"));
        let head = mock!(Client::head_object).then_http_response(fault_with_code(404, "NotFound"));
        let list =
            mock!(Client::list_objects_v2).then_output(|| ListObjectsV2Output::builder().build());

        let failure = store(vec![&put, &head, &list])
            .put_immutable("log/aabb/000001", b"payload".to_vec())
            .await
            .expect_err("the key moved under the put");

        assert_eq!(failure, StoreError::ConditionalConflict);
        assert!(
            failure.retryable(),
            "a vanished key means the create-only put can simply be retried"
        );
    }

    #[tokio::test]
    async fn a_412_on_a_mutable_put_stays_a_precondition_failure() {
        let put = mock!(Client::put_object).then_http_response(fault_with_code(412, "PreconditionFailed"));
        let adapter = store(vec![&put]);

        assert_eq!(
            adapter
                .put_if_match("roster", &ETag::new("\"stale\""), b"roster".to_vec())
                .await
                .expect_err("a lost compare-and-swap"),
            StoreError::PreconditionFailed
        );
        assert_eq!(
            adapter
                .put_if_absent("owner", b"sub".to_vec())
                .await
                .expect_err("owner already minted"),
            StoreError::PreconditionFailed
        );
    }

    #[tokio::test]
    async fn a_409_is_a_retryable_conditional_conflict() {
        let put = mock!(Client::put_object)
            .then_http_response(fault_with_code(409, "ConditionalRequestConflict"));

        let failure = store(vec![&put])
            .put_if_match("roster", &ETag::new("\"current\""), b"roster".to_vec())
            .await
            .expect_err("a concurrent writer");

        assert_eq!(failure, StoreError::ConditionalConflict);
        assert!(failure.retryable());
    }

    #[tokio::test]
    async fn a_304_on_a_conditional_get_is_not_modified_and_costs_no_probe() {
        let get = mock!(Client::get_object).then_http_response(|| {
            HttpResponse::new(
                StatusCode::try_from(304).expect("a valid HTTP status"),
                SdkBody::empty(),
            )
        });
        let list =
            mock!(Client::list_objects_v2).then_output(|| ListObjectsV2Output::builder().build());

        let outcome = store(vec![&get, &list])
            .get_if_none_match("roster", &ETag::new("\"known\""))
            .await
            .expect("an unchanged key is a success");

        assert_eq!(outcome, ConditionalGet::NotModified);
        assert_eq!(list.num_calls(), 0, "304 must stay off the probe path");
    }

    #[tokio::test]
    async fn a_200_on_a_conditional_get_returns_the_bytes_and_costs_no_probe() {
        let stored_hex = hex_lower(&Sha256::digest(b"roster bytes"));
        let expected_hex = stored_hex.clone();
        let get = mock!(Client::get_object).then_output(move || {
            GetObjectOutput::builder()
                .e_tag("\"etag-2\"")
                .metadata(CONTENT_SHA256_METADATA_KEY, stored_hex.clone())
                .body(ByteStream::from_static(b"roster bytes"))
                .build()
        });
        let list = mock!(Client::list_objects_v2)
            .then_output(|| ListObjectsV2Output::builder().build());

        let outcome = store(vec![&get, &list])
            .get_if_none_match("roster", &ETag::new("\"known\""))
            .await
            .expect("a changed key is returned");

        assert_eq!(
            outcome,
            ConditionalGet::Modified(StoredObject {
                meta: ObjectMeta {
                    etag: ETag::new("\"etag-2\""),
                    content_sha256: Some(expected_hex),
                },
                bytes: b"roster bytes".to_vec(),
            })
        );
        assert_eq!(list.num_calls(), 0, "200 must stay off the probe path");
    }

    #[tokio::test]
    async fn a_404_is_not_found_without_a_probe() {
        let get = mock!(Client::get_object).then_http_response(fault_with_code(404, "NoSuchKey"));
        let list = mock!(Client::list_objects_v2)
            .then_output(|| ListObjectsV2Output::builder().build());

        let failure = store(vec![&get, &list])
            .get("snap/LATEST")
            .await
            .expect_err("an absent key");

        assert_eq!(failure, StoreError::NotFound);
        assert_eq!(list.num_calls(), 0, "404 is already unambiguous");
    }

    #[tokio::test]
    async fn a_403_on_a_missing_key_is_disambiguated_into_not_found() {
        let get = mock!(Client::get_object).then_http_response(fault_with_code(403, "AccessDenied"));
        let list = mock!(Client::list_objects_v2)
            .then_output(|| ListObjectsV2Output::builder().build());

        let failure = store(vec![&get, &list])
            .get("head/aabb")
            .await
            .expect_err("the key is absent, not forbidden");

        assert_eq!(failure, StoreError::NotFound);
        assert_eq!(list.num_calls(), 1, "the probe is what proves absence");
    }

    #[tokio::test]
    async fn a_403_on_an_existing_key_stays_forbidden() {
        let get = mock!(Client::get_object).then_http_response(fault_with_code(403, "AccessDenied"));
        let list = mock!(Client::list_objects_v2).then_output(|| {
            ListObjectsV2Output::builder()
                .contents(
                    aws_sdk_s3::types::Object::builder()
                        .key(format!("acct/{IDENTITY}/head/aabb"))
                        .build(),
                )
                .build()
        });

        let failure = store(vec![&get, &list])
            .get("head/aabb")
            .await
            .expect_err("the key exists and the caller may not read it");

        assert_eq!(failure, StoreError::Forbidden);
    }

    #[tokio::test]
    async fn a_probe_that_only_matches_a_longer_key_still_reports_absence() {
        let head = mock!(Client::head_object).then_http_response(fault_with_code(403, "AccessDenied"));
        let list = mock!(Client::list_objects_v2).then_output(|| {
            ListObjectsV2Output::builder()
                .contents(
                    aws_sdk_s3::types::Object::builder()
                        .key(format!("acct/{IDENTITY}/log/aabb/0000010"))
                        .build(),
                )
                .build()
        });

        let failure = store(vec![&head, &list])
            .head("log/aabb/000001")
            .await
            .expect_err("a prefix neighbour does not prove existence");

        assert_eq!(failure, StoreError::NotFound);
    }

    #[tokio::test]
    async fn a_denied_probe_is_forbidden_rather_than_absence() {
        let get = mock!(Client::get_object).then_http_response(fault_with_code(403, "AccessDenied"));
        let list = mock!(Client::list_objects_v2).then_http_response(fault_with_code(403, "AccessDenied"));

        let failure = store(vec![&get, &list])
            .get("head/aabb")
            .await
            .expect_err("a caller who cannot even list cannot claim absence");

        assert_eq!(failure, StoreError::Forbidden);
    }

    #[tokio::test]
    async fn expired_credentials_never_read_as_absence() {
        for code in EXPIRED_CREDENTIAL_CODES {
            let get = mock!(Client::get_object).then_http_response(fault_with_code(403, code));
            let list = mock!(Client::list_objects_v2)
                .then_output(|| ListObjectsV2Output::builder().build());

            let failure = store(vec![&get, &list])
                .get("head/aabb")
                .await
                .expect_err("an expired token is a failure");

            assert_eq!(failure, StoreError::CredentialsExpired, "code {code}");
            assert_eq!(
                list.num_calls(),
                0,
                "{code} must not be disambiguated as absence"
            );
        }
    }

    #[tokio::test]
    async fn an_unmapped_status_becomes_a_typed_transport_fault() {
        let get = mock!(Client::get_object).then_http_response(fault_with_code(400, "InvalidRequest"));

        let failure = store(vec![&get])
            .get("roster")
            .await
            .expect_err("a 400 is not an absence");

        match failure {
            StoreError::Transport {
                operation,
                status,
                code,
                retryable,
            } => {
                assert_eq!(operation, StoreOp::Get);
                assert_eq!(status, Some(400));
                assert_eq!(code.as_deref(), Some("InvalidRequest"));
                assert!(!retryable);
            }
            other => panic!("expected a transport fault, got {other:?}"),
        }
    }

    #[test]
    fn a_native_checksum_substitutes_for_missing_metadata() {
        let digest = Sha256::digest(b"payload");
        let encoded = base64::engine::general_purpose::STANDARD.encode(digest);

        let meta = object_meta("acct/x/log/a/1", Some("\"e\""), None, Some(&encoded))
            .expect("the native checksum is enough");

        assert_eq!(meta.content_sha256, Some(hex_lower(&digest)));
    }

    #[test]
    fn an_undecodable_checksum_is_reported_rather_than_ignored() {
        let failure = object_meta("acct/x/log/a/1", Some("\"e\""), None, Some("not base64 !!"))
            .expect_err("a checksum that cannot be decoded");

        assert!(matches!(
            failure,
            StoreError::MalformedObject {
                reason: MalformedObject::UndecodableContentHash,
                ..
            }
        ));
    }

    #[test]
    fn hex_encoding_is_lowercase_and_zero_padded() {
        assert_eq!(hex_lower(&[0x00, 0x0f, 0xa5, 0xff]), "000fa5ff");
    }
}

