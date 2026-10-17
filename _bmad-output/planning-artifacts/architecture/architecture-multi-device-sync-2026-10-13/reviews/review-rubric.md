---
review: rubric-walker
target: _bmad-output/planning-artifacts/architecture/architecture-multi-device-sync-2026-10-13/ARCHITECTURE-SPINE.md
reviewer_mode: independent rubric walk (8-point checklist)
date: '2026-10-13'
verdict: revise-before-story-writing
counts: { critical: 2, high: 8, medium: 9, low: 7 }
---

# Rubric Review — Architecture Spine: Nixus Cloud Multi-Device Sync

## Verdict

An unusually disciplined spine — right paradigm for the constraint set, brownfield facts that
check out under grep, and a stack table whose nine versions are *exactly* today's crates.io
max-stable — but **not yet buildable as written**: two critical defects (row identity for
natural-key tables is derived from columns the spine itself declares device-local; peer
discovery is not implementable under its own no-LIST rule), eight highs concentrated in the
snapshot / retention / durable-state seams, and two spec constraints that never landed.

## Rubric Scorecard

| # | Checklist item | Verdict | Where it fails |
| --- | --- | --- | --- |
| a | Fixes the real divergence points for the level below; misses none | **Partial** | Capture/merge/transport/auth/bootstrap are all pinned. Missed: the durable record behind delete-wins + reconcile (H3), snapshot content boundary (H1), schema-evolution contract once a table is Synced (M4), the wire payload encoding (M1) |
| b | Every AD's Rule is enforceable and prevents its stated divergence | **Fail** | AD-2 (C1), AD-6 discovery (C2), AD-3 reconcile cannot compute what AD-5 requires (H3), AD-10 unimplementable vs live DDL (H2), AD-15 `epoch_reset` has no semantics (H4) |
| c | Nothing under Deferred could let two independent units diverge | **Fail** | Payload encoding is the cross-unit contract (M1); "other accumulating columns" leaves CAP-4's money criterion unmet by construction (M2) |
| d | Named tech is verified-current | **Pass** | All nine verified against crates.io: rusqlite 0.40.2, uuid 1.28.0, zstd 0.14.2, uhlc 0.9.0, aws-sdk-s3 1.152.0, aws-sdk-cognitoidentity 1.116.0, proptest 1.12, tauri 2.11 (= manifest pin), aws-config 1.8 (= manifest pin). Two caveats in L4 |
| e | Ratifies rather than contradicts the brownfield and the two parents | **Partial** | Brownfield counts are accurate (FK edges, ~230 statements, DbState shape, 28 migrations). Contradicts the live `project_images` DDL (H2) and misdescribes `backup.rs`'s restore as an atomic replace (H5) |
| f | Covers CAP-1..CAP-9 | **Pass (capability) / Partial (criteria)** | All nine CAPs mapped with ADs attached. Success criteria left ungoverned: CAP-2 timing test, CAP-4 simulator, CAP-3 latency budget (M3); CAP-1's non-blocking clause cites no AD (L3) |
| g | No new AD weakens or contradicts an inherited one | **Fail** | Cloud Bedrock AD-1 ("no AWS credential, static **or temporary**, on a device") is absent from the Inherited table while AD-7 vends exactly that, and AD-7's Prevents silently narrows it to "long-lived" (H8) |
| h | Every structural dimension the altitude owns is decided, deferred, or an open question | **Partial** | Deployment & environments: decided (AD-17 + single-environment inherited; region deferred with a deadline). Infra/provider strategy: decided (separate compute-free SAM stack, GitHub OIDC, Retain). **Operations: neither decided nor deferred** (H7) — no metrics, alarms, budget, rollout gate beyond CAP-9, runbook, or diagnostics export (H6). No Open Questions section at all (M9) |

---

## CRITICAL

### C1 — AD-2: the natural-key UUIDv5 is derived from device-local integer ids, so it does not converge, and the surviving UNIQUE constraints turn that into a hard apply failure

