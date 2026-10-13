# Story 9 — New-computer bootstrap, guarded file swap and link choice (implementation spec)

Binding: AD-9 (bootstrap is snapshot-first, every file swap is guarded), AD-15 (sync state lives in the
dataset DB), AD-1 inherited (one dataset = one directory + one SQLite file), AD-4, AD-11, CAP-2, CAP-5.

## 1. Where the code goes

- `db/backup.rs` (AD-9 says the restore goes "through `db/backup.rs`'s sequence", CAP-5 names that file):
  the guarded swap, the dated backup, the local-only carry-over, the launch-time recovery, the
  emptiness summary. **All SQL for this story lives here** (project-context rule 3).
- `sync/bootstrap.rs` (new, in the Structural Seed's spirit): owner verification, `snap/LATEST`,
  download, `read_snapshot`, the CAP-5 plan/choice, the timing model. Contains no SQL and may not name
  `DbState` (a fitness test asserts it), so it can never take the active-dataset lock.
- `datasets.rs`: `BACKUPS_SUBDIR`/`dataset_backup_dir` (dataset-directory layout is its authority) and
  `create_cloud_dataset_at`, which always provisions a NEW cloud-linked entry (the existing
  `find_or_create_*` returns the current one, which is not what *separate* needs).

## 2. Guarded swap (Windows-defensive; backup.rs overwrites in place and is not atomic)

Order, with the old file usable at every instant:
1. Write the verified payload to a brand-new `nixus.db.sync-incoming` (any leftover is removed first;
   never an in-place truncation of a file something may have mapped).
2. Open the staging file with `open_configured` (so migrations run for an older snapshot), `PRAGMA
   quick_check`, carry the local-only state in, `wal_checkpoint(TRUNCATE)`, **close**, remove sidecars.
   The new file is therefore proven to open and to be intact *before* the live file is touched.
3. Dated backup first (REPLACE only), then the safety copy `nixus.db.pre-bootstrap`.
4. Close every connection to the live file (the `DatasetSlot` seam, below), remove its sidecars,
   `fs::copy(staging -> nixus.db)` — a copy, not a rename: no rename-over-existing assumption — remove
   sidecars again.
5. Reopen + `quick_check` + hand the connection to the slot. Any failure at 3-5 copies the safety file
   back, reopens that, and returns the original cause. The safety copy is deleted last, on both paths.
- `DatasetSlot { close(), adopt(Connection) }` is the seam for "the sync connection is CLOSED before any
  file swap": Story 10 implements it over its actor handle + `DbState`; `UnopenedDataset` is the no-op for
  a dataset nothing has open (the *separate* path). No retry/backoff: nothing here waits on another
  process, and a blind retry would hide a handle this process still holds.
- Recovery (`recover_interrupted_restore`, Story 10 calls it at launch, idempotent): a stale
  `.sync-incoming` is deleted (it is never the dataset). A surviving `.pre-bootstrap` means a crash
  between 3 and 5: the live file is kept if it opens and passes the *full* `integrity_check` (a crash
  pays for the slower check), otherwise the safety copy is put back.

## 3. Local-only carry-over (AD-9, AD-15) and identity

Copied from the safety copy into the staging file through a `query_only` read connection (no ATTACH, so
no `file:` URI quoting on Windows): every `sync\_%` table present in **both** files, rows verbatim (so
`sync_state` keeps this install's id, fingerprint and pin — the restored dataset stays cloud-linked and
bound to the same account), plus Story 8's `CONFIG_DENY_LIST` keys (now `pub(super)`, one source of
truth). Image bytes stay NULL (lazy, AD-10); thumbnails arrive in the snapshot. A newer
`schema_version` is refused as a typed error *before* the download, from `snap/LATEST`, and again by
`read_snapshot`.

## 4. CAP-5 link choice

`assess()` -> `BootstrapPlan::{FirstEnable, NoSnapshot, Restore, ChoiceRequired{local counts}}`.
No `owner` object = first enable, not a bootstrap. An empty dataset restores with no prompt.
`LinkChoice::Replace` swaps the cloud copy in and keeps the old file as
`backups/nixus-pre-sync-<local timestamp>.db`, never overwriting an existing backup (a `-2`, `-3`…
suffix is added). `LinkChoice::Separate` provisions a **new** cloud-linked dataset for the same sub (`linked_from` = the
kept dataset) and restores into that one; the kept file is never opened for writing and stays
byte-identical. DECISION: `most_recent_for_sub` makes the new entry the one a later sign-in opens, which
is what "untouched and unsynced" means without a kind change the registry does not model; a hand-selected
kept profile hits Story 10's `If-Match` conflict, which never overwrites. Returning the new `Dataset`
rather than activating it leaves `dataset:switched` with `select_dataset_now` (lock order registry ->
active). Nothing is deleted without a backup copy.
DECISION: "non-empty" ignores `schema_version`, `sqlite_sequence` and `sync_*` **and `config`** —
config is this computer's settings, so a dataset where only a theme was set must not raise a prompt.

## 5. Tests (Story 8's fake store + heavy-year generator)

Heavy-year restore equals the source minus the stripped parts, images lazy; replace keeps a dated
backup that opens and equals the old data; separate leaves the old file byte-identical; failure
injection at each swap step (staging write, staging open, dated backup, safety copy, live copy, reopen)
leaves a file that opens with either the old or the new data, never half; newer `schema_version`,
tampered object and owner/pin mismatch refused; local-only and Frozen datasets make zero store calls;
local-only tables carried; recovery path from a simulated crash.
TIMING GATE (CAP-2): everything after "credentials ready" (owner GET + LATEST GET + snapshot GET +
verify + decompress + restore + migrate + reopen + a real query) is run once; the network leg is the
fake store's `throttle_to(1_250_000)` under `#[tokio::test(start_paused = true)]` (virtual time, exact
by size), the CPU/disk leg is real wall time measured with `Instant`. Asserted: model total
(= bytes/1.25 MB/s + measured) <= 5 s, and the measured non-network part <= a ceiling with ~3x headroom
over the local debug measurement for slow macOS/Windows runners. The breakdown is printed and recorded
in the ledger.

## Decisions (unattended, rules §6)

Spec self-approved; all goals kept; no HALT; no review subagents (one self-review pass).
