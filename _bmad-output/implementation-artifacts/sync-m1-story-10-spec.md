# Story 10 — Sync manager, commands and status events (implementation spec)

Binding: AD-14 (one capability flag), AD-16 (never blocks; events + counts), AD-6 (lock order
registry -> active; stop on `dataset:switched`), AD-9 (guarded swap, `DatasetSlot`), AD-11 (own
connection), Milestone 1 scope only (no capture hook, no segments, no merge).

## 1. The actor (`sync/manager.rs`)

- `SyncHost` is the single seam the actor is generic over (associated types `Store: ObjectStore`,
  `Link`, `Caps`, `GateState`, `Slot: DatasetSlot`). It answers: dataset id, db path, backup dir,
  app-data root, label, schema version, `now_ms()`, `data_version()`, `local_data()`, `slot()`, and
  `connect() -> SyncSession { store: GatedStore<..>, pin }`. The production impl owns the
  credential vendor, the `SyncStateStore` pins and its own read-only connection; fakes are
  injected whole. One trait, one production struct: no second abstraction layer.
- `connect()` is the gated path: `SyncGate::check` first (so a local-only/Frozen/un-entitled
  dataset reaches neither Cognito nor S3), then `SyncGate::vend` (which pins, Story 5/6), then the
  S3 adapter built from the just-vended 1 h credentials. The store is therefore rebuilt per cycle,
  which is also how credential refresh happens — nothing caches an S3 client past its credentials.
- `SyncHandle { mpsc::Sender<Command>, watch::Receiver<SyncStatusPayload> }` is cloneable and the
  only thing commands hold. `Command::{Enable, Disable, Status, Now, Diagnostics, ResolveRemote}`
  each carry a `oneshot` reply. The actor task owns all state; no mutex is held across an await and
  no `DbState` lock is taken inside the actor except inside the sync `DatasetSlot` calls.
- Startup is non-blocking: `SyncManager::spawn` returns a handle immediately; every fault becomes a
  status, never a launch failure. `offline`/retryable faults set an exponential backoff with jitter
  (capped); no tight loop, because the poll tick is the only driver.

## 2. Milestone-1 behaviour

- **Change detection without a capture hook:** `PRAGMA data_version` on the actor's own read-only
  connection. Chosen because it is the only signal SQLite gives a *second* connection that changes
  exactly when another connection commits, costs one page-cache read, needs no schema, no trigger
  and no write, and cannot miss a commit (M2 Story 15 replaces it with the hook). Polled every
  `poll_interval` (default 2 s, injectable).
- **Settle:** a changed `data_version` stamps `last_change_at`; an upload runs only once
  `settle_window` (default 5 s) has passed with no further change AND `min_upload_interval`
  (default 60 s) has passed since the last upload. All three are injectable (`SyncTuning`).
- **Upload:** `build_snapshot` + `upload_snapshot(.., known_latest, now_ms)`; `known_latest` is the
  ETag of the LATEST this computer last pulled or published — `None` only for the first enable.
- **First enable / bootstrap:** `bootstrap::assess` decides. `FirstEnable` writes the create-only
  owner object then publishes the first snapshot. `NoSnapshot` publishes with `put_if_absent`.
  `Restore` restores (no dated backup: the dataset is empty). `ChoiceRequired` returns
  `link_choice_required` unless `sync_enable` was called with the choice, then `apply_choice`.
- **Conflict:** `UploadOutcome::RemoteChanged` never overwrites. Status becomes `remote_changed`
  with the prompt; `sync_resolve_remote_changed` either loads the cloud copy through
  `restore_latest` **with a dated backup dir** (Story 9 replace path) or keeps local by adopting
  their ETag and re-uploading on the next settle.
- **Frozen / entitlement lapse:** the gate refuses before any byte, status `frozen`, local use
  untouched; leaving Frozen resumes on the next tick.

## 3. Commands (`commands/sync.rs`, all `rename_all = "snake_case"`, all registered in `lib.rs`)

`sync_enable(link_choice: Option<String>) -> SyncEnableOutcome`, `sync_disable() -> ()`,
`sync_status() -> SyncStatusPayload`, `sync_now() -> SyncStatusPayload`,
`sync_resolve_remote_changed(action: String) -> SyncStatusPayload`,
`sync_diagnostics() -> SyncDiagnostics`. Six, which is the minimum Story 11 needs: the link choice
is answered by calling `sync_enable` again with it, so no seventh command exists for it.
A `SyncSupervisor` Tauri state holds the handle for the ACTIVE dataset only and is stopped from
`select_dataset_now` (where `dataset:switched` is emitted) and from `sign_out`.

`sync:status` is emitted on every transition with `SyncStatusPayload { state, dataset_id,
last_sync_ms, error_code, recoverable, prompt }`; `state` is
`idle|syncing|offline|frozen|error|unlinked|update_needed|link_choice_required|remote_changed`.
`AppError::Sync { code, message, recoverable }` maps `StoreError`/`AuthError`/`SyncBlocked`/
`SnapshotError`/`BootstrapError` onto stable codes; mirrored in `src/lib/appError.ts` (types only).

## 4. Dead code

`#![allow(dead_code)]` leaves `sync/mod.rs`. Every remaining warning is wired, deleted, or given a
narrowly scoped commented `#[allow(dead_code)]` naming the Milestone-2 story that is its first
caller.

## 5. Tests

`sync/tests_manager.rs` with the Story-8 fakes: settle coalescing, no upload before settle,
If-Match uses the last pulled ETag, conflict never overwrites and yields the prompt, load-remote
keeps a dated backup, Frozen = zero store calls with local writes still working, local-only = actor
never starts, offline backoff, stop on switch, faults never block startup, `sync_diagnostics`
contains no sentinel values, `sync:status` sequence. Plus `TwoComputers`: two app-data dirs, one
shared `FakeObjectStore` — enable on A, bootstrap B, edit on B, A sees `RemoteChanged`. That
harness is public to tests so Story 12 and the final proof reuse it.

## Decisions (auto-taken, unattended per rules section 6)

- Spec self-approved; all goals kept; no HALT; no review sub-agents (one self-review pass).
- `data_version` polling over a trigger table or an mtime watcher: no schema change, no write, and
  it is exactly "another connection committed".
- Six commands; the link choice re-uses `sync_enable` rather than adding a command.
- The S3 adapter is rebuilt per cycle from fresh credentials instead of caching a client.