AD-2 states two things that cannot both hold: "the integer `id` and all existing FKs are
unchanged and **local-only**", and "Tables with a non-PK UNIQUE natural key
(`merchant_category_hints (merchant, budget_category)`, `maintenance_tasks (vehicle,
task_type_key)`) derive `uuid` as UUIDv5 over the natural key … so concurrent creation
addresses one row."

Verified against the live schema:

- `migrations/015_merchant_category_hints.sql:9` — `UNIQUE(merchant, **budget_category_id**)`
- `migrations/018_maintenance_tables.sql:22` — `UNIQUE(**vehicle_id**, task_type_key)`

Both natural keys are *half device-local integer FK*. `budget_category_id` and `vehicle_id`
are AUTOINCREMENT rowids minted independently per device (and `budget_categories.id` /
`budget_groups.id` are bare `INTEGER PRIMARY KEY` — rowid aliases that even *reuse* ids after
deletion, `migrations/002_budget_tables.sql`). So two devices hashing "the natural key" produce
**different** UUIDv5s for the same logical row. AD-2's stated Prevents — "duplicate rows from
independent creation of the same natural-key row" — fails exactly where it was aimed.

It fails loudly, not silently: AD-2 keeps the existing constraints, so when the two
differently-uuid'd rows meet, `sync::apply` hits `UNIQUE constraint failed` and AD-11's
500-message transaction aborts. There is no conflict path for a constraint violation anywhere
in the spine (AD-11 handles missing parents, unknown tables/columns, duplicates by `msg_id` —
not constraint rejection).

The enumeration is also incomplete. `migrations/026_project_images.sql:2` makes the natural key
*the primary key*: `project_id INTEGER PRIMARY KEY REFERENCES projects(id)`, with the DDL
comment "the primary key IS the at-most-one-image-per-project rule". AD-2's filter — "non-PK
UNIQUE natural key" — excludes it by construction, so two devices attaching an image to the
same project collide on the PK with no rule covering it.

**Direction:** derive UUIDv5 over `(parent_uuid, natural_key_text)` in the fixed namespace, and
select the table list by "rows that are semantically single", not by the presence of a SQL
`UNIQUE` clause — which is what the abbreviation in L1 hides.

### C2 — AD-6: peer discovery is not implementable under its own rule, so a newly linked device can be invisible to the first one indefinitely

AD-6: "Discovery polls `head/*` with conditional GETs (`If-None-Match` → `304`); LIST is a
repair path only, **never on the polling path**."

A conditional GET requires an exact key. `head/*` is not a thing you can GET — it is a thing you
LIST. So a device can only poll the installs it already knows about, and the spine publishes
exactly one install index: the snapshot watermark vector (AD-9), which is written only when a
snapshot is cut — "the tail exceeds 2 MB or 5,000 messages" (AD-9) — and which AD-13 then
*prunes* installs out of. A second device that enables sync writes `head/<B>` and
`log/<B>/<seq>`; device A never learns the key `head/<B>` exists. Nothing in AD-6, AD-9 or AD-13
says an existing device re-reads `snap/LATEST`, and nothing says a joining device writes a
snapshot to announce itself.

This is inherited, not invented: the companion research moved discovery from "readers LIST and
fetch what they lack" (research line 237) to "poll peers' `head/<device>` objects … no LIST"
(line 66) on cost grounds (line 438: LIST is billed at the PUT rate, 12.5× a GET) without
replacing the enumeration step.

It defeats the spec's headline success signal ("two computers edited independently … end up with
the same data") for the first-ever second device, which is the only path CAP-2 describes.

**Direction:** cheap to close — one mutable `installs` index object maintained with `If-Match`
CAS (the primitive AD-6 already uses for `snap/LATEST`), or an explicitly bounded LIST of
`head/` at enable + app start only, which keeps the cost model intact (one LIST per launch is
noise against the ceiling in H7).

---

## HIGH

### H1 — AD-9's snapshot is a whole-database copy, so it ships every table AD-5 declares LocalOnly, including `sync_log`

