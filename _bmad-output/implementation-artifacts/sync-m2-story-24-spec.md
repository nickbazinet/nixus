# Story 24 — Version skew, clock skew, full status states (plan, self-approved)

AD-4, AD-11, AD-16. Never block local use.

## Backend

1. **Version skew (AD-11), pull side, NO migration.** `read_segment` takes `supported: u32`
   (was `db::latest_schema_version()` inline) so the ceiling is the host's and is injectable.
   `poll_heads` takes `supported` and, on `SegmentError::SchemaTooNew`, PARKS instead of
   erroring out of the whole poll: the seq is remembered in `InstallCursor.parked`
   (seq -> required version), the fetch loop `break`s for that install (every later segment of
   a newer build is also newer, and contiguity forbids skipping), and other installs keep
   syncing. `next_seq` does NOT move and `sync_applied_vector` is NOT advanced, so the
   immutable cloud object stays the durable copy (AD-6) — it is neither applied, dropped nor
   quarantined. A parked seq is not re-requested until `supported >= required`, so a stale
   build costs zero extra GETs. When the app updates, `supported` rises, the entry becomes
   eligible, the segment is re-fetched and applied in seq order.
   DECISION: no new table/migration. The cloud object is the durable park; a local BLOB copy
   would be a second durable progress record that story 19 explicitly refused.
   AD-11's MESSAGE-level clause (unknown table/column) needs no change: such a message can
   only come from a newer build, whose whole segment is already refused at the header, so
   story 20's quarantine arms stay correct.
2. **Clock skew (AD-4).** `Clock` gains an `AtomicI64` high-water mark: `observe` records
   `ahead_ms` when it REFUSES a stamp, `take_skew()` drains it. `Applier` gains
   `fn take_clock_skew(&mut self) -> Option<i64>` (default `None`), implemented by
   `DatasetApplier` off its own `Clock`. The actor turns it into `SyncFault::ClockSkew` ->
   new `SyncState::ClockSkew`, code `clock_skew`, recoverable, NO backoff, counted. Messages
   are still applied (story 20's decision: refusing is data loss, and the stamp still orders
   totally); what is "rejected" is the stamp's right to move THIS computer's clock.
3. **Full states.** End of `log_cycle`: skew -> `ClockSkew`; else parked segments ->
   `UpdateNeeded`; else, if the state is one of those two, clear and publish `Idle`. So both
   states are self-healing without an upload.
4. **Diagnostics (counts only).** `parked_segments`, `pending_messages`,
   `quarantined_messages`, `clock_skews`, `last_clock_skew_ms`.
5. **Codes -> frontend.** `segment_invalid`, `apply_failed`, `clock_skew`.

## Frontend

`SyncState` += `clock_skew` (types.ts, syncState.ts label/detail/tone, indicator icon).
`SyncErrorCode` += the three codes, `syncMessageKey` arms, EN+FR copy, `sync-i18n.test.ts`
covers them by construction (it iterates the unions).
`useSyncApplied()` listens `sync:applied` (count only) -> a dismissing-itself
`role="status" aria-live="polite"` badge in the indicator. No focus move, no dialog.
`remote_changed` dialog LEFT IN PLACE: story 23 kept one reachable enable-time race.

## Gates (SPEED POLICY §8)

`cargo test sync::` targeted, then ONCE `cargo clippy --all-targets -- -D warnings` + full
`cargo test`. `tsc --noEmit`, the vitest files touched + locale parity, Playwright
`sync.spec.ts` only.
