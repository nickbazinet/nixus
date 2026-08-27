---
title: 'Show premium Nixus Cloud AI status in the account menu'
type: 'feature'
created: '2026-08-26'
status: 'done'
baseline_commit: '8bb75fcd5a449732fd259b7fd20ee0eeee636729'
review_loop_iteration: 0
context:
  - 'docs/project-context.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A signed-in user whose Nixus Cloud account has hosted-AI premium access has no calm, discoverable confirmation of that entitlement in the desktop app.

**Approach:** Fetch the authoritative hosted-AI status only for the active, signed-in cloud profile, show `Premium` beside the expanded sidebar wordmark, and show a neutral `Premium` badge inside the account menu identity block. The menu has no explanatory caption, and no replacement label renders for non-premium, unavailable, signed-out, or local states.

## Boundaries & Constraints

**Always:** Keep Cognito identity, hosted-AI entitlement, and unimplemented module licensing separate. Derive premium from authenticated `/v1/ai/status` through Rust and expose only a boolean over IPC. Gate the query on an active cloud profile plus a logged-in account; reuse the shared cloud-AI contract and neutral `Badge`; localize EN/FR copy; keep status text outside menu roving focus; clear entitlement state on sign-in, sign-out, and profile switch.

**Ask First:** Showing request limits or usage, adding upgrade/management actions, placing premium status on another surface, or generalizing this into product/module licensing.

**Never:** Add premium to `AuthState`, infer it from sign-in, persist it, expose quota counters, show a `Free` label, toast on failure, redraw the logo, add a dependency, or call AWS from the frontend.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Eligible account | Active cloud profile, matching logged-in session, status `premium: true` | Expanded sidebar shows `Premium`; account menu shows a neutral `Premium` badge with no caption | N/A |
| Ineligible account | Same, status `premium: false` | No premium row and no free-tier replacement | N/A |
| No authenticated cloud account | Local profile, signed out, expired session, or subject mismatch | No entitlement request and no premium row | Existing account UI remains authoritative |
| Status unavailable | Authenticated request rejects, times out, or returns malformed data | Account menu remains fully usable with no premium claim | Fail silently; no toast or error panel |
| Identity changes | Sign-in, sign-out, or active-profile switch | Cached premium state cannot leak across accounts and is re-derived for the new identity | Remove/invalidate the entitlement query before rendering the new account |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/ai/hosted_bedrock.rs` -- existing authenticated `/v1/ai/status` fetch and wire parsing; reuse/extract this path rather than duplicate HTTP logic.
- `apps/desktop/src-tauri/src/ai/hosted_state.rs` -- Rust-internal routing cache; keep it internal and do not make this cache the frontend contract.
- `packages/shared/src/types/cloud-ai.ts` -- canonical `CloudAiStatusResponse` wire shape.
- `apps/desktop/src-tauri/src/commands/` and `apps/desktop/src-tauri/src/lib.rs` -- add/register a narrow read command that returns premium eligibility only.
- `apps/desktop/src/hooks/useAuth.ts`, `apps/desktop/src/hooks/useDatasets.ts`, `apps/desktop/src/lib/constants.ts` -- cloud-profile gating, identity transitions, and query-key ownership.
- `apps/desktop/src/components/auth/ProfileMenu.tsx` -- render the non-focusable entitlement row beneath signed-in identity details; preserve existing silent degradation.
- `apps/desktop/src/components/shared/AppSidebar.tsx` and `SidebarBrandHeader.tsx` -- render the wordmark-adjacent premium label only while the eligible rail is expanded; the brand/collapse/premium header is its own sibling component so the rail stays under the size ceiling.
- `packages/shared/src/ui/badge.tsx` -- reuse `Badge variant="neutral"`; no primitive change.
- `packages/shared/src/styles/tokens.css` and `src/styles/__tests__/contrast.test.ts` -- the `premium-ink` entitlement token, kept out of the status family and contrast-verified on all four surfaces in both modes.
- `apps/desktop/src/locales/{en,fr}.json` and `src/locales/__tests__/profile-i18n.test.ts` -- add paired `profile.*` strings and parity coverage.
- `apps/desktop/tests/auth.spec.ts`, `apps/desktop/tests/profile.spec.ts`, and `apps/desktop/src/hooks/__tests__/` -- account-menu, query, and Tauri-mock patterns.

## Tasks & Acceptance

**Execution:**
- [x] Rust hosted-AI/command files -- expose an authenticated, fail-closed premium boolean while preserving the internal routing cache and existing fallback behavior.
- [x] Frontend query files -- add a typed query key/hook with cloud+session gating and identity-transition cache clearing.
- [x] `ProfileMenu.tsx` and `AppSidebar.tsx` -- show only the account-menu badge and expanded-rail label for a confirmed eligible account.
- [x] Locale files and parity tests -- add paired EN/FR account-status copy.
- [x] Rust, hook, locale, and Playwright tests -- cover every matrix state and ensure always-mounted Tauri mocks degrade safely.

**Acceptance Criteria:**
- Given an authenticated premium cloud profile, when the rail is expanded and the account menu opens, then both surfaces show `Premium`, the menu has no adjacent caption, and keyboard order is unchanged.
- Given any non-premium, local, signed-out, expired, mismatched, loading, or error state, when the shell renders, then it makes no premium claim and all existing account actions remain usable.
- Given an identity or profile transition, when the next account renders, then no prior account's premium state is visible.
- Given English or French and light, dark, or forced-colors display, when the badge renders, then its text remains understandable and contrast-safe.

## Spec Change Log

- **Narrowed an existing architectural guard rather than deleting it.** `ai/backend.rs`'s
  `hosted_status_has_no_ipc_surface` asserted that hosted-AI status had *no* IPC surface at all —
  which this feature's approved Intent supersedes. It is now
  `hosted_status_exposes_no_ipc_surface_beyond_the_entitlement_command`, keeping every part still
  true (the cache, the adapter and the port stay command-free, and `lib.rs` registers none of them),
  and a second guard, `the_entitlement_command_carries_no_usage_figure`, holds the new line: the
  command must answer `Result<bool, AppError>` and must not name `monthly_request_limit`,
  `charged_count`, `period`, `HostedAiStatus`, or `hosted_state`.
- **Accepted debt:** `ai/hosted_bedrock.rs` was already ~425 pure LOC before this change and is now
  ~486. The Code Map directs the entitlement read into this file, and the file's boundaries are
  asserted by path in three source guards, so splitting it is a separate, independently reviewable
  refactor rather than part of this feature.
- **Review fix — the entitlement gate now requires `is_signed_in`.** Profile kind plus a `LoggedIn`
  session was not sufficient: the session is machine-wide, so a cloud-linked profile whose account is
  not the signed-in one satisfied both and painted another account's entitlement. `is_signed_in` is
  Rust's own subject comparison (AD-10) and is what closes the matrix's subject-mismatch row.
- **Review fix — the status read spends the closed table's single refresh.** A `401` on
  `/v1/ai/status` now refreshes once and retries the read once, then fails closed. Scoped to the
  entitlement path: `fetch_status` never refreshes on its own, so `ensure_status` and invoke routing
  keep their existing single-attempt behaviour, and quota semantics are untouched.
- **Review fix — a positive registration guard.** Every other IPC guard asserts a symbol is absent,
  so an unregistered command passed them all and failed only at runtime — silently, because this
  feature's frontend is built to swallow a rejected entitlement read.
- **Structural:** the rail's brand/collapse/premium header moved to
  `components/shared/SidebarBrandHeader.tsx`, taking `AppSidebar.tsx` from 284 to 238 pure LOC.
  Verified pixel-identical across all eight viewport/theme/locale combinations.

## Design Notes

The latest human visual direction keeps the wordmark-adjacent `Premium` label and removes only the account-menu caption. The rail label is supplemental and appears with the expanded wordmark; the account menu remains the account-specific detail surface, using `neutral` to avoid presenting entitlement as success or warning.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero type errors.
- `pnpm --filter @nixus/desktop test` -- expected: all unit and locale tests pass.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` -- expected: all Rust library tests pass.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: full desktop E2E suite passes.
- `pnpm --filter @nixus/desktop build` -- expected: production frontend build exits zero.
- Browser visual QA at 1024×680 and 1280×800 in light/dark -- expected: premium row fits EN/FR, preserves menu focus order, and matches the reference design spine.