AD-9: "A snapshot is `zstd` of a consistent SQLite copy (`VACUUM INTO` or the backup API) with
project image bytes removed and thumbnails kept." `VACUUM INTO` copies *the whole file*. The
only exclusion named is image bytes.

AD-5 classifies as `LocalOnly`: "`audit_log`, `config`, `schema_version`, all `sync_*` tables",
and its Prevents includes "a local-only table leaking to the cloud." The two rules are in direct
conflict:

- `audit_log` (written on every mutation, `db/audit.rs:14`, with `entity_id` holding *local*
  integer ids) is uploaded and then restored onto a different device, where those ids mean
  something else.
- `config` carries local preferences and `onboarding_completed` (parent spine AD-13).
- `sync_state`, `sync_log`, `sync_pending`, `sync_row_state` (AD-15) ride along — so the
  snapshot contains the entire message log it exists to compact, and restoring it installs the
  *origin device's* install id and watermarks on the receiver. AD-15's regeneration-on-restore
  rule mitigates the identity half by accident, not by design.
- The size half is the CAP-2 problem: a "snapshot" that embeds the full log is not a bounded
  artifact, and CAP-2's 5 s / ~10 MB budget is measured against it.

**Direction:** make the snapshot's content boundary an explicit rule — built from Synced tables
only, and restore preserves the receiver's own LocalOnly rows rather than overwriting them.

### H2 — AD-10 is unimplementable against the live `project_images` DDL, and the migration it needs is named nowhere

AD-10: "Image bytes are never in snapshots or segments. `project_images` carries the thumbnail
and `sha256`; the full image is `blob/<sha256>`." AD-9: "with project image bytes removed."

The live table (`migrations/026_project_images.sql`) forbids both:

```sql
image_bytes BLOB NOT NULL,
CONSTRAINT project_images_byte_size_positive  CHECK (byte_size > 0),
CONSTRAINT project_images_byte_size_matches_payload CHECK (byte_size = length(image_bytes)),
```

You cannot null out `image_bytes` in the snapshot copy, and a restored device cannot hold a row
whose bytes are absent-pending-fetch. AD-10 therefore requires: `image_bytes` made nullable, a
new `sha256` column, and 026's three named CHECKs relaxed. Migration 027's own header records
the cost of exactly that: "the `CONSTRAINT <name> CHECK (...)` form … is unavailable without
rebuilding the table and **rewriting every stored blob**."

AD-2's migration adds only `uuid`. No AD names this rebuild, and CAP-6 *and* CAP-2 both rest on
it. (Related: the `sha256` is also the only self-verifying object in the format — see M6.)

### H3 — The durable record that delete-wins, 30-day restore, and reconcile all depend on has no owner, and its declared schema cannot do the job

Three rules lean on persistent state that the spine never assigns:

1. **`sync_row_state` has no writer.** The Consistency Conventions name writers for `sync_log`
   (capture), the tables (apply), `sync_state` and `head` (manager) — "One writer per concern."
   `sync_row_state` is read by AD-3's reconcile pass and written by nobody. For reconcile to be
   sound both capture *and* apply must maintain it.
2. **A `content_hash` cannot reconstruct a `Counter` delta.** AD-3 declares
   `sync_row_state(table, row_uuid, content_hash)`. AD-5 requires `accounts.balance_cents` to be
   recorded as `new − old`. A hash is not invertible, so for any write that escapes
   `ActiveDataset::write` — the exact case reconcile exists for, and AD-3 concedes adoption is
   incremental across the ~230 call sites (verified: 235 `execute*`/`execute_batch` sites in
   `db/*.rs`) — reconcile can detect "this row changed" and cannot emit the delta. It must
   either drop the money movement or re-emit an absolute LWW write, which contradicts AD-5 and
   breaks CAP-4's "account balances equal the sum of all changes."
   *(The happy path is fine: `db/account.rs:213` already returns `(old_balance_cents, …)` and the
   pre-update hook exposes old and new, so a captured delta is exact. It is only the reconcile
   backstop that cannot produce one.)*
