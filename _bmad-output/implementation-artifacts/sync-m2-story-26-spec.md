# Story 26 — Cost and abuse controls (AD-18). Plan (self-approved, unattended)

## Client (`sync/limits.rs`, new)
- Size caps, named consts with AD-18 doc comments:
  - `MAX_SEGMENT_OBJECT_BYTES = 16 MiB` (encoded = framed+zstd object). Split point stays
    `segment::SEGMENT_MAX_PAYLOAD_BYTES = 4 MiB` (pre-compression), re-documented as the AD-18
    split cap. Heavy-year margin: a real segment is < 100 KiB.
  - `MAX_SNAPSHOT_OBJECT_BYTES = 64 MiB`. Heavy-year object = 2 131 153 B -> 31x margin.
  - `MAX_BLOB_OBJECT_BYTES = 16 MiB`. App images are up to 4 MiB -> 4x; thumbnails 64 KiB.
  - `MAX_POINTER_BYTES = 1 MiB` for `head/*`, `roster`, `owner`, `snap/LATEST`.
- `RequestRateCap { burst, per_minute }`, default `burst = 120`, `per_minute = 600` (token bucket,
  refill 10/s). Steady state is `1 + heads` per 30 s, enable/bootstrap a few dozen -> never hit.
- `DatasetLimits` = the bucket + two counters (`delays`, `oversize_refusals`), one per dataset,
  owned by the `SyncHost` and shared into every `GatedStore` it hands out.

## Enforcement
- BOUNDARY: `GatedStore::pass()` -> gate check FIRST (a blocked dataset spends no token), then
  `limits.acquire().await` (sleeps, never drops). Every port method goes through `pass()`, so
  GET/PUT/LIST/DELETE/HEAD/EXISTS all count. The three put methods additionally call
  `limits.check_body(key, len)` -> `GatedError::TooLarge` (new variant).
- PRODUCER: `snapshot::build_snapshot` refuses over cap (`SnapshotError::TooLarge`);
  `blob::put_image_blob` refuses over cap (`BlobError::TooLarge`) before hashing;
  `segment::cut` splits at the payload cap (existing `bounded_batch`).
- Code: `payload_too_large`, NOT retryable, recoverable=false-ish (recoverable() = true so the UI
  can show copy; retryable() stays false so nothing loops).
- `SyncTuning::request_rate`; `SyncActor::new` reconfigures the host limiter from it.
- Diagnostics: `rate_delays`, `oversize_refusals` (counts only, AD-16).

## Frontend
`SyncErrorCode` + `SYNC_CODES` + `syncMessageKey` -> `sync.errorPayloadTooLarge`, EN/FR copy,
`ALL_ERROR_CODES` in `sync-i18n.test.ts`.

## Infra (`infra/sync/template.yaml`)
`SyncBucketMetrics` (MetricsConfiguration Id `EntireBucket`), `SyncAlertTopic` +
`SyncAlertSubscription` (email, `AlertEmail` param, pattern copied from api-bedrock which has NO
default and is passed from a workflow secret -> same here, with a default so a missing secret does
not break the deploy... see decision in ledger), `SyncRequestVolumeAlarm` (AWS/S3 AllRequests,
FilterId EntireBucket, Sum, 3600 s, 1 period, threshold 200 000), `SyncCostBudget`
(AWS::Budgets::Budget, MONTHLY COST, 20 USD, CostFilters Service = Amazon Simple Storage Service,
ACTUAL notifications at 80 and 100 to the email).
Gates: cfn-lint, verify-template.py (extended + mutation-tested), actionlint, py_compile.
`--capabilities CAPABILITY_NAMED_IAM` is unchanged (no new capability needed).
