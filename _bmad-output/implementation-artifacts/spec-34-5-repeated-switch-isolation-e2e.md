---
title: 'End-to-end isolation verification across repeated switching'
type: 'test'
created: '2026-08-19'
status: 'done'
baseline_revision: 'b199589f2bde6c14cb50e5f05491634e066f0c71'
review_loop_iteration: 0
followup_review_recommended: true
deferred: []
---

<intent-contract>

## Intent

Add one stateful Playwright isolation scenario that creates a second profile, gives Default and the new profile different representative state, switches repeatedly, and proves neither profile's state appears in the other.

## Requirements

- Prefer a new dedicated `profile-isolation.spec.ts` with an in-memory Tauri mock keyed by active dataset id.
- Drive the real picker UI for create and every switch; direct navigation to `/picker` is acceptable because it is the current switch surface.
- Cover representative state from each isolation class without recreating the whole app: finance data, car data, onboarding status/dismissal persistence, AI configuration/key presence, and import-draft localStorage clearing.
- Verify Default → new profile → Default → new profile, asserting each profile's distinct values after every switch.
- The mock must change command responses based on the selected dataset id; a global fixture is not isolation proof.
- Do not modify production behavior unless the test exposes a real defect.

## Acceptance

- Automated create → populate → switch → verify → switch back → verify passes.
- No finance/car/settings/onboarding/import-draft value from either profile appears in the other.
- Existing picker and focused frontend tests remain green.

</intent-contract>

## Verification

- `cd apps/desktop && npx tsc --noEmit`
- `cd apps/desktop && npx playwright test profile-isolation.spec.ts`
- `cd apps/desktop && npx playwright test picker.spec.ts profile-isolation.spec.ts`

## Auto Run Result

Status: done

Added a stateful Playwright isolation suite covering create, populate, in-session switch, verify, switch back, and verify again across finance, car, AI configuration, onboarding/dismissal state, and import drafts. Reads are keyed by active dataset id. Repeated switches preserve the QueryClient so stale-cache leaks are observable; delayed post-switch reads mutation-prove that removing `queryClient.clear()` fails the test.

Focused test-file typechecking passes. The isolation suite passes 3/3 and the combined picker/isolation run passes 29/29. Follow-up review recommendation: `true` (the initial full-load test design was corrected to in-session switching).
