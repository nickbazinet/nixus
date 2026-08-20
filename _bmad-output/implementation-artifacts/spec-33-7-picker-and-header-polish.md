---
title: 'Picker welcome polish and profile-aware header entry point'
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

User feedback after Epic 33-35 review: the header's top-right entry point defaulted to an ambient
cloud sign-in/migrate action even while a local profile was active and logged out, silently
switching the active dataset with no warning; and the picker's first-launch screen needed visual
polish (simple flat-color mark, equal-width rows, warmer welcome copy).

## Requirements

- Header (`ProfileMenu.tsx`) and `/profile` (`SignInRequired.tsx`): while the active profile is
  local or its kind is not yet known, show "Switch profile" navigating to `/picker` instead of an
  ambient cloud action. Only once truly signed in globally, or on a cloud-linked profile, does the
  existing Migrate/Login/sign-out panel apply.
- Picker mark: flat single-color square (`bg-brand`), not a gradient.
- Picker rows and action buttons: equal, full width regardless of label length.
- Picker copy: warmer first-launch welcome title/subtitle, in both locales.

## Acceptance

- Local-profile header/`/profile` sign-in actions never trigger a cloud OAuth flow by default.
- Picker mark, row widths, and copy match the above in both `en`/`fr`.
- Full Rust, TypeScript, Vitest, and Playwright suites pass.

</intent-contract>

## Verification

- `cd apps/desktop/src-tauri && cargo build && cargo test`
- `cd apps/desktop && npx tsc --noEmit && npx vitest run`
- `cd apps/desktop && npx playwright test`

## Auto Run Result

Status: done

Implemented as part of the same pass that closed the Epic 35 review findings (the header bug this
story fixes was the same defect the reviewers flagged independently). See
`spec-35-6-verify-no-data-leaves.md`'s "Cross-Epic Review Triage Log" for the shared fix details.

Picker polish: mark changed from `bg-logo-gradient` to `bg-brand` (both `DatasetPicker.tsx` and
`OnboardingWizard.tsx`); rows/buttons given `w-full` after a Playwright width check proved they did
not already stretch equally (`<button>`-rendered `Card`s shrink-to-fit); copy changed to
`"Welcome to Nixus"` / `"Choose a profile to open. Each one keeps its own data on this machine,
separate from the rest."` (and the French equivalents), with `picker-i18n.test.ts` and
`picker.spec.ts` updated to match.

Verification: `cargo test` 785 pass, `tsc --noEmit` clean, `vitest run` 373 pass, full
`playwright test` 553 pass (single run, zero flakes). Follow-up review recommendation: `true`
(shared with 35.6's deferred items).
