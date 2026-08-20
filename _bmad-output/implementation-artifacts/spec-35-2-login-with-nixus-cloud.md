---
title: 'Log in with Nixus Cloud from the picker'
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

Wire the picker's already-present Cloud action to the unchanged Cognito flow with `LoginIntent::Login`, and land the user on the cloud-linked profile for that account — created the first time, reopened on every later sign-in.

## Requirements

- The picker's Cloud button invokes `start_login({ intent: { kind: "Login" } })` and nothing else; the OAuth mechanics from Story 35.1 are untouched.
- The post-callback branch, under the registry lock, finds cloud-linked entries whose `cognito_sub` matches the account and reopens the most recently created one; with none, it creates a dataset tagged `kind: "cloud-linked"` with that `cognito_sub` and the `id_token` email as its label.
- The registry lock is released before the dataset is activated (holding it across the switch deadlocks the callback thread).
- The launch-picker gate is latched by the branch, so a sign-in started from the picker does not bounce back to it.
- The frontend lands on the new/reopened profile's own entry view once the callback completes.

## Acceptance

- Repeat sign-ins with one account never append a second registry entry.
- A different account gets its own cloud-linked profile.
- The picker itself never selects a dataset for a cloud sign-in; the callback does.

</intent-contract>

## Verification

- `cd apps/desktop/src-tauri && cargo test --lib` — 776 pass
- `cd apps/desktop && pnpm vitest run` — 367 pass
- `cd apps/desktop && npx playwright test tests/picker.spec.ts` — 27 pass
- `cd apps/desktop && npx tsc --noEmit`

## Auto Run Result

Status: done

`datasets::find_or_create_cloud_dataset_at` holds `REGISTRY_LOCK` for the whole find-or-create and returns (releasing it) before `commands::cloud_link::activate` selects the dataset, refreshes AI state, and latches the picker gate. The subject match is filtered to valid ids and `kind == cloud-linked`, with a most-recently-created tie-break that treats an unparseable `created_at` as the epoch. Labels come from the `id_token` email via `auth::cloud_identity`, read from the token in hand rather than the keyring.

Frontend: `useSignIn` now requires an explicit intent, `DatasetPicker`'s Cloud button is enabled and reports a failed start with `datasets.cloudFailed`, and `CloudSignInNavigator` (mounted inside the router) navigates to `/` on `auth:callback-received` — deliberately that event and not `dataset:switched`, which fires before the gate is latched.

New Rust tests cover first sign-in, repeat sign-in reopening the same entry, a second account, and the tie-break. New Playwright tests assert the click carries only `{ intent: { kind: "Login" } }`, issues no `select_dataset`/`mark_picker_passed`, and stays on the picker. Follow-up review recommendation: `true`.
