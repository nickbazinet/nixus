# FIX F-1 — Lazy project images, wired end to end (SPEC CAP-6, AD-10)

## The gap

`sync/blob.rs` (Story 7) has no production caller: the sync cycle never uploads `blob/<sha256>`
and nothing fetches one, while Story 8 blanks `image_bytes` out of every snapshot. A second
computer therefore shows thumbnails forever. 12a rewrote the docs to say full images are
excluded; PR-2 reverts that wording once this lands.

## Plan

### 1. Upload (AD-10, AD-6 create-only)

- New migration `031_sync_image_blobs.sql`: `sync_image_blobs(image_sha256 TEXT PRIMARY KEY,
  uploaded_at TEXT NOT NULL)` + a named hex CHECK. Named `sync_*` on purpose: Story 8's strip
  ("every `sync\_%` table in the copy") and Story 9's carry-over ("every `sync\_%` table in
  both files") then cover it by construction, so it is local-only with no edit to either.
  Added to `WIPE_TABLES` + `danger_zone::seed_all`; the `db/projects.rs` tripwire 30 -> 31.
- New `db/sync_blobs.rs` holds every statement of this path (project-context rule: SQL in `db/`):
  `pending_image_blobs` (rows with `image_bytes IS NOT NULL` and no marker — so a NULL-bytes
  row is never uploaded), `image_blob_bytes`, `mark_uploaded`, `image_fetch_target`.
- `sync/blob.rs`: the file-level `#![allow(dead_code)]` is deleted; `blob_present` (HEAD, 0 bytes)
  is added so a blob another computer already uploaded is never re-sent as a multi-MB body.
- `SyncActor::upload` uploads pending blobs FIRST, then builds and publishes the snapshot, so no
  computer ever reads an `image_sha256` whose blob does not exist. A blob fault returns before
  `snap/LATEST` is touched, so the pointer ordering cannot be corrupted.
- Marker: a hash is recorded after a `Created` **or** an `AlreadyStored`/`blob_present` hit, so the
  second cycle makes zero blob requests at all (tested). Frozen / un-entitled / local-only reach
  the gate first: zero calls.

### 2. Fetch on demand

- `SyncHost` gains ONE generic seam, `with_dataset(|&Connection|)`, which both hosts already had
  privately (`with_conn` / `with_own`) — five single-purpose methods would be the alternative.
- `SyncActor::fetch_image(project_id)`: reads the target; `AlreadyLocal` returns the payload with
  **no** `connect()` and no network; `Missing` is `SyncFault::ImageMissing`; otherwise it fetches
  `blob/<sha256>` through the gated store (`fetch_image_blob` re-hashes before returning), writes
  through `set_project_image_bytes` (hash in the WHERE clause) and answers with the fresh payload
  built by `commands::projects::get_project_image_inner` — the one existing IPC mapper.
- Two new codes, each with EN+FR copy: `image_missing`, `image_corrupt` (hash mismatch or a body
  that is not an AD-8 object). Everything else reuses existing codes (`frozen`, `local_only`,
  `not_entitled`, `offline`, `remote_missing` for an absent blob).
- Command `sync_fetch_project_image(project_id)` (`rename_all = "snake_case"`, registered in
  `lib.rs`, `Result<ProjectImage, AppError>`). `get_project_image`'s placeholder contract
  (`full_image_available`) is unchanged.
- The dead-code allows on `set_project_image_bytes` and `blank_project_image_bytes` are removed.

### 3. UI

- `ProjectImageCard.tsx` mounted in `ProjectDetail` (the expanded row) — the first production
  reader of the already-written `useProjectImage`. States: loading (Skeleton), no picture
  (EmptyState), **not on this computer** (thumbnail + explicit "Load full image" button, AD-10's
  placeholder), fetching, error + retry (Alert `over`), loaded.
- Explicit button rather than fetch-on-view: simpler, and it never spends megabytes because a row
  was expanded. `useFetchProjectImage` follows `useEnableSync`'s shape and invalidates
  `queryKeys.projectImage(id)`. New `projects.image.*` keys in EN+FR with the parity test extended;
  `tests/projects.spec.ts` gains the new command plus a `full_image_available: false` fixture.
  Mock audit: `get_project_image` is mounted only on a projects-row expand; `accounts.spec.ts` is
  the only other spec naming it and already answers it.

### 4. Tests

- New `sync/tests_images.rs`: upload once then zero PUTs, NULL-bytes rows skipped, Frozen /
  un-entitled / local-only zero calls, fetch round trip, tampered blob refused, already-local
  fetch makes no request, a replaced picture's stale write-back is dropped.
- `tests_e2e.rs` (b) now drives the PRODUCTION path (`computer_a.sync_now`, `computer_b
  .fetch_image`) instead of calling the blob helpers, and (c) asserts the CAP-2 bootstrap
  downloads no `blob/` object. The printed `PASS sync_e2e:` format is kept.

## Decisions (auto-decided, unattended)

- Marker table over HEAD-before-PUT alone: zero requests in the steady state (AD-19 cost lever);
  HEAD is still used once per unknown hash so a shared blob is never re-sent.
- `fetch_image` does not require `enabled`: the gate is AD-14's authority, and a linked dataset
  that paused uploads can still show its own pictures.
- No new diagnostics field: the export schema stays at version 1 (blob work is inside a cycle).
