---
title: 'Migrate to Nixus Cloud from within a local profile'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: '40e072a24af8d648186979ec353600843ad0a0b2'
review_loop_iteration: 0
followup_review_recommended: true
deferred: []
---

<intent-contract>

## Intent

Offer "Migrate to Nixus Cloud" in the existing account menu whenever the active profile is local, and on a successful callback produce a *new* cloud-linked profile holding a copy of that profile's database and AI keys — leaving the source completely untouched.

## Requirements

- The account menu's cloud entry point reads "Migrate to Nixus Cloud" for a local profile, unconditionally — regardless of the machine-wide auth state — and triggers `start_login({ intent: { kind: "Migrate", source_dataset_id } })`.
- The migrate branch holds the registry lock for the entire copy. Inside it, a brief read-only peek at the active-dataset lock re-checks that the source is still active and checkpoints its connection (`PRAGMA wal_checkpoint(TRUNCATE)`, the backup export's sequence); if the user switched away during the browser round-trip it aborts and creates nothing.
- Only the main `nkbaz-finance.db` is copied — never a `-wal`/`-shm` sidecar — resolved by explicit source id, never via the active-dataset helper.
- The source's AI-provider keyring entries are copied by the enumerated fixed key names, inside `credentials.rs`, which stays the sole `keyring_core::Entry` caller.
- The new entry is tagged `kind: "cloud-linked"` with `cognito_sub`, the email label, and `linked_from: source_id`; the registry lock is released before the destination is selected.
- The source profile is never mutated, converted, or deleted, and remains listed in the picker.

## Acceptance

- A repeat migration produces another separate copy rather than corrupting either profile; a repeat *sign-in* still reopens rather than duplicates (Story 35.2's branch).
- An aborted migration leaves the registry byte-identical and no destination directory behind.
- The source keeps its own database and AI keys after migrating.

</intent-contract>

## Verification

- `cd apps/desktop/src-tauri && cargo test --lib` — 776 pass
- `cd apps/desktop && npx playwright test tests/auth.spec.ts` — 14 pass
- `cd apps/desktop && npx tsc --noEmit`

## Auto Run Result

Status: done

`datasets::migrate_to_cloud_dataset_at` takes `REGISTRY_LOCK`, validates the source is registered, then calls an injected `prepare_source` closure — the abort seam — before provisioning. In production that closure is `cloud_link::checkpoint_active_source`, which takes the active-dataset guard, refuses a source that is no longer active, checkpoints, and resolves the path from the same guard by explicit id. Injecting it is what makes the whole copy testable without a Tauri app.

`provision_dataset` is now shared by the create, login and migrate paths, so all three keep the same ordering: collision guard, directory, seed, `init_db`, registry entry written last, and `remove_dir_all` cleanup that is only reachable for a directory this call created. Migration's seed copies the main database file and then `credentials::copy_ai_credentials`, which enumerates the four fixed key names (a keyring cannot be listed at runtime); a failed provision also clears the destination's copied keys.

ProfileMenu decides the cloud entry point from the *active profile*, not from the global session: local always offers migration, and an unknown profile kind falls back to plain Login rather than guessing a source id.

New Rust tests cover the copy, the source staying untouched, the no-sidecar rule, the abort creating nothing, an unregistered source, and the keyring copy. New Playwright tests cover the label and the exact intent payload, both signed out and signed in. Follow-up review recommendation: `true`.
