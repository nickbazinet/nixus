---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
workflowType: 'research'
lastStep: 6
research_type: 'technical'
research_topic: 'Local-first multi-device sync for Nixus Cloud accounts (no per-action API)'
research_goals: 'Same data on every computer after Nixus Cloud login; app stays fully local, same speed, offline-capable; no REST-call-per-action architecture; novel algorithm design'
user_name: 'dev'
date: '2026-10-13'
web_research_enabled: true
source_verification: true
---

# Your Data, Everywhere, Still Local: A Technical Research Report on Serverless Multi-Device Sync for Nixus Cloud

**Date:** 2026-10-13
**Author:** dev (analyst: Mary)
**Research Type:** technical
**Status:** Complete (6 of 6 steps). Confidence: **Medium** (see Section "Confidence and Limits").

---

## Executive Summary

Nixus today keeps one SQLite file per cloud-linked account **per computer**, with nothing connecting them. The goal is to log in with a Nixus Cloud account on any machine and see the same data, while keeping the app local, fast, offline-capable, and without a REST call per user action.

The research concludes this is achievable **without any application server in the sync path**. The recommended algorithm is a **local-first, per-field, HLC-stamped change log** (the model used by the shipping open-source finance app Actual Budget), captured from SQLite itself, encrypted on the device, and exchanged between devices as immutable files in a private S3 prefix. Devices talk to S3 directly using short-lived credentials from a Cognito identity pool, and use S3 conditional writes (`If-None-Match`, `If-Match`) for coordination, so there is no Lambda, API route or database to run. Every read and write continues to hit local SQLite; sync is a background task that never blocks the UI. Estimated cloud cost is under about $0.10 per user per month (illustrative model, request-dominated).

Three design points are genuinely novel for this codebase and carry most of the risk and value: (1) **SQLite's pre-update hook** as a catch-all capture mechanism instead of hand-instrumenting ~230 SQL statements; (2) **running balances synced as commutative deltas**, not last-write-wins values, so concurrent spending on two computers never loses money; (3) **deterministic UUIDv5 identities for natural-key rows** so independent creations of "the same" row merge instead of violating UNIQUE constraints.

**Key Technical Findings**

- No sync exists today; every cloud-linked dataset is an independent per-device file (greenfield).
- Hosted sync engines (Electric, PowerSync, Zero) need an always-on service and server database; Litestream is single-writer; cr-sqlite is unmaintained upstream (last release Jan 2024) and forbids checked foreign keys and non-PK UNIQUE constraints, which Nixus uses (21 FKs, 3 UNIQUEs).
- Actual Budget is the closest proof: SQLite tables as the read path, HLC-timestamped per-field messages, last-writer-wins merge, optional E2EE, epoch-based log pruning.
- `accounts.balance_cents` is a running balance mutated by deltas, so it needs counter semantics.
- S3 conditional writes + Cognito identity-pool per-identity IAM scoping remove the need for an API tier. LIST is billed like PUT, so discovery should read small per-device "head" objects.
- Client-side AEAD (XChaCha20-Poly1305) means AWS stores only ciphertext; key distribution (passphrase vs. recovery phrase vs. KMS) is the main product decision.

**Technical Recommendations**

1. Adopt the per-field HLC change-log architecture, delivered in phases: offline core + simulator first, then encrypted snapshot sync (a quick user-visible win reusing `db/backup.rs`), then live log merge, then compaction.
2. Run a 1-2 day spike to settle whether the pre-update hook sees `INSERT OR REPLACE` and truncate-style deletes (the one untested assumption on the critical path).
3. Build the N-replica `proptest` convergence simulator before any cloud work; treat it as the executable specification.
4. Decide the four product questions (keys, first-sync policy, delete/balance semantics, who gets sync) before PRD.
5. Update README/Privacy Policy: shipping this changes the "no cloud account for your records" statement.

---

## The Algorithm on One Page

**Entities.** Each synced row gets a `uuid` (UUIDv7; UUIDv5 from the natural key where a non-PK UNIQUE exists). Local integer ids stay as local handles. Each device has a `device_id` and a Hybrid Logical Clock `hlc = (wall_ms, counter, device_id)`.

**Write (always local, zero network).**
1. Application runs its normal SQL in one transaction.
2. A pre-update hook on the dataset connection buffers `(table, row_uuid, column, old, new)` for each change.
3. At commit, for each change write a `sync_log` row `(msg_id, hlc, table, row_uuid, column, kind, value)` in the same transaction, where `kind` is `LWW` (set field), `COUNTER` (store `new - old`) or `TOMBSTONE` (delete).
4. UI is done. Total extra cost: a few indexed inserts.

**Ship (background).**
1. Cut `sync_log` rows not yet shipped into an immutable **segment** (size/time bounded), compress, encrypt with the account data key (XChaCha20-Poly1305, AAD = account, device, seq, schema_version).
2. `PUT <identity>/log/<device>/<seq>` with `If-None-Match: *`; then update `<identity>/head/<device>` with the new `seq`.

**Fetch (background).**
1. Poll peers' `head/<device>` objects (GET, cheap, no LIST). For any device whose `seq` exceeds what is applied locally, GET the missing segments in order, verify gaps, decrypt.

**Apply (same path as local writes, one SQLite transaction per batch).**
1. Sort messages by `hlc`. Skip duplicates by `msg_id`.
2. `LWW`: for `(row_uuid, column)` keep the value with the greatest `hlc`; older messages are logged but not applied.
3. `COUNTER`: add the delta once (de-dup by `msg_id`); value = sum of all deltas.
4. `TOMBSTONE`: delete wins over concurrent edits; row kept in a "recently deleted" view until compaction.
5. Defer FK checks to commit; if a parent is missing, **park** the message and retry when more segments arrive. Messages with unknown tables/columns (newer schema) are parked, never dropped.
6. Advance the local HLC with each received timestamp (reject timestamps beyond a max drift).

**Bootstrap a new computer.** Log in (Cognito) -> exchange ID token for scoped AWS credentials -> download latest encrypted snapshot -> unlock with passphrase -> restore (reusing the backup safe-swap) -> replay segments after the snapshot watermark.

**Compact.** Devices publish acks; when all live devices have acknowledged up to watermark W, one device (elected by `If-None-Match`) writes a snapshot at W and older segments/tombstones are deleted. A device offline beyond retention re-bootstraps and replays its own unsent log on top.

**Why this meets the requirements.** Reads/writes never leave the machine (speed unchanged); no connectivity is needed to work; no per-action API exists; AWS sees only ciphertext; concurrent offline edits merge deterministically field by field.

---

## Table of Contents

1. Executive Summary (above) and The Algorithm on One Page
2. Technical Research Scope Confirmation
3. Codebase Ground Truth (internal findings)
4. Technology Stack Analysis (Step 2)
5. Integration Patterns Analysis (Step 3)
6. Architectural Patterns and Design (Step 4)
7. Implementation Approaches and Technology Adoption (Step 5)
8. Technical Research Recommendations (roadmap, stack, KPIs, product decisions)
9. Synthesis: Cross-Cutting Conclusions, Outlook, Confidence and Limits, Sources (end of document)

> Mapping to the standard template: *Landscape/Architecture* = Sections 4 and 6; *Implementation* = Section 7; *Integration* = Section 5; *Performance/Scalability* and *Security* = subsections of Sections 5-7; *Strategic recommendations and roadmap/risk* = Sections 7-8; *Outlook, methodology, sources* = Section 9.

---



## Technical Research Scope Confirmation

**Research Topic:** Local-first multi-device sync for Nixus Cloud accounts (no per-action API)
**Research Goals:** Same data on every computer after Nixus Cloud login; app stays fully local, same speed, offline-capable; no REST-call-per-action architecture; novel algorithm design

**Scope:** architecture analysis, implementation approaches, technology stack, integration patterns, performance. Confirmed 2026-10-13.

---

## Codebase Ground Truth (internal, from repo scan)

| Fact | Implication for sync |
|---|---|
| All data tables use `INTEGER PRIMARY KEY` (AUTOINCREMENT); no UUIDs | Two devices will mint colliding row IDs. Needs globally unique IDs (UUIDv7/ULID) or an ID-remap step. |
| Only `budget_groups` / `budget_categories` have `deleted_at`; all else hard-deletes (some with CASCADE / SET NULL / RESTRICT) | Deletes need tombstones or a change log. |
| No triggers in 28 migrations; derived state (balances, audit) maintained in Rust inside one transaction per mutation | Clean single choke point (`src-tauri/src/db/*.rs`) for capturing changes; also means trigger-based CRDT extensions will not collide with existing triggers. |
| `audit_log` is write-only, inconsistently populated, JSON blobs | Not usable as a replay log. |
| `accounts.balance_cents` is mutated alongside `expenses` inserts | A derived value. Plain per-column LWW on balances would corrupt it; sync the inputs (expenses) and recompute, or model as op-based. |
| `project_images` stores BLOBs (<= 4 MiB) inline | Large binary payloads need separate blob handling (content-addressed objects), not row-level change logs. |
| Each cloud-linked dataset = its own SQLite file keyed by Cognito `sub` (`datasets.rs`) | The natural sync unit is one cloud-linked dataset per account. Devices currently create independent files; there is no shared genesis. |
| Backend today: Cognito user pool + one Lambda + one DynamoDB table (AI quota only); S3 unused | Nothing syncs now. Any sync backend is a new AWS surface. |
| `db/backup.rs` has checkpoint -> safety copy -> atomic swap -> forward-migrate -> rollback | Reusable as the "bootstrap a new device from a snapshot" primitive. |

---

## Technology Stack Analysis

### Programming Languages

Nixus is Rust (Tauri 2) with SQLite via `rusqlite`; sync belongs in the Rust core, not the React layer. The relevant language question is which sync engines expose a Rust-usable core.

- Rust cores: Automerge (crate 0.12.0), Loro (crate 1.16.2), yrs (0.28.0) [mechcrate survey, Sept 2026 data]; cr-sqlite is a C/Rust loadable extension; Corrosion (Fly.io) embeds cr-sqlite from Rust.
- TypeScript only: Evolu (SQLite + E2EE + relays), PowerSync client SDKs (JS/Flutter/Kotlin/Swift; no Rust SDK identified in sources reviewed).
- Go: Litestream.

_Source: https://mechcrate.dev/docs/corpus/architecture/local-first-sync-engines-crdts-in-practice/ ; https://github.com/superfly/cr-sqlite_
_Confidence: High on the listing; Medium on version numbers (secondary survey)._

### Development Frameworks and Libraries (sync approaches)

