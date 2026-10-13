# Story 4 — ObjectStore port and S3 adapter (implementation spec)

Serves CAP-1/CAP-2/CAP-9 through AD-6 (object protocol), AD-7 (prefix-scoped role), AD-8 (header/SSE).
Adds **no runtime behavior**: nothing is wired into app startup. Later stories consume it.

## Shape

`src/sync/` is created with the Structural Seed's exact module list. Only three files carry code in
this story; the rest are doc-comment placeholders naming the story that fills them.

- `store.rs` — the port: `ObjectStore` trait, `StoreError`, `ETag`, `StoredObject`, `ImmutablePut`,
  `ConditionalGet`. The error vocabulary lives with the port (ports-and-adapters), so the Seed needs
  no extra `error.rs` module.
- `s3.rs` — the only file in the crate that names `aws_sdk_s3`.
- `tests_port_boundary.rs` — architecture-fitness test: walks `src/**/*.rs` and fails if any file
  other than `sync/s3.rs` mentions `aws_sdk_s3`.

## Keys and errors

Trait keys are **relative to the account prefix** (`log/<install>/<seq>`); the adapter owns
`acct/<identity-id>/` and joins. Consequence: every key is inside the caller's own prefix by
construction, so the 403 disambiguation below always applies. Keys are validated (non-empty, no
leading `/`, no `.`/`..` segment) -> `StoreError::InvalidKey`.

`StoreError` variants (typed, no stringly errors; Story 10 maps them onto `AppError::Sync`):
`NotFound` (404) · `PreconditionFailed` (412) · `ConditionalConflict` (409, retryable) ·
`ContentHashMismatch` (412 on an immutable put whose stored hash differs — AD-6 install-id collision) ·
`Forbidden` (proven 403) · `CredentialsExpired` (`ExpiredToken*`/`RequestExpired`) ·
`MalformedObject` (an object that cannot prove its own identity) · `InvalidKey` ·
`Transport { operation, retryable }`. `retryable` is derived from 5xx/throttling/timeout, never guessed.

## Operations (AD-6)

| Port method | Request | Outcomes |
| --- | --- | --- |
| `put_immutable` | `If-None-Match: *` + content hash in metadata | `200` -> `Created`; `412` + stored hash equal -> `AlreadyStored`; `412` + differs -> `ContentHashMismatch`; `409` -> `ConditionalConflict` |
| `put_if_absent` | `If-None-Match: *` | `200` -> new ETag; `412` -> `PreconditionFailed`; `409` -> `ConditionalConflict` |
| `put_if_match` | `If-Match: <etag>` | `200` -> new ETag; `412` -> `PreconditionFailed` (re-read); `409` -> `ConditionalConflict`; `404` -> `NotFound` |
| `get` / `get_if_none_match` | plain / `If-None-Match: <etag>` | `200` -> `Modified`; `304` -> `NotModified`; `404` -> `NotFound` |
| `head` | HEAD | metadata incl. stored content hash |
| `list_one`/`exists` | `ListObjectsV2(prefix, max_keys=1)` | compared on the **exact** key; the 403 probe and AD-6's repair path |

**Content hash (decision):** AD-6 says immutable objects "carry their content hash as object
metadata". The adapter sends the sha256 both as user metadata `x-amz-meta-content-sha256` (hex) and
as the native `ChecksumSHA256` (base64) so S3 validates the upload itself. The 412 comparison reads
the **user metadata** off a `HEAD` (always returned, no extra request parameter), falling back to the
HEAD response's `ChecksumSHA256`. If neither is present the object cannot prove its identity and the
result is `MalformedObject`, never a silent success. ETags are deliberately not used for identity
(multipart and SSE-KMS make them non-digests).

## 403-vs-404 (AD-7 consequence)

The authenticated role's `s3:ListBucket` is conditioned on `s3:prefix`, so S3 answers **403
AccessDenied** — not 404 — for GET/HEAD on a *missing* key. `ExpiredToken*` is checked **first**
(it is also a 4xx auth failure and must never read as absence). Then a 403 `AccessDenied` triggers
one `ListObjectsV2(prefix = <full key>, max_keys = 1)`: empty -> `NotFound`, non-empty -> `Forbidden`,
probe itself denied -> `Forbidden`. Off the hot path: only a 403 pays for it; 200/304/404 do not.

## Tests

- `s3.rs` unit tests with `aws-smithy-mocks` (no network): every status/code -> `StoreError` mapping,
  both 412 immutable branches, both 403 probe outcomes, `ExpiredToken` not becoming `NotFound`, and
  that a 200/304 issues no probe (`num_calls() == 0` on the list rule).
- `store.rs` unit tests for key validation and the prefix join.
- `tests_s3_endpoint.rs`: one `#[ignore]`d module driven by `NIXUS_SYNC_TEST_*` env vars
  (endpoint/bucket/prefix/credentials) exercising create-only, CAS, conditional GET and the
  412/409/404/304 mapping against any S3-compatible endpoint. Skips with a reason when unset.

## Decisions

- Unattended per rules section 6: spec self-approved, all goals kept, no HALT taken, no review subagents.
- `AppError::Sync` does not exist yet (Story 10 / AD-16 adds it), so the port owns `StoreError`.
- The port uses `async fn` in trait (static dispatch, `SyncManager<S: ObjectStore>`); it is not
  `dyn`-compatible, which costs nothing because the adapter is chosen once at construction.
- `aws-config` had to move `1.8.15` -> `1.9.0` (resolves 1.12.0): aws-sdk-s3 1.152.0 needs
  `aws-smithy-schema ^0.2.1`/`aws-types ^1.6.0` and aws-config 1.8.x pins `aws-smithy-schema 0.1`,
  which fails to compile in the same tree.
- MinIO conformance could not be measured: `minio/minio` is not pullable from this machine.
- Same-PR CI chore: `cancel-in-progress` on Desktop CI is limited to pull requests.
