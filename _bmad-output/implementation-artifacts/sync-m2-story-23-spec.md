# Story 23 — Log-based snapshots, compaction and retention (plan)

Self-approved (unattended, rules §5). Checked against AD-6, AD-7, AD-8, AD-9, AD-13, AD-14, AD-15.

## Decisions taken up front

1. **Snapshot content contract (AD-9 amended, closes story 20/22 OPEN).** In the COPY:
   STRIP `sync_state`, `sync_image_blobs`; CARRY `sync_uuid`, `sync_field_state`, `sync_tombstone`,
   `sync_applied_vector`, `sync_pending`, `sync_quarantine`. `sync_log` is COMPACTED, not stripped:
   rows with `seq IS NULL` go (they would be re-shipped twice) and rows of kind `field`/`tombstone`
   go (`sync_field_state`/`sync_tombstone` already carry that state), while `counter_delta`,
   `balance_set` and `balance_delta` STAY — the log IS the merge state for those two kinds
   (story 20), so dropping them would make a later re-fold lose the pre-snapshot value.
2. **Watermark.** The copy's own `sync_applied_vector`, plus one row for the ORIGIN install at
   `MAX(seq)` of its own shipped log — so the watermark covers this install's own shipped head and
   a bootstrapped computer does not re-download the origin's whole log. Read from the COPY, never
   separately. Published inside `snap/LATEST` (additive field, version stays 1, absent = empty)
   so a deleting computer learns it without downloading the snapshot.
3. **Trigger.** `SyncTuning::{snapshot_tail_max_bytes = 2 MiB, snapshot_tail_max_messages = 5000}`.
   The tail is computed LOCALLY from `sync_log` grouped by `(install, seq)`: unshipped rows plus
   every row whose `seq` is above the watermark for its install. Story 20 records every applied
   remote message in `sync_log`, so the local log is a complete statement of the tail.
4. **Lost CAS in continuous sync adopts theirs** (no prompt, no fault). The enable path keeps the
   `remote_changed` prompt (CAP-5 link choice is untouched).
5. **Retention (`sync/retention.rs`)** runs only after this computer published a snapshot:
   re-GET `snap/LATEST` (fresh, never cached), delete `log/<install>/<seq>` with
   `seq <= watermark[install]` AND older than 90 days, keep the two newest `snap/<id>` plus the one
   LATEST names, prune roster members whose `head/<install>` is older than 90 days (CAS).
   Never `owner`, `head/*`, `roster`, `blob/*`. Frozen deletes nothing (the gate refuses first;
   asserted with a zero-Delete test).
6. **Port grows `delete` and `list`.** Gated wrappers, S3 adapter, FakeObjectStore. A delete of an
   absent key is `Ok(())` (S3 is idempotent). LIST stays a repair/maintenance path (AD-6).
7. **Restore carry policy.** `sync_state` and `sync_image_blobs` are replace-carried from the
   safety copy; `sync_log` is ADDITIVELY carried (`INSERT OR IGNORE` on the message id) so unsent
   rows survive and `next_seq` cannot rewind; the six merge/identity tables are NOT carried (the
   snapshot's are the shared truth).
8. **Own unsent log is re-applied after the swap** through `apply::replay_own_unsent`, which runs
   `apply_message` with recording OFF (`AppliedMessage::record`), so no `sync_log`/`sync_pending`/
   `sync_quarantine` row is written and the rows stay unsent and shippable.
9. **Bootstrap pulls the tail immediately** — `enable` ends with a forced log cycle (closes story 19
   trap (c)).
10. **90-day gap.** `PollReport::unfillable_gaps`; a gap at or below the snapshot watermark means the
    snapshot covers it, so the computer re-bootstraps instead of waiting forever.
11. **Simulator: DEVIATION, recorded.** No new op. `ReplicaEngine` has no `adopt_database` verb until
    story 25 (story 13's recorded seam); the snapshot+tail join and the past-retention re-bootstrap
    are proven instead by real-pipeline two-computer tests with the same assertions (identical
    tables incl. identities and balances). Both engines stay green, unchanged.
12. **INFRA.** `s3:DeleteObject` on `acct/${sub}/log/*` and `.../snap/*` only, as its own statement;
    `verify-template.py` asserts the two scoped resources and refuses a broader grant;
    `isolation-simulate.py`'s matrix flips to delete-allowed on own `log/`+`snap/`, denied on own
    `owner`/`head/`/`roster`/`blob/` and on any other account.

## Gates
`cargo clippy --all-targets -- -D warnings` once, full `cargo test` once, `cfn-lint`,
`verify-template.py`, `actionlint`, `py_compile`. No AWS call. No frontend change expected.
