---
title: 'LoginIntent carries Login vs Migrate across OAuth'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: 'c8eb912542ce0d093ee069847edce781193f9fac'
review_loop_iteration: 0
followup_review_recommended: true
deferred: []
---

<intent-contract>

## Intent

Carry one typed `LoginIntent` (`Login` or `Migrate { source_dataset_id }`) through the existing single in-flight OAuth attempt. Do not change PKCE, state validation, token exchange, or Cognito session storage.

## Requirements

- `start_login` accepts the intent, defaulting omitted/legacy calls to `Login` for compatibility.
- Store intent only in memory with the same pending-attempt/listener lifetime as verifier/state; superseding, timeout, failure, or sign-out cannot leave stale intent.
- A successful loopback callback exposes/returns the consumed intent for the post-callback branch used by later stories.
- Legacy `nixus://auth/callback` always resolves to `Login`, never Migrate, even if a migrate attempt was pending.
- Keep existing OAuth mechanics and session persistence unchanged.
- Add focused Rust tests for default Login, Migrate round-trip, superseding attempts, and legacy fallback.

## Acceptance

- Login and Migrate intents survive only their own successful loopback attempt.
- Legacy deep links always behave as Login.
- Existing auth tests and build remain green.

</intent-contract>

## Verification

- `cd apps/desktop/src-tauri && cargo build`
- `cd apps/desktop/src-tauri && cargo test auth`
- `cd apps/desktop && npx tsc --noEmit`

## Auto Run Result

Status: done

`LoginIntent` now travels with the same in-memory OAuth attempt as PKCE verifier/state. Omitted calls remain Login; loopback success emits the consumed typed intent; legacy callbacks always force Login by delivery channel. Timeout, interruption, failure, superseding attempts, completion, and sign-out clear the whole pending attempt.

Two-review pass fixed the initially dead success seam and timeout lifetime gap. Rust build, 72 auth tests, and TypeScript pass. Follow-up review recommendation: `true`.
