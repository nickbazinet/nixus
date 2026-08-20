---
title: 'No frontend-persisted state survives a profile switch'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: '7eb3899fcd3d3bc4527c06dbba2a5dc7b57663aa'
review_loop_iteration: 0
followup_review_recommended: true
deferred: []
---

<intent-contract>

## Intent

On every backend `dataset:switched` event, clear the TanStack query cache and remove frontend persistence that belongs to the previous profile.

## Requirements

- Remove exactly these per-profile keys: `nixus:import-draft.v1`, `finance.onboarding.dismissed`, `car.onboarding.dismissed`.
- Preserve global preferences: theme/language, sidebar state, hidden-value preference, and last-used agent.
- Install one app-lifetime Tauri event listener inside the `QueryClientProvider`; clean it up correctly under React StrictMode.
- Extract the sweep into a small testable function and use shared exported key constants instead of repeating literals.
- Keep Story 33.5's selection behavior; duplicate cache clearing is harmless but the event listener is the universal backend-switch boundary.
- Add focused unit tests proving per-profile keys and queries are cleared while global keys survive.

## Acceptance

- A profile switch cannot expose another profile's import draft or dismissed setup/car banners.
- Global UI preferences survive the switch.
- TypeScript and focused Vitest tests pass.

</intent-contract>

## Verification

- `cd apps/desktop && npx tsc --noEmit`
- `cd apps/desktop && npx vitest run src/lib/__tests__/datasetSwitch.test.ts`
- `cd apps/desktop && pnpm test`

## Auto Run Result

Status: done

Every real dataset switch now clears the query cache plus the import draft and finance/car dismissal flags, while preserving global preferences. Picker-initiated switches sweep synchronously before navigation; the backend suppresses same-profile switch events so relaunching Default does not destroy Default's own saved draft. The app-lifetime listener is StrictMode-safe and tested.

Focused Rust, TypeScript, and 357 Vitest tests pass. Follow-up review recommendation: `true` (same-profile draft-loss and ordering fixes applied).
