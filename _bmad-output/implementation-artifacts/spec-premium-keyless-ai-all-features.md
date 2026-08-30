---
title: 'Premium users can access every AI feature without BYO credentials'
type: 'bugfix'
created: '2026-08-29'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'e3e19218142753163bea6baa13dbbeaa20093028'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Spending Trends and Project Advice treat the BYO-credential flag as the complete AI-availability signal, so premium users without personal keys never reach the hosted-first backend. Statement import already reaches hosted AI without BYO credentials, but its frontend drops hosted error codes and can show misleading fallback guidance.

**Approach:** Treat AI as available when either BYO credentials are configured or the active signed-in cloud account is confirmed premium. Preserve the existing hosted-first Rust routing, quota policy, and BYO fallback while retaining statement-import hosted error details end to end.

## Boundaries & Constraints

**Always:** Keep BYO configuration and cloud premium entitlement as separate signals; combine them only at frontend availability gates. Use `usePremiumEntitlement()` as the authoritative fail-closed premium boolean. Preserve hosted-first routing for chat, statement import, project advice, and trends insight, including premium/no-BYO operation while hosted quota remains available. Add regression tests before production changes.

**Ask First:** Removing or changing hosted request quotas, allowing statement import to fall back to OpenAI, changing premium administration, or altering premium/error copy beyond what is required for accurate routing.

**Never:** Redefine `get_ai_config.configured`, infer premium from sign-in alone, couple hosted AI to module licensing, add a provider toggle, require personal keys for eligible hosted use, bypass `ai/backend.rs`, or expose quota counters through the premium entitlement hook.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Premium Trends | Premium true, BYO false, valid trend data | Insight request runs through hosted AI | Existing friendly insight error remains non-blocking |
| Premium Project Advice | Premium true, BYO false, valid project | Advice action is enabled and invokes hosted AI | Existing advice error UI remains usable |
| Premium Statement Import | Premium true, quota available, BYO false | Statement import invokes hosted Bedrock and reaches review | No setup-key prompt |
| BYO user | Premium false, BYO true | All provider-supported surfaces remain available through BYO fallback | Existing provider errors apply |
| No AI access | Premium false, BYO false | Trends/advice show existing setup state; import reports not configured | No hosted or BYO invocation succeeds |
| Hosted failure | Hosted attempt returns a typed code | Import retains and renders the matching hosted error | Never collapse premium/quota/auth errors into generic unavailable |
| Premium quota exhausted | Premium true, no remaining hosted quota, BYO false | Existing quota/fallback policy remains authoritative | Do not imply unlimited premium usage or silently bypass quota |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/routes/insights.trends.tsx:44-56` -- derives availability from BYO only and passes it into the insight query/panel.
- `apps/desktop/src/hooks/useTrendsInsight.ts:54` -- query executes only when the supplied availability gate is true; backend invocation is otherwise correct.
- `apps/desktop/src/components/projects/ProjectDetail.tsx:118,150-155,244` -- BYO-only guard blocks `advice.refetch()` and renders the setup card.
- `apps/desktop/src/hooks/useAuth.ts:120-159` -- existing `usePremiumEntitlement()` source; reuse without changing its boolean-only contract.
- `apps/desktop/src/hooks/useImport.ts:41-44,67-70,96-101` -- drops `HostedAi.code` and `recoverable` from event/rejection errors.
- `apps/desktop/src/lib/appError.ts:72-84` -- maps preserved hosted codes to specific localized messages.
- `apps/desktop/src-tauri/src/ai/backend.rs:199-273` -- read-only routing authority: hosted first, optional BYO fallback; do not modify unless a failing test proves necessary.
- `apps/desktop/src-tauri/src/ai/hosted_e2e.rs:346-413,596-632` -- existing real-HTTP-stub evidence that premium/no-BYO statement import succeeds and typed hosted failures survive Rust routing.
- `apps/desktop/src/hooks/__tests__/useTrendsInsight.test.tsx` and `apps/desktop/tests/import.spec.ts` -- extend established unit/E2E patterns for the missing states.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src/hooks/__tests__/useTrendsInsight.test.tsx`, `apps/desktop/tests/spending-trends.spec.ts`, and `apps/desktop/src/routes/insights.trends.tsx` -- write premium/no-BYO regressions first, then combine premium and BYO availability at the route boundary.
- [x] `apps/desktop/tests/projects.spec.ts` and `apps/desktop/src/components/projects/ProjectDetail.tsx` -- write a premium/no-BYO advice regression first, then enable the action and suppress the BYO setup card through the same two-signal composition.
- [x] `apps/desktop/src/hooks/__tests__/useImport.test.tsx`, `apps/desktop/tests/import.spec.ts`, and `apps/desktop/src/hooks/useImport.ts` -- write typed-error regressions first, then preserve serialized hosted `code` and `recoverable` for the existing parser.
- [x] `apps/desktop/src-tauri/src/ai/hosted_e2e.rs` -- add Statement Import coverage for the hosted-skipped/no-BYO branch, complementing the existing premium success path and locking the intentional quota/fallback boundary.

