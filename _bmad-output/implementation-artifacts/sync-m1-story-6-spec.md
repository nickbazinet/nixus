# Story 6 — Sync state, entitlement flag and Frozen state (implementation spec)

Serves SPEC CAP-1 and CAP-8. Binding: AD-4 (install id + machine fingerprint), AD-14
(one capability flag, Frozen), AD-15 (state in the dataset DB, wipe unlinks), inherited
AD-12 (only `kind: cloud-linked` datasets are eligible to sync).

## 1. `sync_state` (migration 029, dataset DB)

Single row by schema (`CHECK (id = 1)`), named constraints:
`install_id` (AD-4, 8 random bytes as 16 hex chars), `machine_fingerprint` (sha256 hex,
64 chars — a one-way digest, never a raw hardware identifier), `identity_id` + `owner_sub`
(the AD-7 pin; both-or-neither), `link_state IN ('unlinked','linked')` with
`linked ⇒ pin present`, `frozen_reason IN ('entitlement_lapsed','owner_mismatch','support')`
(NULL = not frozen; a reason rather than a flag + reason pair), `created_at`/`updated_at`.
Added to `WIPE_TABLES` (AD-15: a wipe deletes the row, and an absent row *is* Unlinked).
SQL only in `db/sync_state.rs`. Tests: fresh DB, upgrade from v28, every CHECK, WIPE.

## 2. `AccountPinStore` over `sync_state`

`sync/state.rs` — `SyncStateStore { conn: Arc<Mutex<Connection>> }` (Send + Sync so Story 10's
actor is unconstrained; the lock is never held across an await). Implements Story 5's
`AccountPinStore`: `load` reads the pin, `store` routes through `verify_account_pin` and
refuses a mismatch instead of overwriting. `sync/clock.rs` gets AD-4's pure
`new_install_id()` / `machine_fingerprint(&MachineSignals)` and the regeneration rule.
`sync/auth.rs` gains one variant, `AuthError::StateUnavailable` (not retryable: a local DB
fault is not cured by re-vending).

## 3. Entitlement — one capability, no tier names

New crate-level `entitlements.rs`, wired into the *existing* mechanism (the only implemented
one: the Nixus Cloud account entitlement claim behind `ai::hosted_bedrock::premium_entitlement`,
cached per subject in `ai/hosted_state.rs`). `Capability` is an opaque newtype over a stable
name; `MULTI_DEVICE_SYNC = "multi_device_sync"`. The tier→capability mapping is ONE const
table in `entitlements.rs`; `sync/**` never names a tier (AD-14's stated prevention).

## 4. `SyncGate` + `GatedStore`

`sync/gate.rs`. Ports: `DatasetLink`, `CapabilitySource`, `SyncStateReader`.
`SyncGate::check(observed: Option<&AccountPin>) -> Result<(), SyncBlocked>` in this order:
cloud-linked → capability granted → not frozen → pin ok. `SyncBlocked::{LocalOnlyDataset,
CapabilityMissing, Frozen, PinMismatch, StateUnavailable}`. Order is load-bearing: a
local-only dataset short-circuits *before* the capability source, so no network client is
built and no state row is created for it.
`GatedStore<S: ObjectStore, G>` re-exposes all eight port methods, each behind `check`, and
returns `GatedError::{Blocked, Store, Auth}`. It does not implement `ObjectStore`, so the port
stays free of gate vocabulary. `S3ObjectStore::new` drops to `pub(in crate::sync)`.
Credential vending is gated by the same `check` via `SyncGate::vend`, which is the only
caller of `SyncCredentials::current_pinned` — vending is itself two identity-pool calls, so
AD-14's "no uploads or downloads" has to cover it.

## 5. Fitness guards (`sync/tests_gate_boundary.rs`)

1. every method of the `ObjectStore` trait is named in `gate.rs`'s production half (a new
   port method cannot ship un-gated); non-vacuous via a minimum count.
2. no file outside `src/sync/` names `ObjectStore`/`S3ObjectStore`/`GatedStore`.
3. `sync/s3.rs` declares `pub(in crate::sync) fn new(` and no bare `pub fn new(`.
4. `current_pinned` is named only in `sync/auth.rs` and `sync/gate.rs`.
5. no file under `sync/` names a product tier.
All six (incl. the WIPE coverage test) proved non-vacuous by deliberate mutation.

## 6. Behaviour tests

Counting fake `ObjectStore`: zero calls when Frozen, zero when local-only, zero when the
capability is absent; all methods reachable when the gate passes. Local reads/writes are
untouched (nothing in `db/` calls the gate). Leaving Frozen resumes. No Tauri command, no
UI, no i18n string, no `AppError::Sync` (Stories 10/11).

## Decisions (unattended, rules §6)

- D1 Spec self-approved; all goals kept; no HALT; one self-review pass; no review subagents.
- D2 The capability source is the existing account entitlement claim (`premium`) because it
  is the ONLY implemented entitlement authority in the repo; extending `apps/api-bedrock`
  is forbidden by the standing rules. Sync names only `multi_device_sync`.
- D3 `sync_state` goes in `WIPE_TABLES`, not `PRESERVED_TABLES`: AD-15 says the wipe unlinks.
- D4 Fingerprint signals are env-only (`COMPUTERNAME`/`HOSTNAME`/`HOST`, `USERNAME`/`USER`/
  `LOGNAME`, `target_os`) — no new dependency, no process spawn, nothing read from disk.
  Absent signals hash deterministically, so the failure direction is a *missed* relink
  rather than a spurious one. Taken as an explicit limitation of this story.
- D5 `db/sync_state.rs`'s row type is not a `models/mod.rs` IPC model and carries no
  `Serialize`: it never crosses IPC, and AD-16 forbids leaking identifiers.