The 2026 landscape groups into five architectures (taxonomy from the mechcrate survey, extending Mathews 2023 and Convex's "map of sync"):

| Architecture | Conflict resolver | Examples | Offline writes |
|---|---|---|---|
| Optimistic UI + request queue | Your API | hand-rolled | Only what you queue |
| Read-path replication from Postgres | Your API | Electric | Yours to build |
| Server-authoritative + mutation replay | Server | Zero, PowerSync, Replicache | PowerSync yes, Zero no |
| Event log with client rebase | Global order of events | LiveStore, Actual Budget | Yes |
| CRDT documents / relations | Merge function of the data type | Automerge, Yjs, Loro, cr-sqlite, Evolu | Yes, incl. P2P |

Key per-option findings:

1. **cr-sqlite (vlcn-io).** Loadable extension turning tables into "conflict-free replicated relations": per-column LWW registers by default, causal-length sets for delete/resurrect, change extraction through the `crsql_changes` virtual table (`WHERE db_version > ? AND site_id IS NOT ?`), history-free (compact; no audit/undo). **Maintenance risk:** latest vlcn release v0.16.3 on 2024-01-17, nothing since; the v2 causal-log rewrite is unreleased. Fly.io maintains a fork (0.17.0) used by Corrosion with HLC timestamps and tombstone reaping, but it introduces breaking bookkeeping changes. Triggers are installed on every CRR table.
   _Source: https://github.com/vlcn-io/cr-sqlite ; https://hivebook.wiki/wiki/cr-sqlite-crdt-extension-for-multi-writer-local-first-sqlite ; https://vlcn.io/docs/cr-sqlite/api-methods/crsql_changes ; https://github.com/superfly/cr-sqlite_

2. **SQLite session extension (changesets).** Built into SQLite. Records INSERT/UPDATE/DELETE on tracked tables into a changeset; `sqlite3changeset_apply` takes an `xConflict` callback returning OMIT / REPLACE / ABORT; conflict kinds are DATA, NOTFOUND, CONFLICT, CONSTRAINT, FOREIGN_KEY; apply is wrapped in a savepoint (all-or-nothing). Changesets can be concatenated and inverted. A rebase API exists but is documented as experimental. Conflict detection is "old value differs", i.e. it is not a CRDT; convergence across 3+ devices depends on applying in a consistent order. Prior art: SQLiteChangesetSync (Swift) builds a git-like commit graph of changesets pushed to CloudKit, and itself lists schema migrations and conflict handling as unsolved.
   _Source: https://sqlite.org/sessionintro.html ; https://www.sqlite.org/session/sqlite3changeset_apply.html ; https://sqlite.org/session.html ; https://github.com/gerdemb/SQLiteChangesetSync_

3. **Evolu.** SQLite, per-cell LWW with hybrid logical clocks, range-based set reconciliation, relays that cannot read data (E2EE; key derived from a secret/mnemonic), self-hostable relay, single-owner model (matches "one person's finances per install"). Auto columns `createdAt`, `updatedAt`, `isDeleted`; soft deletes. TypeScript only; Evolu 8 changed its local storage format with no automatic migration from 7 (churn risk). **Best used as a protocol/design reference, not a dependency.**
   _Source: https://www.evolu.dev/docs/local-first ; https://github.com/real-life-org/web-of-trust/blob/main/docs/research/framework-evaluation.md_

4. **PowerSync / Electric / Zero.** All server-authoritative and Postgres/Mongo-backed; they require an always-on sync service and a server-side database. PowerSync writes go through your backend's `uploadData()`; Electric has no write path. This contradicts the "no API per action / no server database" constraint. Ruled out as primary candidates.
   _Source: https://powersync.com/blog/ditto-vs-powersync ; mechcrate survey above._

5. **Document CRDTs (Automerge 3, Yjs/yrs, Loro).** Mature, Rust cores exist, but data is document-shaped; relational joins/FKs/aggregates would have to be rebuilt on top. A benchmark report found Automerge (WASM) 76x slower than Yjs on mobile init for a 163 KB doc (that finding is WASM/mobile-specific; a native Rust core would not share it). Better fit: embed one for rich-text fields only, which Nixus does not have.
   _Source: https://github.com/real-life-org/web-of-trust/blob/main/docs/research/framework-evaluation.md_

6. **Event-log precedent: Actual Budget** (a local-first finance app, closest product analogue). Per-field message log; the survey notes its log "grows forever", listed by its author as a downside. Shows the model works for budgeting data, and shows compaction must be designed in from day one.
   _Source: mechcrate survey (cites Actual Budget's message log)._

_Ecosystem maturity: HIGH for session extension and Litestream; MEDIUM for cr-sqlite (stalled upstream); MEDIUM for Evolu (rapid churn); LOW fit for Postgres-centric engines._

### Database and Storage Technologies

- **Local:** keep SQLite exactly as is for all reads and writes (zero network on the hot path). Sync becomes a background process that reads/writes a change stream.
- **Litestream** (WAL/LTX shipping to object storage): replicates one database to S3-compatible storage, but is **single-writer by design**. Its VFS write mode "assumes a single writer" and only detects conflicts, with no automatic merge. Good for backup and restore, not for multi-master. It does confirm S3 as a viable "dumb" store and uses S3 conditional writes for lease coordination.
  _Source: https://litestream.io/guides/vfs-write-mode/ ; https://fly.io/blog/litestream-revamped/_
- **Amazon S3 conditional writes:** `If-None-Match: *` (create-only) and `If-Match: <ETag>` (compare-and-swap) on PutObject / CopyObject / CompleteMultipartUpload; losers get `412 Precondition Failed`; requires SigV4. This gives a **linearizable head pointer on plain S3 with no Lambda or database**, which is the missing primitive for a serverless op-log.
  _Source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html_
- **DynamoDB** (already deployed for quota): usable as a tiny head/lease index; supports per-identity fine-grained access via `dynamodb:LeadingKeys`.

### Development Tools and Platforms

- **Per-user storage isolation without an API:** Cognito *identity pools* mint temporary STS credentials; an IAM policy using `${cognito-identity.amazonaws.com:sub}` restricts a user to `s3://bucket/<identity-id>/*` (documented example grants Get/Put/List on that prefix only). The desktop app can then talk to S3 directly with scoped credentials.
  **Gap to flag:** Nixus has a Cognito *user pool* + API Gateway authorizer today; an identity pool federated to the same user pool would be new infrastructure, and the identity-pool `sub` differs from the user-pool `sub`.
  _Source: https://docs.aws.amazon.com/cognito/latest/developerguide/iam-roles.html_
- Testing: sync convergence is best tested with property-based/randomized multi-replica simulation (fits `proptest` in Rust); not researched further in this step.

### Cloud Infrastructure and Deployment

- Existing: SAM (API Gateway, Lambda, DynamoDB, Cognito authorizer), GitHub OIDC deploy. A sync backend can follow the same SAM/OIDC conventions.
- Candidate minimum footprint (to be validated in steps 3-5): one S3 bucket (SSE, versioning optional, lifecycle rules) + Cognito identity pool + IAM role + optional DynamoDB head item. No always-on compute.

### Technology Adoption Trends

- Industry converged on **server-authoritative sync engines** (Electric, PowerSync, Zero) for multi-user SaaS; the "serverless/E2EE/relay-only" camp (Evolu, Automerge+Keyhive, Actual Budget's self-host server) is smaller but matches single-owner personal apps.
- **cr-sqlite upstream has stalled** while forks (Fly.io Corrosion, SQLite AI's `sqlite-sync`, which requires TEXT UUIDv7 primary keys and DEFAULTs on NOT NULL columns) carry the ideas forward. sqlite-sync is tied to SQLite Cloud / Postgres / Supabase backends.
- UUIDv7/ULID primary keys are the consistent recommendation across CRDT-on-SQLite tools; auto-increment integers are called out as unsafe for multi-device. 
- Tombstone/history growth is the standing open problem; answers differ (Automerge keeps all, Yjs GC, Loro shallow snapshots, Actual keeps forever).

_Source: https://github.com/sqliteai/sqlite-sync ; mechcrate survey._

### Early Signals (not conclusions; feed steps 3-5)

1. The "no API per action" goal is achievable by making the **cloud a dumb, encrypted, append-only mailbox** (S3 + conditional writes) that clients exchange change batches through, in the background, with scoped credentials.
2. The hard part is not transport; it is **(a) stable IDs, (b) change capture, (c) a deterministic merge rule, (d) derived-value handling (balances), (e) blobs, (f) schema-version skew across devices, (g) compaction**.
3. Two viable cores to compare in step 4: **HLC-stamped per-column LWW change log written by Nixus's own Rust repository layer** (Evolu / Actual Budget style) versus **cr-sqlite-style triggers** versus **session-extension changesets with a total order**.

### Research Gaps / Honest Caveats

- One web search (S3-only serverless sync patterns, Cognito identity-pool + presigned URL designs) hit the search provider's rate limit and returned nothing; the S3 and Cognito findings above come from AWS primary docs only.
- Not verified: `rusqlite` feature flags for session extension and loadable-extension support in the Tauri build; Windows/macOS code-signing implications of bundling a native extension; AWS cost per user; Actual Budget primary docs (docs URL returned 404; relied on secondary survey).
- Version numbers for Automerge/Loro/yrs come from a single secondary survey.

---

## Integration Patterns Analysis

Framing: the user's constraint ("no REST API call per action") removes the usual request/response integration layer. What remains is **device <-> object store** integration, run in the background, off the UI path. The template's microservice and gateway categories mostly do not apply; they are marked as such rather than padded.

### API Design Patterns

- **RESTful / GraphQL / gRPC / webhooks: not applicable to the hot path.** All reads and writes hit local SQLite. The only remote surface is S3 object operations (PUT / GET / LIST / conditional PUT), signed with SigV4, issued by a background task.
- **Auth bootstrap is the only "API-like" step, and it is rare.** With a Cognito identity pool in the *enhanced flow*, the app presents the existing user-pool ID token to `GetId`, then `GetCredentialsForIdentity`, and receives temporary AWS credentials valid for **one hour**, then signs S3 requests itself. That is two small calls per hour of sync activity, not one per user action.
  _Source: https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flow.html_
- **Identity-pool input is the same ID token the app already holds** (the table lists "Amazon Cognito user pool -> ID token"). Nixus's PKCE login already yields `id_token` (stored in `CognitoSession`), so no new login UX is needed. Caveat: the app currently uses the *access token* for hosted AI; the ID token must also be kept fresh (existing 120 s refresh logic covers the session).
- **Identity ID stability:** `GetId` returns a stable identity ID per linked login and is documented as "consistent across devices and platforms", which is the property needed for a per-account S3 prefix. Identities can merge if logins link, so the prefix must not be derived from anything the client can re-link.
- **Alternative: presigned URLs minted by the existing Lambda.** One small authenticated call (vend a short-lived URL set) preserves the "dumb store" model but reintroduces a Lambda in the sync path. Weaker fit with the requirement, but simpler IAM (no identity pool). Kept as fallback B.

### Communication Protocols

- **HTTPS to S3 only.** No WebSocket, no MQTT, no always-on connection. Consequence: **no server push**; other devices learn of new data by polling a small "head" object. Poll triggers: app start, window focus, after local write (debounced), and a slow timer. (Conditional GET with the head's ETag to make an unchanged poll cheap is standard HTTP semantics; S3 support was not re-verified in this session.)
- **Optimistic concurrency via S3 conditional writes.** `If-None-Match: *` makes "create this segment key" an atomic first-writer-wins; `If-Match: <ETag>` gives compare-and-swap on a head/manifest object. Losers receive `412 Precondition Failed`; concurrent deletes can produce `409`/`404`. Requires SigV4. This is what removes the need for any coordinator.
  _Source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html_
- **Two layouts to evaluate in step 4:**
  1. *Per-device append-only logs* (no write contention at all): each device writes only under `<identity>/log/<device-id>/<seq>.seg` using create-only PUTs; readers LIST and fetch what they lack. No CAS needed; the manifest is optional.
  2. *Single shared head with CAS*: one `head` object updated with `If-Match`; simpler to reason about total order, but contention retries and a hot key.
  Layout 1 is the stronger fit for a handful of devices per person.

### Data Formats and Standards

- **Change record (proposed):** `{hlc, device_id, table, row_uuid, column, value | tombstone}` batched into immutable **segments** (e.g. up to N KB or T seconds of local activity), compressed, then AEAD-encrypted. Binary encodings (MessagePack/CBOR/protobuf) rather than JSON for size; not benchmarked here.
- **Hybrid Logical Clock:** Rust crate `uhlc` 0.9.0 (EPL-2.0 OR Apache-2.0, published 12 Sep 2026) provides HLC timestamps with unique IDs, `new_timestamp()` and `update_with_timestamp()`, and rejects incoming timestamps that would drift the clock too far (`ExceedingDeltaError`). This matches Fly's Corrosion usage of HLC for cr-sqlite tombstone reaping. Licence note: EPL-2.0 is dual with Apache-2.0, so Apache-2.0 is selectable.
  _Source: https://docs.rs/uhlc/latest/uhlc/ ; https://github.com/superfly/cr-sqlite_
- **Row identity:** UUIDv7/ULID text or 16-byte blob primary keys (recommended across CRDT-on-SQLite tools). Migration of existing integer IDs is a Step 5 topic: add a `uuid` column per table and keep the integer PK as a local-only handle, mapping FKs via uuid in the change stream. That avoids a destructive PK rewrite.
- **Blobs (`project_images`):** content-addressed objects (`blob/<sha256>`), referenced from the change stream; uploaded with `If-None-Match: *` (dedupe for free), fetched lazily.
- **Bulk import:** a statement import of N transactions is one local transaction and should become one segment.

### System Interoperability Approaches

- **Reconciling "what do I have vs. what exists":** besides simple per-device sequence numbers, **range-based set reconciliation (RBSR)** is a documented, bandwidth-efficient way for two replicas to find set differences in O(log n) rounds by exchanging fingerprints of sorted ranges (fingerprint = e.g. addition mod 2^256 of IDs, plus count, SHA-256, first 16 bytes in the Negentropy v1 wire spec). It is also the technique Evolu uses (per the framework survey). Rust implementations exist (`rust-negentropy`, iroh-sync, `unionize`), though several lack a persistent monoid tree. **For Nixus's scale (one person, tens of thousands of rows, a few devices) per-device sequence numbers are simpler and sufficient; RBSR becomes valuable only if a relay/peer-to-peer mode or very large histories are added.** Treat as an optional later phase.
  _Source: https://github.com/AljoschaMeyer/set-reconciliation/ ; https://github.com/hoytech/negentropy ; https://arxiv.org/abs/2212.13567_
- **Peer-to-peer (LAN) sync:** possible with the same segment format over mDNS/TCP between two Nixus instances on one network, no cloud involved. Not researched in depth; flagged as an offline-first bonus path.
- **Point-to-point only.** No gateway, mesh, or ESB pattern is relevant.

### Microservices Integration Patterns

Not applicable: no service-to-service topology exists in this design. The only server-side logic worth considering is optional and asynchronous (e.g. a scheduled compaction Lambda, S3 lifecycle rules). Saga, circuit breaker, and service discovery are replaced by: idempotent segment apply (segments are immutable and keyed by `(device, seq)`), retry with backoff on `412/409/5xx`, and offline queue (the local change log *is* the queue).

### Event-Driven Integration

- **Event sourcing is the integration model.** The per-device HLC-stamped change log is an event log; local SQLite is the materialized view. Precedent: Actual Budget's message log; LiveStore's event-sourced model with client rebase.
- **Pub/sub:** S3 Event Notifications could notify a server, but desktop apps cannot receive them without a push channel. Polling plus optional OS-level triggers is the realistic option. A WebSocket/SNS push would reintroduce a server and is out of scope.
- **CQRS-like split falls out naturally:** writes append to the local change log + SQLite in one transaction; sync reads/applies remote segments through the same single-writer path that Nixus's `DbState(Mutex<ActiveDataset>)` already enforces.
- **Derived data:** `accounts.balance_cents` must not be synced as an LWW column. Options (Step 4): sync only the inputs and recompute, or sync signed deltas ("op-based counter") for balances.

### Integration Security Patterns

- **Identity and authorisation:** Cognito user pool (existing) -> identity pool -> IAM role whose policy scopes S3 access to `arn:aws:s3:::bucket/${cognito-identity.amazonaws.com:sub}/*` (AWS's documented per-identity prefix pattern; `s3:ListBucket` additionally conditioned on `s3:prefix`). Trust policy must pin `cognito-identity.amazonaws.com:aud` to the identity pool and `amr` to `authenticated`; AWS now rejects trust policies without the `aud` condition. Prefer the **enhanced flow** (AWS's recommendation); avoid enabling the basic flow.
  _Source: https://docs.aws.amazon.com/cognito/latest/developerguide/iam-roles.html ; .../authentication-flow.html_
- **Credential storage:** the temporary AWS credentials are short-lived and can live in memory; the long-lived secrets (Cognito refresh token) already live in the OS keyring via `credentials.rs`, the sole keyring accessor.
- **Confidentiality (end-to-end encryption):** because S3 only needs to hold opaque blobs, encrypt every segment client-side with an AEAD. Rust `chacha20poly1305` 0.11.0 (Apache-2.0 OR MIT, RustCrypto, NCC Group audit with no significant findings, published 17 Sep 2026) provides ChaCha20-Poly1305 and **XChaCha20-Poly1305 with a 192-bit nonce**, which makes random nonces safe for many segments without nonce-reuse bookkeeping. Nonce must be unique per message.
  _Source: https://docs.rs/chacha20poly1305/latest/chacha20poly1305/_
- **Key management (the hard product question):** a per-account **data key** must exist on every device but must not live on AWS in the clear. Candidate patterns:
  1. *Recovery phrase* (Evolu model: BIP39 mnemonic -> keys; user re-enters on new device). Strong privacy, user burden, lose it = lose cloud data.
  2. *Passphrase-wrapped key stored in S3* (Argon2id-derived key-encryption-key wraps the data key; new device prompts for passphrase after Nixus Cloud login).
  3. *Escrow with AWS KMS* (convenience; weakens "Nixus can't read your data" claim; contradicts README's privacy posture).
  Recommendation to evaluate in Step 5: option 2, with an optional exported recovery code. Option 3 needs an explicit product decision because the README states Nixus cannot see user records.
- **Integrity and rollback attacks:** AEAD authenticates each segment; bind `(account, device, seq, schema_version)` as associated data so segments cannot be replayed under another position. Signed/authenticated manifests would be needed to detect a malicious store withholding segments (low priority threat for a personal-finance app; note only).
- **Padding / metadata:** object sizes and timing leak activity patterns; Evolu applies PADME padding. Optional hardening.
- **Cross-account safety:** never trust a `device_id` or table name read from a decrypted segment without schema validation; apply through the existing repository layer or a parameterised apply path, never string-built SQL.

### Cost / Operational Notes

- Request volume model (not priced): per active device, one HEAD/GET poll per interval plus one PUT per segment. S3 request pricing was **not captured** (pricing page fetch was truncated), so cost per user is an open item.
- No always-on compute is required; only the identity pool (no per-request charge identified in sources fetched; unverified) and S3 storage/requests.

### Research Gaps / Honest Caveats for Step 3

- S3 conditional-GET behaviour, S3 request pricing, Cognito identity-pool pricing, and Evolu protocol docs (404) were **not verified** this step.
- `rusqlite` session-extension support and the Rust AWS SDK crates for Cognito Identity and S3 (size impact on the Tauri binary, SigV4 signing) were not researched yet; they belong in Step 5.
- RBSR crate maturity is described from the author's README only.

---

## Architectural Patterns and Design

### Additional codebase facts gathered for this step (verified by grep/read)

| Fact | Where | Why it matters |
|---|---|---|
| 21 `REFERENCES` clauses: 10 `CASCADE`, 4 `SET NULL`, 1 `RESTRICT`; `PRAGMA foreign_keys=ON` | `migrations/*.sql`, `db/mod.rs` | Out-of-order/concurrent merges can violate FKs. cr-sqlite explicitly **forbids checked FKs** on replicated tables. |
| Non-PK UNIQUE constraints: `merchant_category_hints(merchant, budget_category_id)`, `maintenance_tasks(vehicle_id, task_type_key)`, `income_entries(source_id, month)` (later dropped by 012) | migrations 011, 015, 018 | Two devices inserting the "same" natural-key row get two UUIDs and a UNIQUE violation. cr-sqlite also forbids non-PK UNIQUE. |
| `accounts.balance_cents` is a **running balance**: `adjust_account_balance` applies a signed delta (sign depends on account type and cash-flow kind) per expense/income/reversal; `update_account_balance` sets an absolute value | `db/account.rs` L62-80, L213-235; `db/expense.rs` | Balance = "last absolute set + sum of later deltas". Plain LWW on this column loses money. The existing `BalanceChange {old, new}` struct is already a delta record. |
| ~230 mutating SQL statements across ~22 files in `db/` (largest: `projects.rs` 38, `budget.rs` 30, `maintenance.rs` 23, `danger_zone.rs` 23) | `src/db/*.rs` | The "single choke point" is a convention, not a type. Change capture by hand-instrumenting every statement is the main implementation risk; a trigger/guard safety net is needed. |

### System Architecture Patterns

Four candidate cores were evaluated against Nixus's constraints (local SQLite stays the read/write path, no per-action API, offline, E2EE, FKs and UNIQUEs present, running balances):

| # | Pattern | How it works | Fit | Verdict |
|---|---|---|---|---|
| A | **HLC-stamped per-field message log, written by the repository layer** (Actual Budget model), stored as encrypted per-device segments on S3 | Every mutation also emits `(hlc, table, row_uuid, column, value)`; merge = per-field LWW in HLC order; local tables are a materialised view | Proven in a shipping local-first **finance** app; works with any SQLite schema; FK/UNIQUE handled in app code; fully under our control | **Recommended core** |
| B | cr-sqlite (or fork) triggers on every table | Extension installs triggers and clock tables; `crsql_changes` virtual table is the change feed | Least code to write, but: upstream stalled (v0.16.3, Jan 2024); **no checked FKs, no non-PK UNIQUE** on CRR tables; every Nixus table has either; native extension must be bundled and signed on macOS and Windows | Reject as primary; reuse ideas |
| C | SQLite session-extension changesets with a total order | Capture changesets per transaction, ship, `changeset_apply` with a conflict handler | Built into SQLite and transactional (savepoint), but conflict detection is "old value differs" (not convergent across 3+ devices without a global order); needs rebase (experimental) or server-assigned order; SQLiteChangesetSync (prior art) leaves migrations and conflicts unsolved | Viable fallback; weaker convergence story |
| D | **Whole-database snapshot sync** (single-writer, `If-Match` lease) | Encrypt and upload the DB file on close/idle; other devices download if the remote ETag changed; concurrent edits -> user picks a side | Trivial; reuses `db/backup.rs`; no schema changes; loses concurrent edits by design | **Phase 0 / MVP** and the bootstrap/compaction primitive for A |

**Recommended staged path (A built on D):**
- *Phase 0* — encrypted snapshot sync (D): proves auth (identity pool), S3 layout, key management, onboarding UX, "log in on a second computer and see my data" with conflicts handled by "newer wins, keep a restore point". Ships fast.
- *Phase 1* — message log (A): per-field merge, many devices editing offline without losing edits.
- Snapshots from Phase 0 stay as the **bootstrap and compaction** mechanism in Phase 1.

_Sources: Actual Budget design — https://archive.jlongster.com/using-crdts-in-the-wild ; https://github.com/actualbudget/actual/blob/master/packages/crdt/src/crdt/timestamp.ts ; https://deepwiki.com/actualbudget/actual/2.4-crdt-system-and-conflict-resolution ; cr-sqlite constraints — https://vlcn.io/docs/cr-sqlite/constraints ; session extension — https://sqlite.org/sessionintro.html_

### Design Principles and Best Practices

Evidence from the closest shipping analogue (Actual Budget):
- All reads use ordinary SQLite tables; all writes go through `insert/update/delete` functions that generate single-row, single-field **messages**. "There is no difference between the local client making updates and receiving changes from another client. It all goes through the same layer."
- Messages are stored in a `messages_crdt(timestamp UNIQUE, dataset, row, column, value)` table in the same DB; applying a message updates the table **and** appends to the log. Storage roughly doubles (author reports ~16 MB DBs, acceptable).
- IDs are unique IDs, "never sequentially increasing integers".
- Fully conflict-free to the user: no merge UI. Field-level granularity so edits to different fields of one row merge.
- Applying is a single SQLite transaction (all-or-nothing); the in-memory clock is mutated only after commit. Messages arrive in any order; "old" messages (older than what's already stored for that field) are recorded in the log/hash but not applied.
- Costs the author names: op-based CRDTs "generate lots of changes", and the log is append-only so needs an **epoch** after which older messages can be deleted.
- Clock: HLC with max drift **5 minutes** (a message from further in the future is rejected); ties broken by node ID; the counter orders same-millisecond events.
- Optional E2EE: payload AES-256-GCM before upload.
_Source: same as above (primary: author's article + source code `timestamp.ts`, `sync/index.ts`)._

**Principles adopted for Nixus:**
1. *One write path*: local edits and remote messages both go through the same `apply` function. Enforce with a type (`SyncedTx`) rather than convention, because ~230 statements are spread over 22 files.
2. *The log is truth; tables are a cache.* A `repair`/`rebuild` command can recompute tables from the log (Actual ships `repairSync`).
3. *Never drop what you don't understand* (unknown column/table/schema version -> park, don't discard).
4. *Deterministic merge only*: no user-facing conflict dialogs; give users a "recently deleted" safety net instead.

### Scalability and Performance Patterns

- **Hot path unchanged.** A local write adds one extra `INSERT` per changed field into `sync_log` inside the *same* transaction. For reference, one expense insert is about 6-8 fields; a 100-line statement import is under about 800 log rows. SQLite handles this in milliseconds. (Estimate, to be benchmarked in Step 5.)
- **Background-only network.** Segments are cut by size/time (for example every N KB or after 30 s idle), compressed, encrypted, uploaded with a create-only PUT. UI never awaits the network.
- **Scale target**: one person, a few devices, tens of thousands of fields per year; the bottleneck is not throughput but log growth and bootstrap time -> handled by snapshots + epochs.
- **Verification of completeness** via per-device contiguous sequence numbers (cheap gap detection). Merkle-trie (Actual) or RBSR (Negentropy) only needed if peer/relay modes are added.
- **Bootstrap** of a new device = latest snapshot + segments after the snapshot's watermark, not replaying years of history.

### Integration and Communication Patterns

(See Step 3.) Architectural consequence: sync is a **separate Rust service/actor** (`sync/`) owning: HLC, `sync_log`, S3 client, crypto, apply queue. The UI only sees status (`Idle | Syncing | Offline | NeedsUpdate | NeedsPassphrase | Error`) via the existing Tauri event channel; it never blocks on it.

### Security Architecture Patterns

(Step 3 covers identity/IAM/E2EE.) Added architectural points:
- **Clock-skew attack/accident**: a device with a clock far in the future would win every LWW. Mitigate exactly as Actual does: reject remote timestamps beyond now + max drift; surface "check your computer clock" instead of silently diverging. A device with a clock far in the past silently loses edits; detect on send via `uhlc` `ExceedingDeltaError`-style checks and warn.
- **Authenticated segment metadata** (AAD = account, device, seq, schema version) prevents splicing/reordering of segments by the storage layer.
- **Key rotation / device revocation**: revoking a lost laptop requires rotating the data key and re-encrypting a fresh snapshot; old segments become unreadable to the revoked device only after rotation. Needs an explicit product flow.

### Data Architecture Patterns

**1. Identity.** Add a `uuid` (UUIDv7, 16-byte BLOB) column to every synced table, with a unique index; keep the integer `id` as a *local-only* handle so existing code, FKs and 28 migrations remain valid. Messages reference rows and parents by `uuid`; the apply path resolves `uuid -> local id`. This avoids a destructive primary-key rewrite.

**2. Deterministic IDs for natural-key rows.** For tables with non-PK UNIQUE constraints (`merchant_category_hints`, `maintenance_tasks (vehicle,task_type)`), derive the row UUID with UUIDv5 from the natural key (e.g. `hash(merchant, category_uuid)`), so two devices that independently create "the same" row address the same row and merge as one. Eliminates UNIQUE violations without removing the constraint. (Design proposal; derived from the cr-sqlite constraint restriction, not from a cited implementation.)

**3. Per-field LWW registers.** Row state = for each column, the value with the greatest `(hlc, device_id)`.

**4. Deletes.** A delete is a message on a reserved `_deleted` field with an HLC. Policy decision for the PRD: **delete wins over concurrent edits** (simplest, matches user intent for financial rows), with tombstones retained until compaction and a 30-day "recently deleted" view. Alternative: causal-length semantics (cr-sqlite) allowing resurrection; more complex.

**5. Running balances (the non-obvious one).** `accounts.balance_cents` is not a register. Proposed type: **reset-plus-delta counter**:
   - `set(balance, hlc)` messages (from `update_account_balance`, account creation) act as an absolute baseline.
   - `delta(amount, hlc, msg_id)` messages (from `adjust_account_balance` / `reverse_adjustment`) are commutative increments.
   - Value = latest `set` + sum of all `delta` messages whose HLC is **after** that `set`, de-duplicated by `msg_id`.
   - Concurrent increments on two devices both count (the PN-counter property); a manual "correct my balance to X" supersedes older deltas but not newer ones.
   - Rationale: LWW on a derived/accumulated number loses concurrent updates; the standard cure is increments/decrements as separate commutative operations (PN-Counter), merged without loss. Caveat from the PN-counter literature: increments must be applied **exactly once** (hence `msg_id` de-dup) and "never model a decrement by lowering a value".
   - This design (reset-plus-delta) is my synthesis from the PN-counter literature and Nixus's `BalanceChange` model; it needs property-based testing before adoption.
   - Alternative: do not sync `balance_cents`; recompute from an opening balance plus linked expenses/income. Rejected as default because manual balance edits exist and balances are stored by design.
   _Sources: https://www.replication-conflict-resolution.org/conflict-detection-automated-resolution-strategies/algorithm-selection-for-merge/implementing-crdt-counters-in-couchdb/ ; https://docs.hazelcast.com/hazelcast/5.3/data-structures/pn-counter ; https://concordant.gitlabpages.inria.fr/software/c-crdtlib/c-crdtlib/crdtlib.crdt/-p-n-counter/index.html_

**6. Foreign keys under eventual consistency.** cr-sqlite's authors chose to forbid checked FKs because the workarounds "all have nuanced tradeoffs". Nixus keeps FKs on, so the apply path needs a policy:
   - Apply each batch inside one transaction with `PRAGMA defer_foreign_keys = ON`, so ordering within a batch doesn't matter; commit validates.
   - If a child message references a parent not yet received, **park** the message in `sync_pending` and retry when more segments arrive (the message stays in the log, so nothing is lost).
   - Concurrent *delete parent* vs *add child*: the single `RESTRICT` (`project_contributions.account_id -> accounts`) and the 4 `SET NULL` / 10 `CASCADE` edges each need an explicit merge rule, for example "child reference wins: undelete the parent" for RESTRICT, and replaying CASCADE as ordinary delete messages generated deterministically on every device (not by local FK cascade). Each rule must be listed in a per-FK table in the architecture doc.
   - Local FK cascades must not emit divergent messages on different devices: cascades should be expressed as explicit child tombstones in the log.

**7. Schema-version skew.** Every segment carries `schema_version` (migration number 029+ becomes the first synced schema). Rules:
   - Newer-schema messages touching unknown tables/columns are **parked**, not applied or dropped, and replayed after the app updates (Nixus auto-updates).
   - A device that sees a remote schema newer than its own sets status `NeedsUpdate`, keeps working locally and keeps *its own* logging, and does not block.
   - Migrations that change semantic meaning (not just add a column) need a coordinated "epoch bump": snapshot at new version, old-version segments sealed. Rare; plan as release process, not code.
   _(Design proposal. Evolu/cr-sqlite handle this differently — cr-sqlite via `crsql_begin_alter/commit_alter` — not independently verified here.)_

**8. Compaction and garbage collection.**
   - Each device periodically writes an `ack` object with its highest applied sequence per peer.
   - When all known, non-revoked devices have acked up to watermark W, any device (lock-free, using `If-None-Match` to elect a winner) writes a **snapshot** = encrypted SQLite file + vector watermark, then segments and tombstones <= W may be deleted (S3 lifecycle or explicit delete).
   - A device offline longer than the retention window re-bootstraps from the latest snapshot and **replays its own unsent local log on top** (LWW makes this safe), so offline edits aren't lost.
   - Matches the known options for the open tombstone/history growth problem (Automerge keeps all; Yjs GC; Loro shallow snapshots; Actual epoch) — ours is an epoch with acknowledged causal stability.

**9. Blobs.** Content-addressed `blob/<sha256>` objects (encrypted), referenced by hash from a field message; upload with `If-None-Match: *`; lazily downloaded; reference-counted at compaction.

### Deployment and Operations Architecture

- **Infra delta (new):** one S3 bucket (SSE-S3 or SSE-KMS as a second layer, default block-public-access, lifecycle for incomplete multipart and expired segments), one Cognito **identity pool** (enhanced flow only) bound to the existing user pool, one IAM role scoped to `${cognito-identity.amazonaws.com:sub}/*` with `aud`/`amr` conditions. Deployed by the existing SAM + GitHub OIDC pipeline (`apps/api-bedrock` conventions). **No Lambda, no API Gateway route, no DynamoDB table in the sync path.**
- **Observability without servers:** client-side sync log + status UI; a "Sync diagnostics" export; optional CloudWatch S3 request metrics for cost watch.
- **Testing strategy (essential):** a deterministic **N-replica simulator** (Rust, `proptest`) that generates random operations, random delivery order, duplicates, drops and device restarts, then asserts all replicas converge to identical SQLite state and balances. Add a "mutation coverage" test that fails if any SQL `INSERT/UPDATE/DELETE` in `db/` bypasses the sync-aware transaction wrapper.
- **Rollout:** feature flag per dataset; sync only for `CloudLinked` datasets (existing `datasets.rs` concept); local-only datasets are untouched.

### Open Risks Carried Into Step 5

1. Change capture completeness across ~230 SQL statements (largest implementation risk).
2. Reset-plus-delta balance semantics needs formal tests; also verify other accumulating columns (net-worth snapshots, savings-project totals, `recurring_*` generation) for the same issue.
3. Per-FK merge policy table (15 CASCADE/SET NULL/RESTRICT edges).
4. `danger_zone.rs` (reset/wipe) semantics in a synced world: a "delete all data" on one device must be an explicit epoch reset, not 10,000 tombstones.
5. Key-management UX (passphrase, recovery, device revocation).
6. Clock-skew handling UX.
7. First-sync migration for existing users: assigning UUIDs to existing rows deterministically? If two existing devices already hold *different* local data for the same account, the first merge needs a policy (pick one as the base dataset, or union by natural keys). **This is the most user-visible edge case and needs a product decision.**

### Research Gaps / Honest Caveats for Step 4

- One search (CRDT tombstone GC / causal stability / bootstrap) hit the Exa rate limit and returned nothing, so the compaction design (#8) is my synthesis informed by the Step 2 survey and Actual's epoch, not a verified external reference.
- The cr-sqlite schema-migration docs page returned 404.
- Design items marked "proposal" (deterministic UUIDv5 for natural keys, reset-plus-delta balances, ack-based compaction, FK policy table, schema parking) are original syntheses for Nixus and need prototype validation.

---

## Implementation Approaches and Technology Adoption

### Findings that change earlier steps (read first)

1. **A catch-all change-capture mechanism exists, which removes the biggest risk from Step 4.** SQLite's *pre-update hook* is called "prior to each INSERT, UPDATE, and DELETE operation on a database table" and exposes the **old and new value of every column** (`sqlite3_preupdate_old/new`); it fires only for real tables, with `preupdate_depth` distinguishing direct changes from trigger-caused ones. It needs `SQLITE_ENABLE_PREUPDATE_HOOK`; `rusqlite` exposes this as the `preupdate_hook` feature (and also lists `session`, `hooks`, `backup`, `serialize`, `uuid`, `load_extension` features; checked against 0.40.2's feature list; Nixus pins 0.38 with `bundled`). Consequence: **capture does not have to be hand-instrumented across ~230 SQL statements in 22 files.** One hook on the single dataset connection (`DbState(Mutex<ActiveDataset>)`) can record every row change, including ones in code paths nobody remembers. Caveats from SQLite's own docs for the *older* `update_hook`: not invoked for WITHOUT ROWID tables, for rows removed by an `ON CONFLICT REPLACE`, or for deletes via the truncate optimisation (`DELETE FROM t` with no WHERE). Whether the pre-update hook shares those exceptions is **not stated in its documentation and must be tested**, particularly against `danger_zone.rs` (mass deletes) and any `INSERT OR REPLACE` usage. Hook callbacks must not write to the same connection; changes are buffered and written to `sync_log` at/after commit (design constraint, not a blocker).
   _Source: https://www.sqlite.org/c3ref/preupdate_blobwrite.html ; https://www.sqlite.org/c3ref/update_hook.html ; https://docs.rs/crate/rusqlite/latest/features_

2. **Step 4's "reset-plus-delta" balance counter can be simplified to a pure delta counter.** With old/new values available, a change to `accounts.balance_cents` is recorded as `delta = new - old` (account creation is a delta from 0). All deltas commute, de-duplicated by message ID. A manual "set my balance to X" becomes a delta of `X - old` on that device. Concurrent case: device A corrects 4,800 -> 5,000 (+200) while device B spends 100 (-100); merged result 4,900, which is the correct real-world balance, whereas an authoritative "set" would silently erase B's spend. Reset-plus-delta is only needed if product wants manual sets to be authoritative. This also covers other accumulating columns generically via a per-column `merge = Counter` annotation. _(Design reasoning; validate with the simulator.)_

3. **Polling cost: avoid LIST.** S3 charges LIST at the PUT rate ($0.005 per 1,000) versus $0.0004 per 1,000 for GET/HEAD (S3 Standard, us-east-1). Discovery should read small per-device **head objects** (`<identity>/head/<device>` holding the latest sequence number, written with PutObject) with plain GETs, not list prefixes. Step 3's "list the prefix" is demoted to a repair path.
   _Source: https://akalcloud.ai/blog/s3-request-pricing/ (cites AWS Price List us-east-1, 2026-09-11) ; https://aws.amazon.com/s3/pricing/ (LIST priced as PUT/COPY/POST)_

### Technology Adoption Strategies

**Phased delivery (each phase independently shippable and reversible):**

| Phase | Deliverable | What it proves | Reuses |
|---|---|---|---|
| 0a | UUID columns + backfill migration (029+), `sync_log` schema, HLC, device identity; **no network** | Capture + apply + convergence in a simulator | `db/mod.rs` migrations |
| 0b | Cognito identity pool + S3 bucket + IAM (SAM), Rust S3/Cognito client, key management, **encrypted snapshot upload/restore** ("log in on second computer, get my data") | Auth, IAM scoping, E2EE, onboarding UX; user-visible win early | `db/backup.rs` safe-swap, `credentials.rs`, `CognitoSession` |
| 1 | Pre-update-hook capture -> encrypted segments -> per-device heads -> apply with LWW/counter/tombstone/FK parking | Real multi-device merge, offline edits | Phase 0 pieces |
| 2 | Acks + snapshot compaction + schema-skew parking + clock-drift UX + recently-deleted view | Long-term health | |
| 3 (optional) | LAN peer sync, RBSR, relay, multi-profile | | |

Phase ordering note: 0a precedes 0b so convergence logic is proven before any cloud cost or IAM risk exists. If product wants a user-visible milestone first, swap 0a/0b (snapshot sync does not need the log).

**Gradual vs big-bang:** gradual, behind a per-dataset flag limited to `DatasetKind::CloudLinked`. Local-only datasets never get UUID columns' sync behaviour, hooks, or network code paths.

**First-sync policy for existing users (product decision required):** two computers may already hold different local data under one Nixus Cloud account (today each device has its own independent cloud-linked dataset). Options:
- **A (recommended for v1): "cloud is the base."** First device to enable sync uploads its dataset as the base snapshot (its row UUIDs become canonical). Any other device linking later must choose: **(1) replace local data with the cloud copy** (local file kept as a dated backup via existing backup code), or **(2) keep it as a separate, unsynced local dataset**.
- B (later): union-merge by natural keys. Hard because most rows have none (`expenses` have no natural key; statement imports of overlapping periods produce near-duplicates); would need fuzzy duplicate detection (for example same date + amount + merchant), user review UI, and is a separate project.
- Account/asset/vehicle-level selective import is a plausible middle path, not researched.

### Development Workflows and Tooling

**Dependencies already in `apps/desktop/src-tauri/Cargo.toml`:** `rusqlite 0.38 (bundled)`, `tokio` full, `aws-config 1.8`, `aws-sdk-bedrockruntime`, `reqwest 0.12 (rustls)`, `sha2 0.10`, `rand 0.9`, `keyring 4`, `chrono`, `serde`.

**Proposed new crates (versions as shown on docs.rs at research time):**

| Purpose | Crate | Version | Licence | Notes |
|---|---|---|---|---|
| S3 | `aws-sdk-s3` | 1.152.0 | Apache-2.0 | `PutObject` builder exposes `if_none_match` and `if_match` (verified); `presigned()` available |
| Cognito identity pool | `aws-sdk-cognitoidentity` | 1.116.0 | Apache-2.0 | `GetId` + `GetCredentialsForIdentity` |
| HLC | `uhlc` | 0.9.0 | EPL-2.0 OR Apache-2.0 | unique-ID HLC, rejects excessive drift |
| IDs | `uuid` | 1.28.0 | Apache-2.0 OR MIT | `v7` for rows, `v5` for deterministic natural-key rows (both features) |
| AEAD | `chacha20poly1305` | 0.11.0 | Apache-2.0 OR MIT | XChaCha20-Poly1305 (192-bit nonce); NCC Group audit, no significant findings |
| Passphrase KDF | `argon2` | 0.6.0 | MIT OR Apache-2.0 | Argon2id; `hash_password_into` for key derivation (not the PHC-string API) |
| Compression | `zstd` or similar | not researched | | segment compression; choose in prototype |
| Property tests | `proptest` | 1.x | | also used by the AWS SDK crates' own tests |
| DB features | `rusqlite` features `preupdate_hook`, `hooks`, `uuid`, (`backup` already implied by `db/backup.rs`) | upgrade to 0.40.x suggested | | feature availability verified on 0.40.2; confirm on 0.38 or plan the upgrade |

Binary-size / build-time impact of adding `aws-sdk-s3` + `aws-sdk-cognitoidentity` to a Tauri app was **not measured**. Mitigation if too large: use `aws-sigv4` plus the existing `reqwest` (rustls) for the handful of S3 calls (GET/PUT with conditional headers), and a hand-rolled two-call Cognito Identity client (JSON over HTTPS). Decide after measuring in Phase 0b.

**Module layout (proposed):** `src-tauri/src/sync/{mod, hlc, capture, log, apply, segment, crypto, keys, s3, auth, compaction, status}.rs`, each under the project's 250-LOC ceiling; Tauri commands `sync_status`, `sync_enable`, `sync_link_device`, `sync_now`, `sync_disable`. Follows the repo's conventions (raw rusqlite repositories, `AppError` discriminated union, `credentials.rs` as the only keyring accessor).

### Testing and Quality Assurance

1. **Convergence simulator (the most important test asset).** In-process N-replica harness (3-5 replicas) generating random operations against the real schema (inserts, field edits, deletes, balance changes, FK parents/children), random delivery order, duplicated and dropped segments, replica restarts, and clock skew within limits. Properties asserted after quiescence: (a) **all replicas have byte-identical logical table contents**, (b) balances equal the sum of all deltas, (c) no FK violations, (d) no lost non-conflicting field edits, (e) idempotence (re-applying all segments changes nothing). `proptest` provides shrinking so a failure produces a minimal operation trace.
2. **Capture coverage test.** Runs every public `db::*` function (and `danger_zone` operations) with the hook on and asserts each mutation produced the expected `sync_log` entries; plus a test that deliberately uses `INSERT OR REPLACE` and `DELETE FROM t` to prove the hook sees them (open question #1 above).
3. **Crypto tests.** Known-answer vectors, tamper tests (flip a bit in ciphertext / AAD -> decrypt must fail), nonce uniqueness property.
4. **IAM tests.** Integration test against a real dev stack asserting a token for user A **cannot** read or write user B's prefix, and `ListBucket` outside the prefix is denied.
5. **S3 concurrency tests.** Two clients racing `If-None-Match: *` on one key: exactly one succeeds (`412` for the other); `409 ConditionalRequestConflict` is retried (the SDK docs say to retry on 409).
6. **Performance gates.** Baseline current p50/p95 for representative commands (insert expense, budget load, 100-row statement import) *before* Phase 1, then require no more than a small fixed regression (threshold to be set from the baseline). Measure hook overhead specifically.
7. **Upgrade tests.** Device on schema N and N+1 exchanging segments; parked messages replay after upgrade.
8. **Existing gate:** repository quality gates in `dev-standards` and `docs/guidelines/warnings.md` (zero-warnings compile) apply to all new code.

### Deployment and Operations Practices

- **IaC:** extend the existing SAM/CloudFormation pipeline (GitHub OIDC deploy, protected `production` environment) with: S3 bucket (block public access, default encryption, lifecycle rules for abandoned multipart uploads and expired segments), Cognito identity pool (enhanced flow only, `aud`/`amr` conditions), authenticated role with the per-identity prefix policy. No new compute.
- **Client rollout:** Tauri auto-update ships the sync code dark; enable per account via a flag; kill switch (remote config is itself a network call, so prefer a local setting + release gating).
- **Observability without servers:** local sync log, `sync_status` events to UI, one-click "export sync diagnostics" (redacted), S3 request metrics for cost watch.
- **Disaster recovery:** the encrypted snapshot is also a backup; S3 versioning optional (adds storage cost). Local `.pre-restore` safety copy pattern already exists.
- **Support playbook:** "rebuild tables from log" (`repair`), "re-bootstrap from snapshot", "unlink device", "rotate key".

### Team Organization and Skills

Single maintainer. Skills needed and where the learning curve sits:
- *Rust + SQLite internals* (hooks, transactions): comfortable.
- *Distributed-systems reasoning* (HLC, LWW, counters, causal stability): the new skill; mitigate with the simulator as an executable specification and by copying Actual Budget's proven structure.
- *Applied cryptography*: use only audited high-level AEAD + KDF crates; no custom constructions; threat model written down first.
- *AWS IAM/Cognito identity pools*: new surface; mitigate with automated cross-tenant IAM tests.
- Suggested BMAD route: this research -> product brief addendum -> PRD (sync) -> architecture (`/create-architecture`) -> epics -> stories.

### Cost Optimization and Resource Management

Unit prices used (S3 Standard, us-east-1; region of the production bucket not yet chosen): storage $0.023/GB-month; PUT/COPY/POST/LIST $0.005 per 1,000; GET $0.0004 per 1,000; DELETE free; data transfer out $0.09/GB beyond an account-level 100 GB/month allowance (per a third-party calculator, not AWS-primary).
_Source: https://akalcloud.ai/blog/s3-request-pricing/ ; https://www.cloudfiles.io/tools/s3-cost-calculator ; https://aws.amazon.com/s3/pricing/_

Illustrative model for **one user with 3 devices**, each open 8 h/day, polling the 2 peer head objects once a minute:
- GETs: 3 devices x 480 polls x 2 peers x 30 days = 86,400/month -> about **$0.035**
- PUTs: about 100 segments/day + 100 head updates/day = 6,000/month -> about **$0.03**
- Storage: under 0.1 GB (log + 2 retained snapshots) -> about **$0.002**
- Transfer out: well under 1 GB, inside the allowance -> about **$0**
- **Order of magnitude: under $0.10 per user per month**, dominated by request counts, which are tunable (poll interval, segment batching). Cognito identity-pool charges and KMS (if SSE-KMS is chosen) are **not included; not verified**.
- Using LIST for discovery instead of head GETs would raise the discovery line about 12x; this is why heads exist.
- Premium-tier fit: a flat-rate "Nixus Cloud" sync add-on is comfortably above cost at this scale. Free-tier users could get snapshot-only sync or none; product decision.

### Risk Assessment and Mitigation

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Pre-update hook misses some write kinds (REPLACE, truncate-delete, WITHOUT ROWID) | Medium (undocumented for preupdate) | High: silent divergence | Test explicitly in Phase 0a; if gaps, forbid those SQL forms via lint/CI, or add a periodic **state-hash audit** comparing `sync_log`-derived state with table contents |
| R2 | LWW picks the "wrong" value for a legitimate concurrent edit | Certain (by design) | Low-Medium | Per-field granularity; surface "recently changed on another device"; keep deleted rows 30 days |
| R3 | Clock skew gives one device unfair LWW wins | Medium | Medium | HLC with bounded drift (reject remote > now + max drift, as Actual does with 5 min); user prompt to fix clock |
| R4 | FK / CASCADE / RESTRICT divergence under concurrency | High without policy | High | Per-edge policy table, deferred FK checks + parking, simulator coverage of every edge (15 edges) |
| R5 | Key loss locks user out of cloud data | Medium | High | Passphrase + printable recovery code; local data is never encrypted-only-in-cloud; unlinked device keeps working |
| R6 | Cross-tenant data exposure via IAM mistake | Low | Critical | Per-identity prefix policy, `aud`/`amr` trust conditions, automated cross-tenant test in CI, bucket block-public-access; client-side encryption means exposure leaks ciphertext only |
| R7 | Schema skew between devices | High (auto-update is staggered) | Medium | Park-don't-drop, `NeedsUpdate` status, no blocking of local use |
| R8 | Log/tombstone growth | Certain over time | Medium | Ack-based snapshot + epoch compaction (Phase 2); size alarms |
| R9 | Mass operations (`danger_zone` reset, large imports) flood the log | Medium | Medium | Explicit **epoch reset** message for wipe; bulk import batches into one segment |
| R10 | Binary size / build time from AWS SDK crates | Medium | Low-Medium | Measure in 0b; fall back to `aws-sigv4` + `reqwest` |
| R11 | Existing users' divergent per-device datasets | Certain | High (UX) | First-sync policy A; ship clear copy and backups |
| R12 | Windows keyring size limit (2560 B) for any new secrets | Low | Low | Keep long-lived secrets out of keyring (derive on demand), follow existing chunking in `credentials.rs` if needed |
| R13 | Privacy promise in README ("no cloud account for your records") becomes untrue | Certain if shipped | Medium (trust) | Update README/Privacy Policy/ToS; make sync opt-in; E2EE so Nixus cannot read records; state it plainly |
| R14 | `rusqlite` upgrade 0.38 -> 0.40 breaks something | Low-Medium | Low | Upgrade as its own PR before Phase 0a |

---

## Technical Research Recommendations

### Implementation Roadmap

1. **Decide the three product questions** (below) before any code.
2. **Spike (1-2 days):** hook-capture proof on a copy of the real schema: verify R1 (REPLACE, truncate-delete, cascade) and measure write overhead. Output: go/no-go for hook-based capture vs. repository-level instrumentation.
3. **Phase 0a** (offline core): migration 029 (`uuid` columns, backfill, `sync_log`, `sync_state`), HLC + device ID, hook capture, apply path, convergence simulator green with 3-5 replicas.
4. **Phase 0b** (cloud + snapshot): SAM additions, Rust S3/Cognito client, key management UX, snapshot upload/restore, cross-tenant IAM test, first-sync policy A UI.
5. **Phase 1** (live merge): segments, per-device heads, apply with parking, status UI, conflict visibility ("changed on another device").
6. **Phase 2** (hardening): acks, snapshot compaction, schema-skew parking, clock UX, recently deleted, key rotation/device revoke.
7. **Phase 3** (optional): LAN sync, RBSR, relay, selective merge of divergent datasets.

### Technology Stack Recommendations

- **Core:** own HLC-stamped per-field log (Actual Budget model) captured by SQLite pre-update hook; per-column merge kinds `LWW | Counter | Tombstone`.
- **Transport/store:** S3 with conditional writes, direct from the app using Cognito-identity-pool credentials; **no REST endpoint, Lambda, or database in the sync path.**
- **Crypto:** XChaCha20-Poly1305 for segments/snapshots, Argon2id-wrapped data key, AAD binding `(account, device, seq, schema_version)`.
- **IDs:** UUIDv7 rows with integer ids kept local; UUIDv5 for natural-key rows.
- **Fallbacks:** presigned-URL minting by the existing Lambda if identity pools prove unacceptable; session-extension changesets if per-field messages prove too heavy; snapshot-only sync as the permanent floor.
- **Do not adopt:** cr-sqlite as dependency; Postgres-based sync engines (Electric/PowerSync/Zero); document CRDTs for relational data.

### Skill Development Requirements

HLC and LWW semantics; counter CRDTs; property-based testing with shrinking; SQLite pre-update/commit hooks; AEAD/KDF usage and key management UX; Cognito identity pools and IAM policy variables; S3 conditional-write semantics (`412`, `409` retry rules).

### Success Metrics and KPIs

| KPI | Target (proposed; set baselines in spike) |
|---|---|
| Local write latency regression (p95) vs. today | within a small fixed budget measured in spike; **no network on the hot path** (hard rule) |
| App fully usable offline / with sync disabled | 100% (automated test with network blocked) |
| Convergence property tests | 0 failures across a large randomized run in CI; failing traces archived |
| Cross-tenant access tests | 100% denied |
| Time for a second device to show data after login (typical DB size) | seconds-to-low-tens-of-seconds (measure; bounded by snapshot size) |
| Propagation latency device A -> B (both online) | within poll interval + segment batch time |
| Cloud cost per active sync user | under $0.10/month at the modeled usage |
| Data-loss incidents (user-reported) | 0; any report triggers simulator reproduction |
| Sync-related support tickets | tracked; trend down after Phase 2 |

### Product Decisions Needed From You

1. **Key management:** passphrase-wrapped key with optional recovery code (recommended) vs. recovery phrase only vs. KMS escrow (breaks "Nixus cannot read your data").
2. **First-sync policy:** option A ("cloud is the base; other devices replace or stay separate") for v1, merge later?
3. **Delete semantics and balance semantics:** delete-wins with 30-day "recently deleted" (recommended); balances as pure delta counters (recommended) vs. authoritative manual set.
4. **Who gets sync:** Nixus Cloud premium only, or all signed-in accounts (affects cost exposure, not design).

### Research Gaps / Honest Caveats for Step 5

- Whether the pre-update hook shares the update hook's blind spots (REPLACE, truncate-delete) is **untested**; this decides the capture strategy and is the first thing to spike.
- `rusqlite` 0.38 feature availability for `preupdate_hook` was verified only on 0.40.2's list.
- Binary-size impact of the AWS SDK crates, Cognito identity-pool pricing, KMS pricing, and S3 pricing for the final production region were **not verified**.
- Compression library choice not researched.
- Cost model is an illustrative estimate from published per-unit prices, not a measurement.

---

## Synthesis: Cross-Cutting Conclusions

### How the pieces reinforce each other

- **Local-first is the performance answer, S3 is the portability answer.** Because all reads and writes stay on SQLite, "same speed" is a structural property, not a tuning target. S3 + conditional writes + identity-pool scoping supply the only things a server would otherwise provide (storage, atomic create, per-user isolation) without a server.
- **One mechanism serves four needs.** The immutable, encrypted, per-device segment is simultaneously the transport unit, the audit trail, the repair source (`rebuild tables from log`), and, with snapshots, the compaction and new-device bootstrap unit.
- **The hook turns the hardest implementation risk into the first spike.** Hand-instrumenting ~230 statements was the largest risk; the pre-update hook converts it into one testable question (does it see REPLACE and truncate-deletes?).
- **Deltas make balances correct by construction.** Treating the running balance as a sum of commutative increments is what lets two offline computers both spend money safely; it also generalises to any accumulating column.
- **Determinism removes user-facing conflicts.** Per-field LWW with a bounded-drift HLC, delete-wins, and park-don't-drop mean the user never sees a merge dialog; the safety nets are a "recently deleted" view and an "edited on another device" indicator.
- **Phase 0 de-risks everything.** Snapshot sync exercises auth, IAM, crypto, onboarding and cost with no merge logic, and its snapshot format is later reused for bootstrap and compaction.

### Strategic Technical Impact Assessment

- **Product:** moves Nixus from "one install, one machine" toward a premium multi-device capability while preserving the local-first identity; a differentiator versus cloud-first budgeting apps (this aligns with the existing mobile/cloud differentiation addendum in `_bmad-output/planning-artifacts/product-brief-addendum-mobile-cloud-differentiation-2026-08-12.md`, not re-read here).
- **Architecture:** adds one subsystem (`sync/`), one migration series (UUIDs + sync tables), and one small infra stack (S3 + identity pool + role). No change to the read path.
- **Trust/privacy:** with client-side encryption Nixus cannot read synced records, but the README's current wording ("no cloud account for your records... no sync") must change, and the AI-features section already shows the established pattern for explaining data flows honestly.
- **Operational load:** near zero servers to run; the burden shifts to client correctness, which is why the simulator is non-negotiable.

### Future Technical Outlook (hedged; not independently forecast by sources)

- *Near term:* the same log format can carry a **second client** (for example a mobile companion) because the contract is "encrypted segments in S3 + deterministic merge", independent of Tauri. Rust core crates exist for Automerge, Loro, and yrs if rich-text fields ever appear.
- *Medium term:* optional **LAN peer sync** and **range-based set reconciliation** (Negentropy-style) if relays or very large histories are introduced; **selective merge** of divergent legacy datasets with duplicate detection.
- *Watch items:* S3 conditional-write semantics and pricing changes; Cognito identity-pool pricing; cr-sqlite v2 or forks if they mature; Evolu's protocol as a reference implementation (its storage format changed between v7 and v8, indicating churn).

### Confidence and Limits

| Area | Confidence | Basis |
|---|---|---|
| Per-field HLC log works for a finance app | High | Actual Budget source code and author's write-up |
| S3 conditional writes and Cognito per-identity IAM scoping | High | AWS primary documentation |
| Hybrid-clock, AEAD, UUID, S3 SDK crate capabilities | High | docs.rs pages |
| Pre-update hook as catch-all capture | **Medium-Low until spiked** | SQLite docs confirm API; behaviour for REPLACE/truncate not documented for pre-update |
| Delta-counter balances; UUIDv5 natural-key IDs; ack-based compaction; FK policy table; schema parking | **Medium** | Original syntheses from cited literature; need simulator validation |
| Cost model (< $0.10/user/month) | Medium | Published unit prices, illustrative usage; excludes Cognito/KMS charges |
| Binary-size impact of AWS SDK crates | Unknown | Not measured |

Research limitations: the Exa search provider rate-limited several queries (S3-only serverless patterns, tombstone GC/causal stability, others), so some design areas rest on primary docs plus reasoning rather than multiple independent sources; cr-sqlite migration docs and Evolu protocol docs returned 404; Cognito identity-pool and KMS pricing were not verified; Nixus code was inspected selectively (schema, auth, account/expense balance logic, Cargo.toml), not exhaustively.

### Next Steps

1. Answer the four product decisions (keys; first-sync policy; delete and balance semantics; who gets sync).
2. Run the capture spike (pre-update hook vs. REPLACE, truncate-delete, cascades, WITHOUT ROWID; measure overhead).
3. Feed this report to `/create-brief` (or the existing mobile/cloud addendum) and then `/create-prd`, `/create-architecture`, `/create-epics-stories`.
4. Prioritise the convergence simulator and cross-tenant IAM test as the first stories.

---

## Sources

**Primary / authoritative**
- SQLite session extension: https://sqlite.org/sessionintro.html ; https://www.sqlite.org/session/sqlite3changeset_apply.html ; https://sqlite.org/session.html
- SQLite hooks: https://www.sqlite.org/c3ref/preupdate_blobwrite.html ; https://www.sqlite.org/c3ref/update_hook.html
- AWS S3 conditional writes: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
- AWS Cognito identity pools (flow, IAM): https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flow.html ; https://docs.aws.amazon.com/cognito/latest/developerguide/iam-roles.html
- AWS S3 pricing: https://aws.amazon.com/s3/pricing/ (rate tables read via https://akalcloud.ai/blog/s3-request-pricing/ and https://www.cloudfiles.io/tools/s3-cost-calculator)
- Rust crates (docs.rs): `uhlc` https://docs.rs/uhlc/latest/uhlc/ ; `chacha20poly1305` https://docs.rs/chacha20poly1305/latest/chacha20poly1305/ ; `argon2` https://docs.rs/argon2/latest/argon2/ ; `uuid` https://docs.rs/uuid/latest/uuid/ ; `aws-sdk-s3` https://docs.rs/aws-sdk-s3/latest/aws_sdk_s3/operation/put_object/builders/struct.PutObjectFluentBuilder.html ; `aws-sdk-cognitoidentity` https://docs.rs/aws-sdk-cognitoidentity/latest/aws_sdk_cognitoidentity/ ; `rusqlite` features https://docs.rs/crate/rusqlite/latest/features
- Actual Budget: https://archive.jlongster.com/using-crdts-in-the-wild ; https://github.com/actualbudget/actual/blob/master/packages/crdt/src/crdt/timestamp.ts ; https://deepwiki.com/actualbudget/actual/2.4-crdt-system-and-conflict-resolution
- cr-sqlite: https://github.com/vlcn-io/cr-sqlite ; https://vlcn.io/docs/cr-sqlite/api-methods/crsql_changes ; https://vlcn.io/docs/cr-sqlite/constraints ; fork https://github.com/superfly/cr-sqlite
- Litestream: https://litestream.io/guides/vfs-write-mode/ ; https://fly.io/blog/litestream-revamped/
- Range-based set reconciliation: https://github.com/AljoschaMeyer/set-reconciliation/ ; https://github.com/hoytech/negentropy ; https://arxiv.org/abs/2212.13567
- Evolu: https://www.evolu.dev/docs/local-first

**Secondary / survey**
- https://mechcrate.dev/docs/corpus/architecture/local-first-sync-engines-crdts-in-practice/
- https://github.com/real-life-org/web-of-trust/blob/main/docs/research/framework-evaluation.md
- https://powersync.com/blog/ditto-vs-powersync ; https://powersync.com/blog/electricsql-vs-powersync
- https://hivebook.wiki/wiki/cr-sqlite-crdt-extension-for-multi-writer-local-first-sqlite
- https://github.com/sqliteai/sqlite-sync ; https://github.com/gerdemb/SQLiteChangesetSync
- PN-counter references: https://www.replication-conflict-resolution.org/conflict-detection-automated-resolution-strategies/algorithm-selection-for-merge/implementing-crdt-counters-in-couchdb/ ; https://docs.hazelcast.com/hazelcast/5.3/data-structures/pn-counter ; https://concordant.gitlabpages.inria.fr/software/c-crdtlib/c-crdtlib/crdtlib.crdt/-p-n-counter/index.html

**Internal (Nixus repository)**
- `apps/desktop/src-tauri/migrations/` (001-028), `src/db/{mod,account,expense,backup}.rs`, `src/datasets.rs`, `src/credentials.rs`, `src/commands/{auth,cloud_link,backup,import}.rs`, `Cargo.toml`
- `apps/api-bedrock/template.yaml`, `infra/bootstrap/github-oidc-deploy.yaml`
- `_bmad-output/planning-artifacts/architecture-cloud-bedrock.md`, `architecture-login.md`

---

**Technical Research Completion Date:** 2026-10-13
**Source verification:** key claims cited above; items labelled "proposal" or "synthesis" are original design and are not source-verified.
**Overall confidence:** Medium. High on the architecture family and AWS primitives; the capture mechanism and the original merge refinements require a spike and simulator before commitment.

---

## Decisions Recorded (2026-10-13, after report completion)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| 1 | Key management | **AWS KMS escrow** (no user passphrase) | Simplest UX: log in on a new computer and data appears. Nixus/AWS can technically decrypt synced records, so the README/Privacy Policy claim that Nixus cannot see records must be rewritten for synced data. Local-only datasets are unaffected. |
| 2 | First-sync policy | **First device is the source of truth** (policy A) | Later devices replace local data with the cloud copy (local file kept as dated backup) or stay separate. No merge of divergent datasets in v1. |
| 3 | Delete / balance semantics | **Delete wins** (30-day recently-deleted view); **balances as delta counters** | As designed in Step 4/5. |
| 4 | Who gets sync | **Premium Nixus Cloud accounts only** | Entitlement check (`architecture-entitlements-licensing.md`) gates enabling sync; IAM role can additionally require a premium claim. |
| 5 | Local store | **SQLite stays** (sync log lives in the same DB, same transaction) | Spike must still measure hook overhead, bulk-import cost, and apply-batch lock time (apply in small chunks). |

### Design impact of choosing KMS (to be validated, not yet researched)

- **Option K1 (simplest):** bucket default encryption with SSE-KMS and drop client-side segment encryption. No key distribution at all; AWS decrypts transparently for the scoped IAM role. Weakest privacy (AWS-side plaintext access by anyone with the key policy).
- **Option K2 (envelope):** keep client-side XChaCha20-Poly1305, but the per-account data key is generated with KMS `GenerateDataKey`, stored wrapped in S3 (`<identity>/key`), and unwrapped on any logged-in device via `kms:Decrypt` allowed for the identity-pool role with an encryption-context condition tied to the identity. Keeps ciphertext at rest unreadable without KMS and allows later migration to a user-held key (add a passphrase wrap) without re-architecting. **Recommended over K1.**
- Items not verified this session: KMS pricing, `kms:EncryptionContext` condition syntax for identity-pool roles, per-request KMS latency/caching, and key-rotation behavior. Add to the spike/architecture step.
- Device revocation: with KMS, revoking a device is just not issuing it credentials (sign-out/remove device), no data-key re-encryption needed unless the account is compromised.

---

## Decision Update: K1 Selected, S3 Default Encryption (2026-10-13)

**Choice:** server-side encryption only, using the S3 bucket's **default encryption**; no client-side segment encryption, no custom keys, no key management feature.

**Clarification of "default":** per AWS, every S3 bucket now applies **SSE-S3** (S3-managed keys, AES-256) to all new objects automatically, at no additional cost and with no performance impact; it cannot be disabled. This is *not* a KMS key. SSE-KMS with the AWS-managed `aws/s3` key is a separate, optional setting that adds KMS request charges and CloudTrail key-usage visibility. Because the stated intent is "nothing custom, just the default", the plan is **SSE-S3 (the bucket default), no bucket encryption configuration required**. If KMS-level audit trails are wanted later, switching the bucket default to SSE-KMS (`aws/s3`) is a configuration change that needs no client changes.
_Source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-encryption-faq.html_

### What this removes from the plan
- Crates `chacha20poly1305` and `argon2` (and the associated test vectors / tamper tests / nonce rules).
- Key generation, wrapping, distribution, recovery code UX, key rotation and device-revocation re-encryption.
- AAD binding of `(account, device, seq, schema_version)`; segments are now plain compressed bytes, so integrity relies on TLS in transit, S3's own checksums, and per-device contiguous `seq` / hash checks in the log.
- Risk R5 (key loss locks user out) disappears.

### What it makes more important (security posture changes)
- **Isolation is now the only barrier between users' plaintext financial data.** R6 (cross-tenant exposure via IAM mistake) goes from "leaks ciphertext" to **"leaks readable records"**: impact Critical, so the automated cross-tenant IAM test, `aud`/`amr` trust conditions, per-identity prefix policy, and block-public-access become mandatory release gates rather than hardening.
- **Operator access:** anyone with account-level S3 read (including the account owner and any admin role) can read all users' synced data. Restrict with least-privilege IAM, MFA on admin roles, CloudTrail data events on the bucket if auditing is wanted, and no broad `s3:GetObject` grants in CI roles.
- **Legal/trust:** README ("no cloud account for your records... no sync"), Privacy Policy and Terms of Service must state that synced data is stored in Nixus-operated AWS storage, encrypted at rest by AWS, and technically accessible to Nixus. Sync is premium and opt-in, which keeps local-only users unaffected.
- **Bucket hygiene:** block public access, versioning decision (adds storage but protects against accidental overwrite/delete), lifecycle rules for expired segments and incomplete multipart uploads, bucket policy denying non-TLS requests.

### Revised crate list (Step 5 table)
Drop: `chacha20poly1305`, `argon2`. Keep: `aws-sdk-s3`, `aws-sdk-cognitoidentity`, `uhlc`, `uuid` (v7, v5), `proptest`, plus a compression crate (to be chosen). `rusqlite` features `preupdate_hook`, `hooks`, `uuid`.

### Revised Phase plan
- **Phase 0b** simplifies: Cognito identity pool + S3 bucket (default encryption) + IAM role + snapshot upload/restore. No key UX.
- A future privacy-tier (client-side or passphrase encryption) remains possible by adding an encrypt/decrypt step in `segment.rs`; the segment/snapshot format should reserve a header byte for `encryption_scheme` (0 = none) so this can be introduced without a format break.

### Open items
- ~~Confirm SSE-S3 vs SSE-KMS `aws/s3`~~ **Resolved 2026-10-13: owner confirmed SSE-S3 (S3-managed keys, the bucket default).** No KMS, no bucket encryption config needed.
- ~~Premium gating at IAM level~~ **Resolved 2026-10-13:** for now, sync is for premium accounts only, enforced as today's in-app entitlement. No IAM-level tier claim is needed yet.
- **Future (noted, out of scope now):** Nixus Cloud tiers Classic / Advance / Privilege; only **Advance and Privilege** will include sync. Keep the entitlement check behind a single capability flag (for example `multi_device_sync`) rather than a hard-coded "premium" test, so the tier mapping can change without touching sync code. IAM-level enforcement can be added later if wanted.

---

## Spike Result: Pre-Update Hook Coverage (2026-10-13, executed)

Throwaway test (rusqlite 0.38, `bundled` + `preupdate_hook`, in-memory DB, `foreign_keys=ON`; code discarded). Events counted per statement:

| Statement | Hook events | Verdict |
|---|---|---|
| plain INSERT / UPDATE | 1 each | OK |
| `INSERT OR REPLACE` (PK conflict) | DELETE + INSERT | **Captured** |
| `INSERT OR REPLACE` (UNIQUE conflict, new id) | DELETE + INSERT | **Captured** |
| `INSERT ... ON CONFLICT DO UPDATE` | UPDATE | OK |
| `DELETE parent` with `ON DELETE CASCADE` + `SET NULL` children | DELETE parent, UPDATE nullp, DELETE x2 child | **Cascades captured** |
| `DELETE FROM t` (no WHERE) | one DELETE per row (5 of 5) | **Captured** (no truncate-optimisation bypass) |
| WITHOUT ROWID insert / update / delete | 1 each | **Captured** |
| `BEGIN; INSERT; ROLLBACK` | 1 INSERT event fired | **Fires before commit** |

**Conclusion:** the earlier risk (hook missing REPLACE / bulk delete / cascades / WITHOUT ROWID) did **not** materialise. Capture by pre-update hook is viable.

**One new requirement found:** events fire *before* commit and also for transactions that later roll back. Buffered events must be discarded on rollback (register a rollback hook, or flush the buffer only from the commit path) so `sync_log` never records changes that did not happen.

**Still unmeasured:** hook overhead on Nixus's real write paths (single insert, 1,000-row import, `danger_zone` reset) and apply-batch lock time; these remain the performance gates for Phase 0a.

---

## Feasibility Measurements: "Within Seconds" on a Heavy Year of Data (2026-10-13, executed)

Throwaway benchmarks (discarded after use). Machine: this Mac (Apple-silicon class). Network figures are real RTT measurements from this machine; bandwidth rows are modeled.

**1. Real dataset sizes (read-only, sizes and counts only).** Largest real Nixus dataset on this machine: 5.5 MB total, of which 2.5 MB is two project images; **372 KB without images** (324 expenses, 90 chat messages). Default dataset: 286 KB. Project thumbnails are 9-12 KB each.

**2. Synthetic "very heavy year"** built from the real migration schema: 6,000 expenses, 15,000 audit rows, 5,000 chat messages (up to ~200 words each), 40 categories, 8 accounts, no images.

| Measure | Result |
|---|---|
| Database file | **9.99 MB** (about 27x the real non-image data) |
| Compressed (zstd-3 / zstd-9 / gzip-6) | **1.82 MB** / 1.67 MB / 1.71 MB |
| Decompress to disk | 0.019 s |
| `quick_check` / `integrity_check` after restore | 0.011 s / 0.019 s |
| 20 MiB of incompressible images (5 x 4 MiB cap) | compresses to 20.0 MiB: **must not be in the bootstrap path** |

**3. Network RTT from this machine to AWS (fresh connection, includes DNS + TLS):** Cognito Identity us-east-1 0.19 s; S3 us-east-1 0.16 s; S3 ca-central-1 0.15 s.

**4. Capture overhead (pre-update hook buffering all columns + one `sync_log` row per column, same transaction):**

| Operation | Baseline | With hook + log | Verdict |
|---|---|---|---|
| Single-row insert transaction (n=6,000) | p50 18 us, p99 54 us | p50 36 us, p99 74 us | about +18 us; imperceptible |
| 1,000-row import in one transaction | 2.2 ms | 6.8 ms | negligible |

**5. Apply (replay) speed** of remote LWW messages with de-dup, 500 per transaction (simplified: one table, no FK or tombstone work): about **0.92-0.99 million messages/s** (100k in 0.10 s; 1M in 1.09 s). A full-year log of roughly 180k messages replays in about 0.2 s here; assuming 10x slower for the real multi-table apply and 3-5x slower hardware, still about 1-3 s worst case.

**6. Modeled time from "login complete" to "data usable" on a brand-new computer (heavy year, images excluded, snapshot-first bootstrap):**

| Step | Time |
|---|---|
| Cognito Identity `GetId` + `GetCredentialsForIdentity` | about 0.3 s (0.19 s measured first call; second reuses the connection) |
| Read snapshot pointer / head from S3 | about 0.16 s |
| Download 1.8 MB snapshot | 100 Mbps: 0.15 s; 25 Mbps: 0.6 s; 10 Mbps: 1.5 s |
| Decompress + write + integrity check + open | about 0.05 s here; budget 0.3 s on slow hardware |
| Catch-up segments after the snapshot (cap about 2 MB, parallel) | similar to one snapshot download |
| **Total** | **about 1.2 s (100 Mbps), 2.1 s (25 Mbps), 4.1 s (10 Mbps)** |

Excluded from this budget: the interactive Cognito login itself (browser/Hosted UI), and the very first upload from the first device.

### Conclusion
Feasible, but only with these conditions (they become requirements):
1. **Snapshot-first bootstrap is mandatory, not optional.** One compressed object (zstd) plus a small pointer. Pure log replay is CPU-cheap but needs many requests and unbounded download size.
2. **Bound the tail:** write a new snapshot when the post-snapshot log exceeds about 2 MB or about 5,000 messages, so catch-up is always one small parallel fetch.
3. **Images stay out of the bootstrap path:** snapshot carries thumbnails (about 10 KB each) and image bytes are fetched lazily as separate content-addressed objects (the existing schema stores full images as BLOBs in `project_images`, so the snapshot builder must strip them and the app must show a placeholder until fetched). Worst case 20 MiB would add about 6.7 s at 25 Mbps.
4. **Prefer fewer, larger requests:** reuse HTTP connections, fetch tail segments in parallel, show the app as soon as the main database is restored.
5. **Define the promise precisely:** typically under 5 seconds on 10 Mbps or better, for up to about 10 MB of data, from login completion to usable app, once the first device has finished its initial upload. The first device's initial upload (about 1.8 MB heavy year; images separate) happens in the background and is the one case where a second computer must wait.
6. **Stale-snapshot caveat:** a new computer sees data as of the last upload from the other devices; changes made offline on another computer appear when that computer next syncs.

Not measured: real Windows hardware, real S3 download speeds at various bandwidths, true multi-table apply cost, memory use on very large chat tables.