3. **Tombstones have no store.** AD-5 promises "tombstoned rows stay restorable for 30 days" and
   AD-12 requires "a child message for a tombstoned parent is dropped" — both need a durable
   tombstone record. AD-15 lists the sync tables (`sync_state`, `sync_log`, `sync_pending`,
   `sync_row_state`); none is designated for this, and `sync_log`'s own retention after
   segmentation is never stated while AD-13 expires segments at 90 days. Worse, AD-12 applies a
   parent tombstone and lets local FK `CASCADE` remove the children "hook disabled, nothing
   re-emitted" — so cascaded children get **no** tombstone, are not restorable, and cannot be
   matched by the child-drop rule on a later replay.

**Direction:** name the durable row-state/tombstone table, its writers, its retention (≥ the
30-day restore window and ≥ the replay horizon), and store the last-applied Counter *value*, not
just a hash.

### H4 — AD-15's `epoch_reset` has no apply semantics, and the rule omits the capture suppression it depends on

AD-15: "`danger_zone` wipe of a synced dataset writes one `epoch_reset` message and the sync
tables are included in `WIPE_TABLES` coverage." That is the only mention of `epoch_reset` in the
spine. Unresolved:

- **What a receiver does with it.** Wipe its own tables? AD-11's rule for a message it does not
  recognise is to park it, never discard — so the most destructive message in the protocol is
  also the one most likely to sit in `sync_pending`. Ordering against concurrent edits,
  interaction with delete-wins, and whether the 30-day restore window applies are all undefined.
  A one-device wipe silently wiping every device is a product-level decision, not an
  implementation detail, and it is neither decided nor deferred.
- **Capture suppression is missing.** `db/danger_zone.rs:48-60` wipes with
  `DELETE FROM <table>` (no `WHERE`) across 20 tables in one transaction. Per the SPEC's own
  assumption the pre-update hook sees `DELETE` without `WHERE`, so unless AD-15 *also* disables
  capture for the wipe, the buffer flush writes a tombstone per row — precisely the "wiping data
  producing thousands of tombstones" the AD claims to prevent. The rule never says so.
- **`WIPE_TABLES` coverage is ambiguous.** The live test asserts
  `WIPE_TABLES + PRESERVED_TABLES` is exhaustive against the schema
  (`db/danger_zone.rs:15-42`, `PRESERVED_TABLES = ["config", "schema_version",
  "sqlite_sequence"]`). "Included in coverage" does not say which list. If `sync_state` is
  *wiped*, the install id and `seq` are destroyed inside the same operation that is supposed to
  emit `epoch_reset` from that install — and AD-15's own regeneration rule covers restore,
  backup import and copy, but not wipe.

### H5 — AD-9 misdescribes `db/backup.rs`'s restore as an atomic replace, and nothing orders it against AD-11's second connection

AD-9: "restores through `db/backup.rs`'s safe-swap sequence (checkpoint, safety copy, **atomic
replace**, migrate, rollback on failure)."

`db/backup.rs::restore_from_file` actually does: `PRAGMA wal_checkpoint(TRUNCATE)` → replace the
slot's `Connection` with a placeholder and **drop** it → `fs::copy(db_path, safety_path)` →
`fs::copy(backup_path, db_path)` — an **in-place overwrite, not a rename** → `open_configured` →
delete the safety copy (lines 23-71). Two consequences:

- It drops *the one connection in `ActiveDataset`*. AD-11's apply connection lives outside that
  slot, so the restore overwrites a file another open connection holds: on Windows a sharing
  violation (or a half-written file), and in general a live connection with a stale page cache
  against replaced content. The checkpoint can also fail to truncate while a second reader holds
  a snapshot, leaving a WAL that replays over the new file.
