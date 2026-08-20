---
title: 'Verify no data leaves the machine during login or migration'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: '40e072a24af8d648186979ec353600843ad0a0b2'
review_loop_iteration: 0
followup_review_recommended: true
deferred:
  - summary: >-
      checkpoint_active_source/activate/resolve_intent branch dispatch have no direct behavioral
      test of their own.
    evidence: |-
      Covered only indirectly through migrate_to_cloud_dataset_at's error-handling test, not a
      dedicated test of the seam itself.
    severity: medium
  - summary: >-
      A live-WAL-mode connection checkpoint-then-copy round trip is untested for migration.
    evidence: |-
      Pre-existing gap inherited from backup.rs's own copy path, not introduced by Epic 35.
    severity: low
  - summary: >-
      The signed-in badge's one truly discriminating state has no dedicated Playwright case.
    evidence: |-
      Cloud-linked profile showing signed-out while the machine session is signed in as a
      *different* account is the only state that distinguishes subject-matching from mere
      session presence, and it is untested at the UI layer.
    severity: medium
---

<intent-contract>

## Intent

Capture NFR1 as automated evidence rather than an assumption: neither the Login nor the Migrate flow transmits financial, car, or profile data, and the only network calls remain Cognito's two existing OAuth endpoints.

## Requirements

- An automated guard proves no module on the login/migrate path (`datasets.rs`, `credentials.rs`, `commands/datasets.rs`, `commands/cloud_link.rs`) can perform network I/O at all.
- An automated guard proves the OAuth module addresses only `/oauth2/authorize` and `/oauth2/token`.
- An automated guard proves the IPC payload each entry point sends is the intent and nothing else — at most one local dataset id.
- Migration is proven to be local filesystem plus local keyring only.

## Acceptance

- Adding a networked module, a third Cognito endpoint, or an extra IPC payload field fails a test.
- The guards are exact-set assertions, not minimums.

</intent-contract>

## Verification

- `cd apps/desktop/src-tauri && cargo test --lib cloud_link` — 8 pass
- `cd apps/desktop && pnpm vitest run src/hooks` — 58 pass
- `cd apps/desktop && npx playwright test tests/picker.spec.ts tests/auth.spec.ts` — 41 pass

## Auto Run Result

Status: done

Three layers of evidence, all automated:

1. **Rust, crate-wide.** `cloud_link::tests::nothing_on_the_login_or_migrate_path_can_reach_the_network` walks `src-tauri/src`, collects every module mentioning `reqwest`/`TcpStream`, and asserts the set is *exactly* `{commands/auth.rs, maintenance/catalog.rs}` — the vehicle catalog is the pre-existing, unrelated networked module and is named explicitly so a new one fails the test — then asserts none of the four login/migrate modules appears in it. The sweep skips its own file (which quotes the needles) and fails if it finds fewer than 20 sources, so a broken walk cannot pass silently. `the_oauth_module_only_ever_addresses_the_two_cognito_endpoints` matches the composed-URL form `{}/oauth2/…`, which is the only way that module builds a request target, so a path merely named in prose is not mistaken for a call site.
2. **IPC boundary.** `useAuth.test.tsx` asserts the full argument object of both entry points: `{ intent: { kind: "Login" } }` and `{ intent: { kind: "Migrate", source_dataset_id } }`. An added payload field fails it. Playwright asserts the same at the real click sites, plus that the picker's Cloud click issues no `select_dataset`/`mark_picker_passed`.
3. **Migration locality.** The Story 35.3 Rust tests exercise the copy end-to-end against a temp directory and the mock keyring, and pass with no network available: filesystem copy plus `credentials.rs` keyring writes only.

Not claimed: a live packet capture of a real Cognito round-trip. External services are never mocked through in this suite, and the sign-in flow is unreachable from the Vite harness (an existing, documented boundary in `auth.spec.ts`). The guards above bound what the code *can* do instead. Follow-up review recommendation: `true`.

## Cross-Epic Review Triage Log (Stories 35.2-35.6)

Two independent two-reviewer passes ran against the combined 35.2-35.6 diff (before, and after, a follow-up fix round). Findings and dispositions:

**Patched (both passes):**
- Header (`ProfileMenu.tsx`) and `/profile` (`SignInRequired.tsx`) sign-in actions silently switched the active dataset away from a local profile with no warning when clicked from a logged-out/session-expired/unavailable/unknown-kind state. Both now render a profile-kind-aware "Switch profile" action navigating to `/picker`; the panel's Migrate/Login action (reached only once truly signed in globally or on a cloud-linked profile) is unchanged.
- The panel's cloud action was gated on `activeProfile.isPending` only, which is `false` once a query errors — an errored `get_active_profile` could still show the wrong Login fallback. Gate changed to require a resolved `activeProfile.data`.
- OAuth failures before session storage (token exchange, state/callback parsing, missing pending attempt) emitted nothing; the picker's live Cloud button made this reachable (a hung, silently-re-enabled button with no toast). Failure signaling consolidated to one emission site (`auth:cloud-link-failed`) covering every failure path, not just the post-session-store branch.
- `copy_ai_credentials` treated a genuine keyring access error the same as "credential absent," risking a silently AI-keyless migrated profile. Now aborts the migration on any non-`NoEntry` read error.
- The 35.6 network guard excluded `cloud_link.rs` from its own audited set and used a narrow 2-name grep; module list and banned-name set both broadened, and the guard's claim narrowed to "no direct network client construction in these files' own source" (transitive calls into already-audited `auth.rs`/`ai::*` are explicitly out of scope, not a leak).
- Added: migration-from-Default coverage (no root-level sidecar files copied), pure-function tests for `cloud_link_failure_message`/`cloud_identity`, an in-app `/picker` switch coverage case (`needsPicker: false`), and `list_datasets` stubbing so the retargeted "Switch profile" tests assert the destination actually renders.

**Deferred (documented, not fixed this pass):** `checkpoint_active_source`/`activate`/`resolve_intent` branch dispatch has no direct behavioral test (covered only indirectly via `migrate_to_cloud_dataset_at`'s error-handling test); a live-WAL-connection checkpoint-then-copy round trip is untested (existing `backup.rs`-era gap, not introduced here); the badge's one truly discriminating state (cloud-linked + signed-out while the machine session is a *different* signed-in account) has no dedicated Playwright case.