**Acceptance Criteria:**
- Given any of the four AI surfaces and an authenticated premium account with hosted quota, when no BYO key exists, then the surface reaches hosted AI without asking for credentials.
- Given a non-premium user with configured BYO credentials, when a supported AI surface is used, then existing BYO behavior is unchanged.
- Given statement import receives `premium_required`, `quota_exhausted`, `unauthorized`, or `hosted_unavailable`, when the error reaches React, then its original code selects the matching localized hosted-AI message.
- Given neither hosted eligibility nor usable BYO credentials, when an AI feature is invoked, then existing fail-closed setup/fallback behavior remains intact.

## Spec Change Log

- 2026-08-29 -- Availability composition landed as one shared `useAiAvailable()` in `apps/desktop/src/hooks/useAiConfig.ts` rather than duplicated in the two route/component boundaries, so the trends route and `ProjectDetail` cannot drift apart. The gate prop it feeds was renamed `aiConfigured` -> `aiAvailable` across `useTrendsInsight.ts` and `TrendsInsightPanel.tsx`, because the old name now describes only one of the two signals. No change to `get_ai_config.configured`, `usePremiumEntitlement()`, or `ai/backend.rs`.
- 2026-08-29 (review) -- Availability is a three-state `AiAvailability` (`available` / `unavailable` / `resolving`), not a boolean: collapsing "not entitled" and "not asked yet" into one `false` briefly showed personal-key setup UI to premium users and let a Project Advice click be accepted and discarded. `usePremiumEntitlement()` keeps its fail-closed boolean contract for indicator-only readers and now delegates to a new `usePremiumEntitlementState()` that also reports `resolving`; no quota figure is exposed (AD-9 intact). Trends renders its not-configured state only on `unavailable`; Project Advice disables the action while `resolving`. `useImport` merges the code-less `import:error` event non-destructively so a typed rejection always wins regardless of IPC delivery order, and `ImportError.code` is typed as `HostedAiErrorCode`.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero TypeScript errors.
- `pnpm --filter @nixus/desktop test` -- expected: all hook and locale tests pass.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` -- expected: all routing and hosted E2E tests pass without warnings.
- `pnpm --filter @nixus/desktop exec playwright test tests/import.spec.ts tests/spending-trends.spec.ts tests/projects.spec.ts` -- expected: premium/no-BYO and typed import-error user flows pass.
- `pnpm --filter @nixus/desktop build` -- expected: production frontend build exits zero.

## Suggested Review Order

**Availability contract**

- Start with the shared three-state composition of BYO and premium access.
  [`useAiConfig.ts:43`](../../apps/desktop/src/hooks/useAiConfig.ts#L43)

- Follow the identity-safe entitlement state and its resolving semantics.
  [`useAuth.ts:172`](../../apps/desktop/src/hooks/useAuth.ts#L172)

**Surface binding**

- Confirm Trends routes only resolved availability into generation and setup UI.
  [`insights.trends.tsx:44`](../../apps/desktop/src/routes/insights.trends.tsx#L44)

- Verify unresolved entitlement shows neutral loading, never personal-key guidance.
  [`TrendsInsightPanel.tsx:69`](../../apps/desktop/src/components/spending-trends/TrendsInsightPanel.tsx#L69)

- Verify Project Advice disables unresolved actions and enables premium hosted use.
  [`ProjectDetail.tsx:144`](../../apps/desktop/src/components/projects/ProjectDetail.tsx#L144)

**Import error fidelity**

- Inspect race-safe merging between code-less events and typed command rejection.
  [`useImport.ts:82`](../../apps/desktop/src/hooks/useImport.ts#L82)

- Confirm statement-import quota boundaries remain enforced without BYO credentials.
  [`hosted_e2e.rs:634`](../../apps/desktop/src-tauri/src/ai/hosted_e2e.rs#L634)

**Regression evidence**

- Trace premium, pending, unavailable, and BYO availability states.
  [`useAiConfig.test.tsx:129`](../../apps/desktop/src/hooks/__tests__/useAiConfig.test.tsx#L129)

- Trace reversed IPC delivery while preserving the hosted error discriminator.
  [`useImport.test.tsx:140`](../../apps/desktop/src/hooks/__tests__/useImport.test.tsx#L140)

- Exercise premium/no-key behavior through real browser-facing flows.
  [`spending-trends.spec.ts:271`](../../apps/desktop/tests/spending-trends.spec.ts#L271)
