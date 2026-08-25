---
title: 'Fix first Nixus Cloud login attempt after sign-out'
type: 'bugfix'
created: '2026-08-25'
status: 'in-review'
baseline_commit: '5fade506d26daaec80ac0a947d54013b6aa412f5'
review_loop_iteration: 0
context: ['{project-root}/docs/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After a successful Nixus Cloud login and sign-out, the next login click fails on macOS and Windows because the prior `tiny_http::Server` still owns the fixed OAuth callback port `127.0.0.1:52847`. A second click succeeds only after teardown catches up, violating the expected one-click login flow.

**Approach:** Keep one loopback server bound for the process lifetime and restart only the per-attempt receive worker. Reuse the existing server across login attempts while preserving supersession, timeout, PKCE/state validation, and callback behavior.

## Boundaries & Constraints

**Always:** Write a failing real-socket regression test first; use ephemeral port `0` in tests; preserve the production callback URI and fixed port; keep the five-minute attempt timeout; ensure a superseded worker cannot clear the replacement attempt; keep listener cleanup deterministic and warning-free on macOS and Windows.

**Ask First:** Any change to Cognito callback configuration, OAuth semantics, dependency versions, or the public auth IPC contract.

**Never:** Add sleeps, backoff retries, random ports in production, socket-error suppression, new network dependencies, or changes to Keychain/Credential Manager behavior. Do not weaken PKCE or CSRF state checks. The separate macOS duplicate-Keychain defect is out of scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| First login | No loopback server exists | Bind port once, arm one attempt, open Hosted UI | Bind failure remains a recoverable auth error |
| Re-login after sign-out | Existing server; previous worker completed | Reuse the same server and arm the new attempt without rebinding | No `Address already in use` error |
| Superseded attempt | A second login starts while a worker waits | Stop/join the old worker; preserve the replacement attempt | Old worker exits without clearing new PKCE state |
| Stale unblock signal | Server queue contains a prior unblock sentinel | New worker keeps waiting within the original deadline | Must not expire or discard the active attempt |
| Timeout | No callback before five minutes | Worker exits and discards only its own pending attempt | Existing timeout behavior remains user-recoverable |
| Listener fault | `recv_timeout` returns a real error | Mark server faulted so a later attempt may recreate it | Surface existing recoverable listener error if rebinding fails |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/commands/auth_listener.rs:175-242` -- Current managed `(Arc<Server>, JoinHandle)` slot, immediate drop/rebind race, callback worker, and listener tests. `tiny_http 0.12` moves the listening socket into a detached accept thread, so dropping `Server` does not synchronously release the port.
- `apps/desktop/src-tauri/src/commands/auth.rs:400-448` -- `start_login` requires listener readiness before storing the attempt and opening the browser; preserve this ordering and IPC contract.
- `apps/desktop/src-tauri/src/commands/auth.rs:1035-1060` -- Sign-out clears auth state and re-arms the picker; it should remain unchanged.
- `apps/desktop/src-tauri/src/commands/auth_success.html` -- Extracted static callback success page so listener lifecycle code remains reviewable and below the Rust pure-LOC ceiling.
- `/Users/nbazinet/Library/Application Support/com.nbazinet.nkbaz-finance/nkbaz-finance.log.2026-08-25:60-74` -- Runtime evidence: sign-out, first-click `Address already in use`, then second-click successful callback and profile activation.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/commands/auth_listener.rs` -- Add a failing real-socket test proving two successive acquisitions reuse one bound server, plus pure wake-classification tests for supersession, stale sentinels, and expiry.
- [x] `apps/desktop/src-tauri/src/commands/auth_success.html` -- Move the existing static success markup unchanged out of the Rust module.
- [x] `apps/desktop/src-tauri/src/commands/auth_listener.rs` -- Retain one lazily-bound server, cancel/join only attempt workers, drain stale queue signals before arming, preserve a fixed deadline, and recover from a genuinely faulted server.

**Acceptance Criteria:**
- Given a completed login followed by sign-out, when the user clicks “Log in with Nixus Cloud” once, then the browser flow starts without a listener-bind error and the callback can authenticate that attempt.
- Given repeated or overlapping login starts, when a newer attempt supersedes an older one, then exactly the newest PKCE verifier/state remains eligible to complete.
- Given the listener regression test, when the pre-fix implementation runs, then it fails by attempting to bind an already-owned address; when the fix runs, then the same server instance is reused.
- Given the complete Rust verification suite, when tests, formatting, checking, and clippy run, then all pass with zero warnings.

## Spec Change Log

## Design Notes

`tiny_http::Server::drop` only signals its detached accept thread; it cannot join that thread or guarantee immediate socket release. Therefore “drop then rebind” cannot be made deterministic without timing assumptions. Process-lifetime server reuse removes the race at its source while keeping attempts independently cancellable.

## Verification

**Commands:**
- `cargo test auth_listener --lib` -- expected: failing regression before implementation, then all listener tests pass.
- `cargo test --lib` -- expected: all Rust unit tests pass.
- `cargo fmt --all -- --check` -- expected: no formatting diff.
- `cargo clippy --all-targets -- -D warnings` -- expected: zero warnings.
- `cargo check --all-targets` -- expected: successful compilation.

**Manual checks:**
- Run the desktop app, sign into Nixus Cloud, sign out, and click “Log in with Nixus Cloud” once; expect the Hosted UI to open and complete without `Address already in use` in the application log.

**Implementation evidence:**
- `cargo test auth_listener --lib` -- 8 passed, including a real TCP callback followed by immediate server reuse.
- `cargo test --lib` -- 856 passed, 0 failed.
- `cargo check --all-targets` and `cargo build` -- passed.
- `rustfmt --edition 2021 --check src/commands/auth_listener.rs` and the Rust no-excuse checker -- passed for the changed Rust file.
- Full-repository `cargo fmt --all -- --check` and `cargo clippy --all-targets -- -D warnings` remain blocked by pre-existing formatting drift and 232 unrelated lint findings; neither reported a new listener finding.
- The app binary launched through `tauri dev`; the live Cognito click-through was not completed because macOS denied UI automation (`System Events` timed out). The real-socket regression executes the listener callback/reuse invariant directly without browser credentials.