- AD-11 only says the extra connection "is closed on `dataset:switched`" — an event the actor
  observes *after* the swap has already happened. There is no quiesce-and-acknowledge step, so
  the window is real for both the restore path (AD-9, CAP-5's replace branch) and every dataset
  switch.

**Direction:** one explicit ordering rule — the sync actor must be stopped and its connection
closed and confirmed before any restore or hot-swap — and correct AD-9's description of the
brownfield sequence it is ratifying.

### H6 — The spec's "redacted diagnostics export" constraint is absent from the spine entirely

SPEC Constraints: "Sync problems must be diagnosable without exposing user content (a redacted
diagnostics export)." The spine has no mention — not an AD, not a line in Deferred, not an open
question. AD-16's "Log lines never contain row values" is the redaction half with the export half
missing, and the research named the artifact explicitly ("a 'Sync diagnostics' export", research
line 407). A constraint the spec states flatly should at minimum appear as a decided surface or a
dated deferral.

### H7 — The cost ceiling is a Deferred tuning note rather than a control, operations is undecided, and object retention is incomplete so storage grows without bound

- **Cost.** The spec constrains "under about $0.10 per active sync user per month … request
  counts such as polling interval are the lever." In the spine this appears only as Deferred:
  "Poll interval and segment cut cadence — tune against the cost ceiling in the spec." No rule,
  no ceiling, no cap. The parent Cloud Bedrock spine made exactly this an AD (its AD-14: global
  hard cap enforced in-transaction, plus a $50/mo budget with 80/100% alerts, plus alarms); the
  sync spine's AD-17 defines bucket, identity pool and role and stops there. There is no
  per-account object or byte cap, so a looping client is bounded by nothing.
- **Retention is partial.** AD-13 lets a snapshot writer "delete segments older than 90 days".
  Nothing ever deletes superseded `snap/<snap-id>` objects or orphaned `blob/<sha256>` objects.
  AD-17's lifecycle rules ("noncurrent versions expire after 30 days") do not apply — these are
  distinct keys, not versions of one key. For a ~10 MB dataset cutting a new snapshot every 2 MB
  of tail, stored snapshots accumulate indefinitely, and blobs survive their projects forever.
  The research flagged reference-counted blobs at compaction (line 402); the spine dropped it.
- **Operations as a dimension (checklist h) is neither decided nor deferred.** No S3 request or
  storage metric, no budget or alarm, no rollout gate beyond CAP-9's denial test, no runbook —
  and nothing (H6) that answers "is sync broken for this user". The research proposed "optional
  CloudWatch S3 request metrics for cost watch" (line 407).

### H8 — The inherited invariant that most directly conflicts with this design is missing from the Inherited Invariants table, and AD-7 silently narrows it

Cloud Bedrock AD-1 reads: "**Prevents:** any AWS credential, **static or temporary**, being
vended to or cached on a device. **Rule:** the desktop never holds an AWS credential; Bedrock is
only called from the Lambda using its execution role."

AD-7 vends precisely that: identity-pool enhanced flow, "Temporary credentials (1 h) live only
in memory." The Inherited Invariants table carries nine rows (parent AD-1, AD-6, AD-8, AD-12 from
Local Profiles; AD-10, AD-11, AD-12, AD-13, AD-15 from Cloud Bedrock) and **omits the parent's
AD-1**. AD-7's own Prevents restates it as "**long-lived** AWS credentials on a device" — the
parent's "static *or temporary*" quietly dropped.

The decision is defensible: device-held scoped credentials are *how* the spec's "no application
server in the sync path" constraint is met, and the parent's AD-1 was bound to "every hosted
Bedrock invocation path". But this is the single largest posture change against the inherited
Cloud spine, and the Inherited table is exactly where a story-writer will look for it. It needs a
row stating the scope boundary — the no-credential rule still binds the *Bedrock* path and is
scoped away for the *sync* path — rather than silence plus a reworded Prevents.

---

## MEDIUM

### M1 — The one Deferred item that is a cross-unit contract: binary payload encoding

Deferred: "**Binary payload encoding and compression level** — chosen in the first implementation
story, then frozen with the format version." The payload encoding is what `capture`, `segment`,
`snapshot` and `apply` must agree on; it is the interop surface between four modules and between
app versions. The mitigation ("chosen in the first story") is a sequencing wish, not an
invariant — any two units built in parallel can diverge, and the Consistency Conventions restate
the deferral rather than closing it. Name the format (or the closed candidate set plus the
tiebreak rule) in the spine.

