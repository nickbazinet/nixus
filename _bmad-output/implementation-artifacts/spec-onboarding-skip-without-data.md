---
title: 'Allow skipping onboarding without entering data'
type: 'feature'
created: '2026-08-01'
status: 'in-review'
baseline_commit: 'ea8f35ff9ad360d5e4e67166655d9eed4af5e203'
context: ['{project-root}/docs/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `check_onboarding_status` derives `needs_onboarding` purely from `SELECT COUNT(*) FROM budget_groups`, and the dashboard redirects to `/onboarding` whenever it is true. A user who doesn't want to enter data is trapped: the Budget step has no Skip button, and pressing Finish on the last step bounces straight back.

**Approach:** Persist an `onboarding_completed` flag in the existing `config` table and gate the redirect on it. Add a "Skip for now" action on every wizard step that sets the flag and exits to the dashboard. Since the dashboard can now be reached with an empty database, show a dismissible "finish setting up" banner there while budget data is missing.

## Boundaries & Constraints

**Always:**
- Reuse the `config` table via `db::config::get`/`set` — no new migration or table.
- SQL stays in `db/` (project rule 3); commands only orchestrate.
- New command: `#[tauri::command(rename_all = "snake_case")]`, returns `Result<T, AppError>`, registered in `lib.rs`.
- All strings through i18next, added to BOTH `en.json` and `fr.json`.
- Invalidate `queryKeys.onboardingStatus`; no hardcoded keys. Zero new TS/Rust warnings.

**Ask First:**
- A confirmation dialog before skipping.
- Changing what counts as "has budget data" beyond `budget_groups` row count.
- Any re-entry affordance beyond the dashboard banner.

**Never:**
- Don't gate the flag on localStorage — it must survive backup/restore. (Banner *dismissal* is UI-only and may use localStorage.)
- No audit log for this config flag (precedent: `set_emergency_fund_target`).
- Don't remove or repurpose the per-step `skip-button`; the new action gets its own `data-testid`.
- Don't touch Settings; don't change step order or step content.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| Fresh install | 0 groups, no flag | `needs_onboarding: true`, `setup_incomplete: false` → redirect to wizard | N/A |
| Skip with no data | Click "Skip for now" on any step | Flag set; lands on `/` and stays; banner visible | Mutation error → stay in wizard, error toast, no navigation |
| Relaunch after skip | 0 groups, flag set | `false` / `true` → dashboard loads, banner visible | N/A |
| Finish with budget added | ≥1 group, flag set | `false` / `false` → no banner | N/A |
| Existing user | ≥1 group, no flag | `false` / `false` → unchanged behavior | N/A |
| Banner dismissed | flag set, 0 groups, localStorage dismissed | Banner hidden, dashboard otherwise unchanged | localStorage throws → treat as not dismissed |

</frozen-after-approval>

## Code Map

- `src-tauri/src/commands/onboarding.rs` -- `check_onboarding_status` + its inline SQL (must move to `db/`); new command lands here.
- `src-tauri/src/db/config.rs` -- existing `get`/`set` for the `config` table.
- `src-tauri/src/db/mod.rs` -- module list. `src-tauri/src/lib.rs:134` -- `invoke_handler` registration.
- `src/hooks/useOnboardingStatus.ts` -- `OnboardingStatus` interface + query hook.
- `src/lib/constants.ts:26` -- `queryKeys.onboardingStatus`.
- `src/components/onboarding/OnboardingWizard.tsx` -- step state; footer shows `skip-button` only on steps 2–4; `handleFinish` bare-navigates.
- `src/routes/index.tsx:33-37` -- redirect effect; `hasBudget` at L64.
- `src/components/maintenance/CarOnboardingChecklist.tsx` -- reference pattern for a dismissible localStorage banner.
- `src/locales/en.json` / `fr.json` -- flat dot-notation keys.
- `tests/onboarding.spec.ts` -- Tauri IPC mock + 7 existing tests.

## Tasks & Acceptance

**Execution:**
- [x] `src-tauri/src/db/onboarding.rs` -- new file: `has_budget_data(conn) -> Result<bool, AppError>` (moves the COUNT query out of the command), `is_completed(conn) -> bool`, `set_completed(conn) -> Result<(), AppError>` on config key `onboarding_completed`.
- [x] `src-tauri/src/db/mod.rs` -- add `pub mod onboarding;`.
- [x] `src-tauri/src/commands/onboarding.rs` -- extend `OnboardingStatus` to `{ needs_onboarding, setup_incomplete }` from the db helpers; add `complete_onboarding(state)`; drop inline SQL.
- [x] `src-tauri/src/lib.rs` -- register `commands::onboarding::complete_onboarding`.
- [x] `src/hooks/useOnboardingStatus.ts` -- add `setup_incomplete`; add `useCompleteOnboarding()` whose `onSuccess` does `setQueryData(queryKeys.onboardingStatus, { needs_onboarding: false, setup_incomplete: true })` then invalidates -- stale cache would otherwise re-trigger the redirect.
- [x] `src/components/onboarding/OnboardingWizard.tsx` -- ghost "Skip for now" button (`data-testid="skip-onboarding-button"`, key `onboarding.skipForNow`) on every step; route it and `handleFinish` through `mutateAsync()` before `navigate({ to: "/" })`; disable while pending.
- [x] `src/components/dashboard/SetupIncompleteBanner.tsx` -- new dismissible Card (localStorage `finance.onboarding.dismissed`, testids `setup-incomplete-banner` / `setup-incomplete-dismiss`) with a `Link to="/onboarding"` CTA; `null` when dismissed.
- [x] `src/routes/index.tsx` -- render the banner above `LastExpenseLine` when `onboarding.data?.setup_incomplete`.
- [x] `src/locales/en.json` + `fr.json` -- add `onboarding.skipForNow`, `dashboard.setupIncomplete{Title,Body,Cta,Dismiss}`.
- [x] `tests/onboarding.spec.ts` -- teach the mock `complete_onboarding` and the two-boolean shape; add tests for each new matrix row (skip from step 1 stays on `/`, relaunch-after-skip shows banner, banner absent once a group exists).

**Acceptance Criteria:**
- Given a fresh database, when the user clicks "Skip for now" on the Budget step, then they land on the dashboard and are never redirected back — on later navigation or on relaunch.
- Given onboarding was skipped with no data, when the dashboard renders, then the banner links to `/onboarding` and the existing `empty-budget` / `empty-net-worth` cards still render.
- Given an existing user with budget data and no flag, when the app launches, then behavior is identical to today.
- Given the 7 pre-existing onboarding E2E tests, when the suite runs, then all still pass — notably the assertion that step 1 exposes no `skip-button`.

## Spec Change Log

## Design Notes

Two booleans because the redirect gate and the banner gate are different questions:

```rust
let has_data = onboarding_db::has_budget_data(&conn)?;
let completed = onboarding_db::is_completed(&conn);
Ok(OnboardingStatus {
    needs_onboarding: !has_data && !completed,
    setup_incomplete: completed && !has_data,
})
```

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop build` -- expected: tsc + vite build clean.
- `cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings` -- expected: no warnings.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: full suite passes, no regressions.

**Manual checks:**
- `pnpm --filter @nixus/desktop tauri dev` on an empty DB: "Skip for now" present on the Budget step, exits to the dashboard, and a full restart still lands on the dashboard with the banner.
