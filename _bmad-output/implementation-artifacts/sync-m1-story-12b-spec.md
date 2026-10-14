# Story 12b — diagnostics export, new-computer proof suite, real-S3 primitives

Builder half "12b" of Story 12. Builder 12a owns README/CONTRIBUTING/apps/web; this half owns
the three engineering deliverables. Cited: AD-16 (counts/states/timings/error codes, never
values), AD-9, AD-14, AD-15, AD-19, CAP-2 (5 s to usable), CAP-5 (replace/separate).

## 1. Redacted diagnostics export (AD-16)

- Rust `commands/sync.rs`: `#[tauri::command(rename_all = "snake_case")] sync_export_diagnostics(app)
  -> Result<Option<SyncDiagnosticsExport>, AppError>`, registered in lib.rs. Follows the repo's
  established export pattern EXACTLY (`commands/backup.rs`, `commands/budget_template.rs`): the
  save dialog is opened in RUST (`app.dialog().file().set_file_name(..).add_filter("JSON", ["json"])
  .blocking_save_file()`), `None` => `Ok(None)` (cancelled), write via `std::fs::write` mapped to
  `AppError::File`. No frontend `plugin-dialog` call (that is this repo's convention, see
  `budget-templates.spec.ts` comment).
- Document: `{"export_version":1,"generated_ms",...}` built from the Story-10 `SyncDiagnostics`
  plus app version, OS, arch, schema version. Hand-built `serde_json` value in a pure function
  `redacted_document(..)` so it is unit-testable without Tauri.
- IDENTITY DECISION (recorded): the identity id, the owner sub, the install id and the dataset id
  are OMITTED, not hashed. A hash with a fixed salt is still a stable cross-report identifier and a
  per-install salt would itself have to be stored; AD-16 asks for counts, states, timings and codes,
  and none of those four is one. Exported in their place: `has_account_pin: bool`,
  `install_id_present: bool`. So the document carries only booleans, counts, states, timings, codes.
- SENTINEL test: seed a dataset whose every user-text column holds a recognizable sentinel plus
  token/id-shaped sentinels, build the document, assert no sentinel appears in the bytes; assert
  valid JSON with `export_version`; assert the two error paths (cancelled => Ok(None); unwritable
  path => `AppError::File`).
- Frontend: button in the existing sync settings section (Story 11 `SyncSettings.tsx`), EN+FR
  strings, `useExportSyncDiagnostics` mutation, vitest for states, `sync_export_diagnostics` added
  to the Playwright sync mock (and the always-mounted audit re-checked: no always-mounted component
  invokes it).

## 2. `sync::tests_e2e` — the new-computer proof suite

- New file `sync/tests_e2e.rs`, every test named `sync_e2e_*` so `cargo test sync_e2e` runs exactly
  this suite; each prints one `PASS ...` line with numbers (`--nocapture`).
- Built on the existing Story-8/10 harness only: `db::test_dataset::heavy_year_dataset()`,
  `FakeObjectStore` (real create-only/If-Match/304/412/409 semantics, counters, `throttle_to`),
  `test_computer()` two-computer harness, and the REAL `SyncActor` / `bootstrap` / `snapshot` /
  `SyncGate` paths. Two temp app-data roots + ONE `Arc<FakeObjectStore>`.
- Tests: (a) bootstrap equality table-by-table + schema version; (b) lazy images (thumbnail only,
  then hash-verified fetch); (c) CAP-2 budget with the Story-9 `measure_link` split (modelled
  network from object size at 1 250 000 B/s + REAL measured wall time, virtual clock); (d) replace
  keeps a dated backup that opens and equals, separate leaves the old file byte-identical;
  (e) Frozen => zero calls, local reads/writes fine, unfreeze resumes; (f) conflicting upload never
  overwrites LATEST and `load_remote` keeps a backup; (g) zero store calls for local writes inside
  the settle window; (h) local-only dataset: no host, no actor, no client, zero calls; (i) owner/pin
  mismatch refuses.
- Windows/slow-runner discipline: no real sleeps (`start_paused = true`), ceilings are generous
  (measured non-network <= 2 200 ms, as Story 9 already pinned), every connection dropped before a
  temp dir is removed (the harness `FakeSlot` already closes both), no path-separator assumptions
  (compare `Path` components / file names, never string paths).
- `.github/workflows/desktop-ci.yml`: ONE added step `cargo test sync_e2e -- --nocapture` after the
  existing `cargo test`, nothing else touched. It runs on both macOS and Windows.

## 3. Real-S3 conditional-write primitives (AD-6/AD-19, PR-A, merged first)

- Extend `infra/sync/owner-object-test.py` (already wired into the `isolation` job, so no workflow
  edit): under the SAME test-only prefix `ci-isolation-test/<run>-<attempt>/`, prove on the real
  versioned bucket: create-only 412 (already proven), If-Match CAS succeeds with the current ETag,
  If-Match 412 with a stale ETag, If-Match on an absent key => 404, conditional GET with
  If-None-Match => 304. Each primitive reports PASS / FAIL / SKIP-with-reason; AccessDenied and an
  older botocore are SKIPs with the reason printed, never fakes. A botocore that cannot express a
  conditional header falls back to `aws s3api` (the runner's CLI carries its own newer botocore).
  No deletes, never `acct/<real-id>/`, no local `aws` call.

## Decisions (unattended, rules §6)

- Spec self-approved, all goals kept, no HALT taken, no review sub-agents (one self-review pass).
- Master's newest COMPLETED Desktop CI run was green (d54fd36) at start, so nothing to fix forward.
- Diagnostics carry NO identifier at all (not even hashed) — strictest reading of AD-16.
- PR-A = infra only (waits for `sync-infra` jobs). PR-B = desktop + the CI step + this spec.
