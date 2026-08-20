---
title: 'i18n cleanup for the new Cloud entry points'
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

Land every new Cloud label under the `datasets.*` namespace in both locales in one change, and retire `profile.signIn` now that nothing renders it.

## Requirements

- New keys: `datasets.migrateToCloud`, `datasets.signInWithCloud`, `datasets.signedIn`, `datasets.signedOut`, `datasets.cloudFailed` — added to `en.json` and `fr.json` together.
- "Nixus Cloud" is never translated; user-facing copy says "profile", never "dataset".
- `profile.signIn` is removed from both locale files, and its declared-key lists in the i18n suites are updated rather than left asserting a retired key.
- Its last caller (`routes/profile.tsx`'s sign-in-required action) moves to `datasets.signInWithCloud`.

## Acceptance

- Locale-parity and declared-key suites pass with the new set and without the retired key.
- No raw i18n key renders in either cloud state of the account menu.

</intent-contract>

## Verification

- `cd apps/desktop && pnpm vitest run src/locales` — 192 pass
- `cd apps/desktop && npx playwright test tests/auth.spec.ts tests/picker.spec.ts` — 41 pass

## Auto Run Result

Status: done

Five keys added to both locales. `profile.signIn` removed from `en.json`/`fr.json`, from `profile-i18n.test.ts`'s `REQUIRED_KEYS` and `ARIA_LABEL_KEYS`, and its two brand assertions replaced by a retirement assertion in both the profile and datasets suites. `picker-i18n.test.ts` grew the five keys plus brand-term, distinctness, and retirement assertions; its existing "speaks of profiles, never datasets" sweep covers the new copy unchanged.

The one caller the story did not anticipate — `routes/profile.tsx`, which reused `profile.signIn` for the signed-out guard — now reads `datasets.signInWithCloud`, and `SignInRequired` passes the explicit `Login` intent. Two Playwright label assertions were updated to the retired-and-replaced string ("Sign in with Nixus Cloud"); no test was weakened or removed. A dedicated Playwright case asserts neither `datasets.` nor `profile.` leaks into the header in either cloud state. Follow-up review recommendation: `true`.