## Suggested Review Order

**Entitlement boundary**

- Start with the deliberately narrow boolean-only IPC entry point.
  [`cloud_ai.rs:12`](../../apps/desktop/src-tauri/src/commands/cloud_ai.rs#L12)

- Follow status caching, bounded 401 refresh, and fail-closed behavior.
  [`hosted_bedrock.rs:338`](../../apps/desktop/src-tauri/src/ai/hosted_bedrock.rs#L338)

- Verify registration and richer-status boundary guards.
  [`backend.rs:879`](../../apps/desktop/src-tauri/src/ai/backend.rs#L879)

**Identity-safe frontend binding**

- Confirm profile subject matching gates the shared entitlement query.
  [`useAuth.ts:131`](../../apps/desktop/src/hooks/useAuth.ts#L131)

- Review the gold expanded-rail label and unchanged wordmark control.
  [`SidebarBrandHeader.tsx:46`](../../apps/desktop/src/components/shared/SidebarBrandHeader.tsx#L46)

- Review the caption-free neutral badge outside menu roving focus.
  [`ProfileMenu.tsx:198`](../../apps/desktop/src/components/auth/ProfileMenu.tsx#L198)

**Visual contract**

- Inspect the dedicated entitlement ink token, separate from caution status.
  [`tokens.css:100`](../../packages/shared/src/styles/tokens.css#L100)

- Read the documented two-surface premium treatment and constraints.
  [`DESIGN.md:355`](../planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md#L355)

**Regression evidence**

- Trace eligible, mismatched, unavailable, localized, and collapsed states.
  [`profile.spec.ts:573`](../../apps/desktop/tests/profile.spec.ts#L573)

- Verify authenticated status reads, cache sharing, and single-refresh limits.
  [`hosted_e2e.rs:891`](../../apps/desktop/src-tauri/src/ai/hosted_e2e.rs#L891)

- Confirm both premium labels retain parity and avoid usage claims.
  [`profile-i18n.test.ts:224`](../../apps/desktop/src/locales/__tests__/profile-i18n.test.ts#L224)
