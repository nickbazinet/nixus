//! Behaviour tests for the S3 adapter against a **real S3-compatible endpoint**.
//!
//! The unit tests in `s3.rs` stub the SDK's responses, which proves the mapping but
//! not that any server actually behaves that way: `If-None-Match: *` and `If-Match`
//! are comparatively recent S3 features and S3-compatible servers differ on them.
//! Milestone 1's end-to-end proof needs a server, so these are the same scenarios
//! written against one, `#[ignore]`d so they never run in the normal suite and
//! parameterised entirely by environment so they can be pointed at MinIO, a
//! throwaway bucket, or the real thing without editing code.
//!
//! ```text
//! NIXUS_SYNC_TEST_ENDPOINT=http://127.0.0.1:9000 \
//! NIXUS_SYNC_TEST_BUCKET=nixus-sync-conformance \
//! NIXUS_SYNC_TEST_ACCESS_KEY_ID=... NIXUS_SYNC_TEST_SECRET_ACCESS_KEY=... \
//!   cargo test sync::tests_s3_endpoint -- --ignored --test-threads=1
//! ```
//!
//! Synthetic payloads only, under a key namespace of their own. Never point these at
//! a bucket holding real account data.

use super::s3::{EndpointSettings, S3ObjectStore};
use super::store::{ConditionalGet, ETag, ImmutablePut, ObjectStore, StoreError};

const ENDPOINT: &str = "NIXUS_SYNC_TEST_ENDPOINT";
const BUCKET: &str = "NIXUS_SYNC_TEST_BUCKET";
const ACCESS_KEY_ID: &str = "NIXUS_SYNC_TEST_ACCESS_KEY_ID";
const SECRET_ACCESS_KEY: &str = "NIXUS_SYNC_TEST_SECRET_ACCESS_KEY";
const REGION: &str = "NIXUS_SYNC_TEST_REGION";
const IDENTITY: &str = "NIXUS_SYNC_TEST_IDENTITY";
/// Create-only puts cannot be repeated on the same key, so a run needs its own key
/// namespace. Set it explicitly to re-run against the objects a previous run left.
const RUN_ID: &str = "NIXUS_SYNC_TEST_RUN_ID";

fn required(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| {
        panic!(
            "{name} is not set. These tests are #[ignore]d because they need an \
             S3-compatible endpoint; see the module docs for the full variable list."
        )
    })
}

fn endpoint() -> (S3ObjectStore, String) {
    let settings = EndpointSettings {
        endpoint_url: required(ENDPOINT),
        bucket: required(BUCKET),
        access_key_id: required(ACCESS_KEY_ID),
        secret_access_key: required(SECRET_ACCESS_KEY),
        region: std::env::var(REGION).unwrap_or_else(|_| "us-east-1".to_string()),
        identity_id: std::env::var(IDENTITY)
            .unwrap_or_else(|_| "us-east-1:00000000-0000-4000-8000-000000000000".to_string()),
    };
    let run_id = std::env::var(RUN_ID).unwrap_or_else(|_| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the clock is after 1970")
            .as_nanos()
            .to_string()
    });
    (
        S3ObjectStore::for_endpoint(&settings),
        format!("conformance/{run_id}"),
    )
}

#[tokio::test]
#[ignore = "needs an S3-compatible endpoint; see the module docs"]
async fn a_create_only_put_is_idempotent_for_identical_bytes_and_detects_a_collision() {
    let (store, namespace) = endpoint();
    let key = format!("{namespace}/log/aabb/000001");
    let payload = b"segment-bytes".to_vec();

    assert!(matches!(
        store
            .put_immutable(&key, payload.clone())
            .await
            .expect("the first create-only put lands"),
        ImmutablePut::Created { .. }
    ));

    assert!(
        matches!(
            store
                .put_immutable(&key, payload)
                .await
                .expect("a replayed upload of identical bytes is a success"),
            ImmutablePut::AlreadyStored { .. }
        ),
        "a retry of the same upload must not look like a collision"
    );

    assert_eq!(
        store
            .put_immutable(&key, b"different-bytes".to_vec())
            .await
            .expect_err("different bytes under the same key is an install-id collision"),
        StoreError::ContentHashMismatch
    );
}

#[tokio::test]
#[ignore = "needs an S3-compatible endpoint; see the module docs"]
async fn a_mutable_key_is_minted_once_and_then_moves_only_by_compare_and_swap() {
    let (store, namespace) = endpoint();
    let key = format!("{namespace}/roster");

    let first = store
        .put_if_absent(&key, b"install-a".to_vec())
        .await
        .expect("the first write mints the key");

    assert_eq!(
        store
            .put_if_absent(&key, b"install-b".to_vec())
            .await
            .expect_err("a second mint must fail"),
        StoreError::PreconditionFailed
    );

    let second = store
        .put_if_match(&key, &first, b"install-a,install-b".to_vec())
        .await
        .expect("a compare-and-swap against the current etag succeeds");

    assert_eq!(
        store
            .put_if_match(&key, &first, b"install-c".to_vec())
            .await
            .expect_err("a compare-and-swap against a stale etag must fail"),
        StoreError::PreconditionFailed
    );

    assert_eq!(
        store.get(&key).await.expect("the key is readable").bytes,
        b"install-a,install-b".to_vec()
    );
    assert_ne!(first, second, "a successful swap returns a new etag");
}

#[tokio::test]
#[ignore = "needs an S3-compatible endpoint; see the module docs"]
async fn a_conditional_get_reports_not_modified_until_the_key_moves() {
    let (store, namespace) = endpoint();
    let key = format!("{namespace}/head/aabb");

    let first = store
        .put_if_absent(&key, b"seq=1".to_vec())
        .await
        .expect("the head key is minted");

    assert_eq!(
        store
            .get_if_none_match(&key, &first)
            .await
            .expect("an unchanged key is a success"),
        ConditionalGet::NotModified
    );

    store
        .put_if_match(&key, &first, b"seq=2".to_vec())
        .await
        .expect("the head key advances");

    match store
        .get_if_none_match(&key, &first)
        .await
        .expect("a moved key returns its bytes")
    {
        ConditionalGet::Modified(object) => assert_eq!(object.bytes, b"seq=2".to_vec()),
        ConditionalGet::NotModified => panic!("the key moved; the stale etag must not match"),
    }
}

#[tokio::test]
#[ignore = "needs an S3-compatible endpoint; see the module docs"]
async fn an_absent_key_is_not_found_however_the_endpoint_phrases_it() {
    let (store, namespace) = endpoint();
    let key = format!("{namespace}/snap/LATEST");

    assert!(!store.exists(&key).await.expect("the probe is allowed"));

    for failure in [
        store.get(&key).await.err(),
        store.head(&key).await.err(),
        store
            .get_if_none_match(&key, &ETag::new("\"whatever\""))
            .await
            .err(),
        store
            .put_if_match(&key, &ETag::new("\"whatever\""), b"x".to_vec())
            .await
            .err(),
    ] {
        let failure = failure.expect("an absent key cannot be read or swapped");
        assert!(
            matches!(
                failure,
                StoreError::NotFound | StoreError::PreconditionFailed
            ),
            "an absent key must surface as NotFound (or PreconditionFailed for a \
             compare-and-swap), not as {failure:?}"
        );
    }
}
