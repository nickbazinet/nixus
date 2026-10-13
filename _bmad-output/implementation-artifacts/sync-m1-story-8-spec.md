# Story 8 — Snapshot build and upload (plan)

Serves CAP-1/CAP-2. Binds AD-6, AD-8, AD-9, AD-10, AD-15. No Tauri command, no M2 work.

## Build (`sync/snapshot.rs`, SQL only through `db/`)

1. `build_snapshot(db_path, schema_version)` is async and does every heavy part inside one
   `spawn_blocking`. Inside: a `tempfile::TempDir` **in the dataset directory** (same volume, so the
   copy never crosses devices and is removed on drop, including on failure).
2. Source = a dedicated read connection to the dataset FILE, opened in the blocking task, WAL +
   busy_timeout, no hook registered. `rusqlite::backup::Backup` is stepped `512` pages at a time with
   a 1 ms pause, so SQLite releases the source read lock between steps and the UI's
   `Mutex<Connection>` is never taken at all. Never `VACUUM INTO` (renumbers rowids), never `VACUUM`.
3. Stripping runs on a SECOND fresh connection to the copy (no hook, no capture), one transaction:
   - every `sync_*` table discovered in the copy's `sqlite_master` is emptied (so `sync_log`'s
     absence in M1 is handled by construction, and M2's tables need no edit here);
   - `config` loses exactly `ai_configured`, `ai_provider`, `aws_region` (AD-5 deny list);
   - `db::projects::blank_project_image_bytes` nulls `image_bytes`, keeping hash + thumbnails (AD-10).
   `schema_version` is KEPT: a snapshot is a database file, and a restore with no version row would
   re-run every migration over populated tables. Recorded as a deliberate reading of AD-5.
4. Payload = the stripped copy's bytes. Object = `ObjectHeader::new(schema_version, sha256(payload))`
   (Story 7, AD-8) + `zstd(payload, level 3)`. **Level 3 is FROZEN** and pinned by a format test.
   The header hash is of the UNCOMPRESSED payload, so verification proves the database bytes.
5. `snap_id` = the payload's sha256 hex, so the create-only put is idempotent and AD-6's
   "412 is success only when the hash matches" is automatically true for a retry.

## Read side

`read_snapshot(bytes)` → parse header, decompress with a 256 MiB bound, re-hash, compare. Typed
`SnapshotError::{NotAnObject/Header, Truncated, Corrupt, SchemaTooNew{found,supported}, …}`; a
`schema_version` above `db::latest_schema_version()` is refused, never applied (AD-11/CAP-7).

## Upload

`upload_snapshot(&GatedStore, &BuiltSnapshot, Option<&ETag>)`:
`put_immutable("snap/<id>")`, then `snap/LATEST` — `put_if_match` with the ETag last pulled, or
`put_if_absent` when LATEST has never existed. `412`/`409` on LATEST ⇒ re-GET it and return
`UploadOutcome::RemoteChanged(RemoteLatest { snap_id, hash, schema_version, created_ms, etag })`;
LATEST is never overwritten. Story 10 turns that value into the load-or-keep choice.

`snap/LATEST` body = compact UTF-8 JSON, sorted keys, exactly
`{"created_ms":i64,"hash":"<64 hex>","schema_version":u32,"snap_id":"<64 hex>","v":1}`.
Raw JSON, no AD-8 header and no zstd: AD-8 frames segments, snapshots and blobs; LATEST is a
mutable pointer like `roster`/`head` and has to be readable to find the snapshot at all.

Everything goes through Story 6's `GatedStore`, so Frozen / un-entitled / local-only makes zero
network calls (proven with a counting fake).

## Test support created now (Stories 9/12 reuse it) — `sync/test_support.rs`, `#[cfg(test)] pub(crate)`

- `FakeObjectStore`: real create-only / If-Match / 304 / 412 / 409 / 404 semantics over a map,
  `calls()` counter, per-op counters, `fail_next(op, StoreError)` and a `throttle(bytes_per_sec)`
  hook that sleeps proportionally to the transferred bytes (the 10 Mbps timing test in Story 9).
- `heavy_year_dataset()`: a migrated dataset in a `TempDir`, deterministic LCG, ~6 000 expenses,
  15 000 audit rows, 5 000 chat messages, 2 project images, money in cents, valid FKs, a realistic
  category/date spread over one year. Never touches real app data.

## Tests

Heavy-year snapshot (size + build time printed), compressed size, round trip into a fresh DB
compared table-by-table minus the stripped parts, rowid/PK preservation of every remaining table,
upload happy path, LATEST first-create, LATEST conflict ⇒ `RemoteChanged` and no overwrite, tamper /
truncation / unknown version / newer schema refusal, Frozen ⇒ `calls() == 0`.

## Decisions (unattended, rules §6)

- Spec self-approved, all goals kept, no HALT, no review sub-agents (one self-review pass).
- The backup source is a dedicated read connection to the same dataset file rather than the live
  `Mutex<Connection>`: AD-9 requires the online backup API (used), and holding the UI mutex for a
  whole multi-megabyte copy is exactly what the story's "never held for the whole copy" forbids. A
  fresh connection also satisfies "no capture hook registered" by construction.