### M2 — "Other accumulating columns" deferral leaves CAP-4's money criterion unmet by construction, and the real hazard is wider than accumulation

Deferred: "audit before Milestone 2; until then only `accounts.balance_cents` is a `Counter`."
Everything else is LWW in the interim, so CAP-4's "balances combine as additions and
subtractions … 0 edits lost" holds for exactly one column. The deferral also frames the problem
as *accumulating* columns, which misses the sharper case in the live schema:
`net_worth_snapshots.breakdown_json TEXT NOT NULL` (`migrations/008_net_worth_snapshots.sql`) is
an entire document in one column, so the spine's per-field HLC granularity degenerates to
whole-document LWW and concurrent edits to different parts of the breakdown are lost silently.
That table also has no uniqueness on `snapshot_date`, so two devices produce duplicate same-date
snapshots (related to C1's enumeration problem). AD-5's registry needs a third hazard class
(composite/document columns), not just `Lww | Counter | Tombstone`.

### M3 — Only one of four testable success criteria is bound to a gate

AD-7 ends with "An automated cross-account denial test is a release gate" — exactly right, and
it makes the omissions conspicuous. Ungoverned: CAP-2's "Verified by an automated timing test
against a heavy-year dataset" (no AD, no gate, no owner; the 5 s target appears only inside
AD-9's *Prevents* prose), CAP-4's "randomized multi-computer simulator … 0 edits lost" (hinted
only by `proptest 1 (dev)` in the Stack), and CAP-3's "local write latency shows no perceptible
change (baseline about +18 µs per insert)" (no budget, no regression test). AD-5's and AD-12's
completeness tests show the spine knows how to express a binding test; these three deserve the
same treatment.

### M4 — Version skew is covered in one direction only, and there is no contract on what a migration may do once a table is Synced

AD-11 handles the old-device direction well (unknown table/column/newer `schema_version` → park,
never discard, `update_needed` via AD-16). The reverse is unaddressed: a *newer* device receiving
messages that name a column a migration renamed or rebuilt away parks them forever with no
recovery path and no status that applies (it is not the one needing an update). There is also no
rule constraining migrations themselves once a table is Synced — which matters here because the
brownfield's established style *is* table rebuilds: `004_recreate_expenses_table.sql` and
`012_income_entry_date.sql` both create-copy-drop-rename. The research proposed a sealed-epoch
release process for semantic migrations (lines 390-393); the spine carries neither that nor an
alternative.

### M5 — Nothing bounds write-lock contention between the apply connection and the UI connection

AD-16 promises sync "never blocks" the UI and CAP-3 budgets local write latency; AD-11 has the
apply connection take the SQLite write lock for "at most 500 messages per transaction" against
the same file the UI writes. Batch *size* is not a latency bound — a 500-message transaction's
duration is unbounded, and the UI connection's `busy_timeout` converts contention into a visible
stall rather than an error. Missing: a max transaction duration or wall-clock yield, and a
back-off rule when a UI write is waiting.

### M6 — The segment/snapshot header carries no content digest and no binding to its key position

AD-8's header is "magic, format version and `enc_scheme`". With client-side AEAD correctly
dropped (the spec mandates SSE-S3 only), the research's authenticated-metadata property goes with
it — it bound `(account, device, seq, schema_version)` as AAD specifically to prevent a segment
being replayed under another position, and to make corruption detectable (research lines 280,
361). As it stands a truncated or corrupted segment is indistinguishable from a valid one, and
`blob/<sha256>` is the only self-verifying object in the format. A digest field plus the
`(install, seq)` tuple inside the header is nearly free and belongs in the frozen v1 format
rather than in a later version bump.

### M7 — The deferred region decision is baked into the key layout more tightly than the deferral admits

Cognito identity ids are region-prefixed (`us-east-1:<uuid>`), and AD-6 puts the identity id in
every key: `acct/<identity-id>/`. So region is not a redeploy-time choice — changing it after the
first deploy orphans all stored data under the old prefix and invalidates AD-7's IAM resource
pattern. The deferral also carries a live unknown forward ("cross-region identity-pool federation
is unverified") behind what is labelled a merely pending decision. Either resolve it before
anything is written, or state the data-migration consequence in the deferral.

### M8 — "Local-only users and datasets are unaffected" is a spec constraint that never became an invariant

The spec states it flatly; the spine conveys it only as an inherited-row aside ("Only
`kind: cloud-linked` datasets are eligible to sync"). No AD owns it, and nothing tests it.
Meanwhile two mechanisms do land on every dataset: AD-2's `uuid` migration runs for local-only
datasets, and AD-3's `ActiveDataset::write` adoption rewrites write paths used by all of them.
That is defensible — but it means the boundary ("local-only users pay a schema column and a
refactor, and zero runtime cost") should be an explicit rule with a test, not an inference.

### M9 — No Open Questions section, so the spec's architecture-bearing questions are neither answered nor carried

The spec lists seven open questions; three bear on this altitude and none has a home in the
spine. "Is polling-interval propagation latency acceptable, or is near-instant needed (which
would require a push server)?" — the question that decides whether the transport port ever needs
a push adapter — is unaddressed. "What retention window governs log cleanup?" is in fact answered
(AD-13's 90 days) but not linked back as an answer. And "Does 'frozen but readable' after
downgrade mean the user can still restore from the cloud copy on demand?" is silently answered
**no** by AD-14 ("no uploads or downloads"), without noting it is closing a spec question — the
kind of quiet resolution a reader will later mistake for an oversight.

---

## LOW

- **L1 — AD-2's column names are abbreviated in a way that hides C1.** The spine writes
  `merchant_category_hints (merchant, budget_category)` and `maintenance_tasks (vehicle,
  task_type_key)`; the live constraints are `(merchant, budget_category_id)` and `(vehicle_id,
  task_type_key)`. Dropping the `_id` suffix is what makes a device-local FK read like a natural
  key. Use the real column names.
- **L2 — AD-5's completeness test needs a defined table source.** "A test fails if any migrated
  table is unclassified" — every table uses AUTOINCREMENT, so the live DB also contains
  `sqlite_sequence`, which exists in `sqlite_master` but in no migration.
  `db/danger_zone.rs:42` already had to name it in `PRESERVED_TABLES`; mirror that precedent so
  the new test does not fail on a table no migration created.
- **L3 — Capability map gaps at criterion level.** CAP-1's success criterion includes "starts a
  background upload **without blocking the UI**", governed by AD-16 — which binds CAP-3 and CAP-7
  only. Add AD-16 to the CAP-1 row.
- **L4 — Stack table: currency verified, two coherence notes.** All nine new/updated versions
  match today's crates.io max-stable exactly (rusqlite 0.40.2, uuid 1.28.0, zstd 0.14.2,
  uhlc 0.9.0, aws-sdk-s3 1.152.0, aws-sdk-cognitoidentity 1.116.0, proptest 1.12; tauri 2.11 and
  tokio 1.50 match the manifest pins) — checklist (d) passes cleanly. Two notes: (i)
  `aws-config 1.8 (existing)` is pinned at 1.8.15 in `Cargo.toml` while current is 1.12.0, and
  pairing a 1.8.x `aws-config` with brand-new s3/cognitoidentity crates is an unverified
  smithy-generation mix that may force a shared-dependency bump the spine does not acknowledge;
  (ii) `rusqlite 0.38 → 0.40` is two breaking releases across 24 `db/*.rs` files and the ~125
  `State<DbState>` access sites the parent spine enumerates, carried as a one-line Stack row with
  no AD and no mention of blast radius.
- **L5 — `AppError::Sync` vs the parent's convention line.** AD-16's new variant follows the live
  `HostedAi` / `AiService` precedent in `error.rs` and is the right call, but the Local Profiles
  spine states a "no new `AppError` variant" convention; one sentence noting that convention was
  feature-scoped avoids a later reviewer re-litigating it.
- **L6 — AD-11 misquotes the parent rule it claims to except.** Local Profiles AD-6 prevents *two
  datasets'* connections being open at once and keeps id+conn behind one lock; it never states
  "one connection per dataset". Declaring an exception to a rule the parent did not write is
  conservative rather than wrong, but it muddies what is actually being amended (and the real
  hazard it creates is H5, which the exception does not cover).
- **L7 — One research-flagged unknown is presented as settled.** AD-6's entire polling path rests
  on S3 conditional GET (`If-None-Match` → `304`), which the research listed under "not verified
  this step" (line 291). It is correct S3 behaviour, but a spine that elsewhere records
  verification state (AD-7's enhanced-flow detail, the dated research companion) should say so
  here too.

---

## What is solid (so the verdict reads correctly)

The brownfield grounding is better than most spines of this altitude, and it holds up to
verification:

- **FK edge counts are exact.** AD-12's "one `RESTRICT` edge
  (`project_contributions.account_id → accounts`)" and "four `SET NULL` edges" match the
  migrations precisely: one `ON DELETE RESTRICT` (`025_projects.sql:17`) and exactly four
  `ON DELETE SET NULL` (`021` ×2, `023:6`, `024:6`). The per-edge policy table plus a test on
  unclassified edges is the right enforcement shape.
- **"~230 SQL statements" is accurate** — 235 `execute*`/`execute_batch` call sites across
  `db/*.rs` — and "28+ migrations" is exactly 28.
- **The inherited `DbState` shape is quoted correctly** (`DbState(pub Mutex<ActiveDataset>)`,
  `ActiveDataset { id: Option<String>, conn: Option<Connection> }`, `db/mod.rs:41-46`), and
  `datasets.rs` / `commands/datasets.rs` both exist — the parent spine is shipped, not planned,
  so the inherited invariants are real constraints rather than aspirational ones.
- **AD-5's Counter is sound on the happy path.** `accounts.balance_cents` exists
  (`005_accounts.sql`), is written as an absolute (`UPDATE accounts SET balance_cents = ?1`,
  `db/account.rs:77,230`), and `db/account.rs:213` already returns the old value — so the
  pre-update hook's old/new pair yields an exact delta. Only the reconcile backstop fails (H3).
- **No triggers exist in any migration and no `WITHOUT ROWID` table exists**, so AD-12's "hook
  disabled, nothing re-emitted" has no trigger-recursion hazard and the pre-update hook's
  rowid-table restriction is a non-issue. Worth stating in the spine as a verified precondition,
  since a future trigger would break AD-12 silently.
- **CAP-3's status indicator landed exactly.** AD-16's
  `idle | syncing | offline | update_needed | frozen | error` covers the spec's five states plus
  the one CAP-8 needs.
- **CAP-8 is cleanly covered** by AD-14's `Frozen` state plus AD-13's "Nothing is deleted for a
  `Frozen` account" — the cloud copy is retained and resumable, as the spec requires.
- **AD-7 is the strongest AD in the document:** enhanced flow named, basic flow explicitly
  disabled, resource scoped to `acct/${cognito-identity.amazonaws.com:sub}/*` with `ListBucket`
  conditioned on `s3:prefix`, trust policy pinning `aud` and `amr`, credentials memory-only, and
  a release-gated denial test. It is the template the rest of the document's testable claims
  should follow.
- **Deployment and infra/provider strategy (checklist h) are genuinely decided**, not hand-waved:
  a separate compute-free stack with no always-on resource, versioning plus lifecycle rules,
  `DeletionPolicy: Retain`, CI-only deploys through the inherited GitHub OIDC pipeline with the
  bootstrap role extension called out. Operations is the one dimension left open (H7).

## Recommended disposition

**Revise before story-writing.** C1 and C2 are design-level and cheap to fix (change the UUIDv5
input; add an installs index). H1-H5 are seam defects that each need one additional rule rather
than a redesign. H6-H7 are two dropped spec constraints plus the missing operations dimension.
H8 is one Inherited Invariants row and one corrected *Prevents* clause. The paradigm, the module
boundary, the transport keyspace, the isolation model and the stack all survive review intact.
