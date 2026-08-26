---
title: 'Nixus Cloud Bedrock — all remaining stories'
type: 'feature'
created: '2026-08-25'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '765f552074f03c30da65d7b00d0796eee1adcfd4'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/_bmad-output/specs/spec-cloud-bedrock/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md'
warnings:
  - multiple-goals
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 1 established the canonical cloud-AI contract and service scaffold, but stories 2–8 remain: protected infrastructure, quota accounting, streamed Bedrock invocation, desktop authentication and provider routing, migration of all four AI surfaces, and guarded production rollout.

**Approach:** Implement the remaining stories in dependency order against the frozen Cloud Bedrock architecture. Preserve existing BYO behavior while adding hosted Bedrock as the premium-first adapter, then complete infrastructure, privacy, legal, operational, and deployed acceptance gates before enabling traffic.

## Boundaries & Constraints

**Always:** Use the shared closed wire contract; authorize Cognito access tokens carrying `nixus-api/ai.invoke`; keep AWS credentials off devices; enforce per-user and global request caps atomically; treat `messageStart` as output commit and finalize token accounting at stream end; keep prompts, responses, attachments, and file paths out of Nixus persistence/logs; preserve `credentials.rs` as the sole keyring accessor; keep hosted status Rust-internal and subject-bound; retain warning-free strict TypeScript/Rust and behavior-lock tests.

**Block If:** A deployed capability probe proves the selected `us.anthropic.claude-sonnet-4-6` inference profile cannot execute the architecture-mandated Bedrock Runtime `CountTokens` request from `us-east-1`; do not silently change the model, region, or exact pre-reservation token gate because each option changes cost enforcement or data processing.

**Never:** Couple premium hosted AI to module licensing; add an in-app consent/status UI; trust body-supplied identity; expose client model/token controls; use static AWS deployment credentials; create the OIDC deploy role in the application stack; enable `GLOBAL.enabled` before legal, alarms, budget, scope, deployed smoke, and all four surface checks pass; fall back after output commit or for validation/size/encoding failures.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Eligible invocation | Scoped Cognito user, premium and global enabled, both quotas available | Count input, atomically reserve user/global units, stream canonical NDJSON, finalize both counters | Pre-commit failures refund once; post-commit failures emit terminal error and never refund/fallback |
| Ineligible invocation | Missing premium, exhausted user/global quota, or kill switch disabled | Reject before `CountTokens` and before model invocation | Emit canonical 403/429/503; desktop applies only the closed fallback table |
| Invalid request | Unknown field/operation, illegal media shape, unsupported encoding, oversized decoded media | Reject at transport/schema boundary | Canonical 400/413/415; no fallback and no quota mutation |
| Auth scope absent | Valid legacy session without `nixus-api/ai.invoke` | Require full reauthentication; refresh cannot add scope | BYO may serve that call where supported; cache never crosses subjects |
| Stream commits | Bedrock emits `messageStart` | Write streaming prelude, exactly eight NUL bytes, then meta/delta/end frames | Any later failure is in-band, charged, finalized, and not retried |
| Hosted unavailable | Pre-commit gateway/Bedrock/global failure | Preserve local app and use configured BYO provider where allowed | Bedrock-only statement import returns typed error without BYO Bedrock |
| Rollout gate | Code complete but legal/alarms/budget/scope/smoke incomplete | Keep global config disabled | Runbook forbids enablement until every gate is evidenced |

</intent-contract>

## Code Map

- `packages/shared/src/types/cloud-ai.ts` -- completed Story 1 canonical contract; consume without local redefinition.
- `apps/api-bedrock/template.yaml` -- replace the no-op scaffold with Regional REST streaming API, scoped Cognito authorizer, one Lambda, retained/PITR DynamoDB table, custom domain, logs, alarms, and budget resources.
- `apps/api-bedrock/src/template-scaffold.test.ts` -- supersede the Story 1 “no functional resources” guard with infrastructure contract tests before adding resources.
- `apps/api-bedrock/src/functions/api.ts` -- sole `streamifyResponse` entry point and status/invoke router.
- `apps/api-bedrock/src/lib/{table,quota,bedrock-client}.ts` -- strongly consistent config reads, atomic idempotent reserve/refund/finalize, and CountTokens/ConverseStream adapters.
- `apps/api-bedrock/src/handlers/{status,invoke}.ts` -- closed boundary parsing, eligibility order, streaming commit, deadline, errors, and privacy-safe logs.
- `.github/workflows/api-bedrock-ci.yml` -- PR verify and protected default-branch OIDC deployment; no static AWS keys.
- `apps/desktop/src-tauri/src/commands/auth.rs` -- add hosted scope, scope parsing, call-time token refresh, and 120-second expiry skew.
- `apps/desktop/src-tauri/src/credentials.rs` -- read-only keyring boundary used by auth; hosted adapter must not call keyring directly.
- `apps/desktop/src-tauri/src/ai/{backend,hosted_bedrock,hosted_state}.rs` -- common provider port, hosted HTTP/NDJSON adapter, and subject-scoped status cache.
- `apps/desktop/src-tauri/src/ai/{chat,cc_parser,project_advice,trends_insight}.rs` -- four migration surfaces; retain prompts/parsers and remove statement-path logging.
- `apps/desktop/src-tauri/src/commands/{chat,import,projects,spending_trends}.rs` -- route every invocation independently through backend precedence/fallback.
- `apps/desktop/src-tauri/src/error.rs` -- canonical `HostedAi { code, message, recoverable }` serialization.
- `apps/desktop/src-tauri/src/commands/settings.rs` -- behavior-lock boundary: credential testing remains BYO-only.
- `README.md`, `apps/web/src/locales/{en,fr}.json` -- correct all local-only claims while preserving precise Nixus-controlled non-retention language.
- `apps/web/src/routes/{terms,privacy}.tsx`, `apps/web/src/routes/fr/{terms,privacy}.tsx`, `apps/web/src/components/SiteFooter.tsx` -- create and link bilingual disclosures required by AD-13.
- `docs/runbooks/hosted-ai-rollout.md` -- manual Cognito/OIDC/global-config setup, rollback, alarm/budget checks, and enablement evidence.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api-bedrock/src/template-scaffold.test.ts`, `template.yaml`, `samconfig.toml`, `.github/workflows/api-bedrock-ci.yml` -- test first, then provision the protected streaming shell and OIDC pipeline with hosted traffic disabled.
- [x] `apps/api-bedrock/src/lib/table.ts`, `quota.ts`, `handlers/status.ts` and co-located tests -- implement exact-field, race-safe monthly user/global quota authority and status reads.
- [x] `apps/api-bedrock/src/lib/bedrock-client.ts`, `handlers/invoke.ts`, `functions/api.ts` and co-located tests -- implement request order, model ceilings, idempotent accounting, messageStart commit, canonical streaming, and privacy-safe failures.
- [x] `apps/desktop/src-tauri/src/commands/auth.rs` and tests -- add hosted scope, 120-second skew, missing-scope reauthentication, and one refresh retry without altering keyring ownership.
- [x] `apps/desktop/src-tauri/src/ai/{backend,hosted_bedrock,hosted_state}.rs`, `error.rs` and tests -- add the unified backend and hosted adapter while locking BYO/profile behavior first.
- [x] `apps/desktop/src-tauri/src/ai/{chat,cc_parser,project_advice,trends_insight}.rs`, corresponding command files, and tests -- migrate all surfaces, enforce the closed fallback matrix, preserve stream/parser behavior, and remove sensitive logs.
- [x] `README.md`, bilingual web locale/legal routes, footer tests, deployment smoke tests, and `docs/runbooks/hosted-ai-rollout.md` -- complete disclosures and operational acceptance before enablement.

**Acceptance Criteria:**
- [x] Given a scoped premium test user and disabled BYO credentials, when each of chat, statement import, project advice, and trends insight runs, then every surface uses hosted Bedrock and preserves its existing observable output contract.
  - All four surfaces route through `ai/backend::invoke`; `no_surface_calls_a_concrete_provider_directly` fails the build if any regains a direct client call. `ai/hosted_e2e.rs` drives chat and statement import against a live local gateway with `byo = None`, asserting incremental deltas in order and the attachment travelling as message content.
- [x] Given concurrent requests at user or global limits, when reservations race, then charged counts never exceed configured limits and retries cannot double reserve, refund, or finalize.
  - `apps/api-bedrock/src/lib/quota.test.ts` (22 tests): one `TransactWriteItems` per kind over both user and `GLOBAL` items, positional cancellation-reason classification, distinct `ClientRequestToken`s, and finalize never touching `charged_count`.
- [x] Given every closed pre-output failure class, when the desktop receives it, then fallback occurs only where the binding matrix permits and never after `messageStart`.
  - `route_pre_output` covers all eight codes x refresh budget; `an_error_frame_after_meta_never_falls_back` proves the commit boundary end to end; `statement_import_reports_the_hosted_reason_instead_of_degrading_to_openai` proves the Bedrock-only rule, paired with `a_text_only_surface_does_reach_the_openai_fallback` so the rule is specific rather than a blanket refusal.
- [x] Given sign-out, session expiry, callback subject change, or another subject signing in, when hosted status is consulted, then no cached status from the former subject is used.
  - `ai/hosted_state.rs` tests plus `a_cleared_session_drops_the_cached_status`; `hosted_ai_auth_from_resolved` clears on every non-usable session and on a missing scope.
- [x] Given a pull request and a protected default-branch deployment, when CI runs, then lint, typecheck, tests, SAM validation/build, OIDC credential acquisition, and guarded deployment use no long-lived AWS key.
  - `apps/api-bedrock/src/deploy-pipeline.test.ts` (17 tests) scans the workflow directives for any static key and asserts `configure-aws-credentials@v6` + `environment: production`.
- [ ] Given the production rollout checklist, when `GLOBAL.enabled` is changed to true, then legal copy, Cognito scope, retained table, alarms, budget, model logging settings, deployed API smoke tests, and four-surface release acceptance all have recorded evidence.
  - **Blocked, not merely open.** Gate 1 has now been probed and **failed**: `CountTokens` is unsupported on the selected inference profile (see the Review Triage Log). Enablement cannot proceed on the present design. Gates 1a-1c (Lambda quota increase, reviewed flip of `HostedAiReservedConcurrency` to `10`, deployed reservation assertion) are additional prerequisites. The stack is deployable in its inert state meanwhile.

## Spec Change Log

## Review Triage Log

### 2026-08-26 — deployability review (inert-state deployment)

Deployment was attempted and **failed**, producing two findings that changed the
design. Local deployment is now prohibited; GitHub Actions with OIDC is the only path
that may mutate the stack.

| Finding | Severity | Resolution |
|---|---|---|
| Reserving concurrency 10 breaches AWS's 50-unreserved-capacity floor at this account's Lambda quota of 50, so the initial `CREATE` rolled back | Blocker | `HostedAiReservedConcurrency` parameter, `Default: 0`, `AllowedValues: [0, 10]`, applied by `!Ref`. 0 is inert and reserves nothing from the pool, so the stack is deployable now; 10 stays AD-4's mandated active value and a prerequisite for enablement. The reservation is never removed — it is AD-4/AD-14's abuse bound |
| A failed initial `CREATE` leaves the stack in `ROLLBACK_COMPLETE`, which CloudFormation cannot update, blocking every retry | Blocker | Deploy job deletes the stack and waits, **if and only if** the status is exactly `ROLLBACK_COMPLETE` — a state with no successfully created resources to lose. Every other state, including a live stack or a failed `UPDATE`, is left strictly alone |
| A template `!Ref` proves nothing about the value CloudFormation applied, and the difference is "cannot invoke Bedrock" versus "can" | High | Post-deploy `aws lambda get-function-concurrency` assertion fails the job unless the deployed reservation is 0. Expected to be updated to 10 in the same reviewed PR that flips the default |
| `CountTokens` on the selected inference profile was never verified live | Blocker | **Probed and rejected** — see below. Enablement blocked |
| FR `privacyPage.limits.crossRegion` risked a breakable space before `;` | Low | Value is `États-Unis\u00A0;`; the focused legal punctuation guard rejects both a plain space and a thin space |
| `docs/project-context.md` still described `apps/api-bedrock` as a scaffold with no deploy config | Medium | Rewritten with the real deploy config, the inert-state and CountTokens blockers, and the desktop hosted-AI boundaries |

**Rejected findings, not implemented:** deriving DynamoDB `ClientRequestToken`s from
`client_request_id` (tracing-only by architecture); removing the once-computed
reserve/refund/finalize tokens; restoring zero-skew auth; adding a provider toggle or
status UI; altering the model, region, or `CountTokens` gate; adding fallback for
payload-size/validation/encoding errors; enabling `GLOBAL`.

### Deployment blocker — `CountTokens` unsupported on the selected profile

The AD-8 pre-reservation gate was probed against the exact architecture-selected
model, profile, and region and was **rejected**:

```
$ aws bedrock-runtime count-tokens --region us-east-1 \
    --model-id us.anthropic.claude-sonnet-4-6 \
    --input '{"converse":{"messages":[{"role":"user","content":[{"text":"probe"}]}]}}'

ValidationException: The provided model doesn't support counting tokens
```

This satisfies the spec's **Block If** condition. `POST /v1/ai/invoke` cannot complete
for any caller while step 3 of the AD-8 order is a call this model rejects: every
eligible request fails at the gate and is classified `503 hosted_unavailable`.

The model, region, and pre-reservation token gate **may not be changed silently** —
each alters cost enforcement or data processing, so any change is a specification
change requiring architecture review. Until such a review lands:

- `GLOBAL.enabled` stays `false`,
- the Lambda stays inert at reserved concurrency `0`,
- everything else remains deployable, inspectable, and verifiable in that state.

Recorded as gate 1 (FAILED) in `docs/runbooks/hosted-ai-rollout.md`, with gates 1a-1c
added for the Lambda quota increase, the reviewed flip to `10`, and the deployed
reservation assertion.

## Design Notes

**Implementation-time findings (2026-08-26).** Three defects were found by verifying rather than assuming, each fixed:
1. `typeof awslambda === "undefined"` is not a valid runtime guard — importing `@aws-sdk/client-bedrock-runtime` itself defines `globalThis.awslambda` as an empty object, so the guard passed outside Lambda and then threw on the missing method. The guard now checks for the function.
2. `sam build` produced an artifact exporting nothing: the package's `"type": "module"` made the CJS bundle be read as ESM. The Makefile now pins `{"type":"commonjs"}` and asserts the handler loads at build time.
3. `commands/chat.rs` logged `result_msg` ("Done. $45.00 expense added for Costco."), putting model-derived transaction content in an app log. Removed, and locked by `no_ai_command_logs_transaction_content`.

The `cloud_link.rs` networked-module guard was updated deliberately to admit `ai/hosted_bedrock.rs`: it is networked by design and is not on the Login/Migrate/keyring path that guard protects.


The architecture-selected profile `us.anthropic.claude-sonnet-4-6` is documented to support `CountTokens` at the foundation-model level, but AWS does not document inference-profile support and the model is cross-region-only from `us-east-1`; its model card also provides no Bedrock Mantle fallback. A live SDK probe against the exact profile and region returned `ValidationException: The provided model doesn't support counting tokens.` Production enablement therefore remains blocked pending architecture review.

GitHub environment OIDC subjects under immutable claims use `repo:OWNER@OWNER_ID/REPO@REPO_ID:environment:production`; the out-of-band deploy-role trust policy must verify the exact subject emitted by this repository.

## Verification

**Commands:**
- `pnpm --filter @nixus/api-bedrock lint && pnpm --filter @nixus/api-bedrock typecheck && pnpm --filter @nixus/api-bedrock test && pnpm --filter @nixus/api-bedrock sam:validate && pnpm --filter @nixus/api-bedrock sam:build` -- expected: strict service and infrastructure gates pass without warnings.
- `pnpm --filter @nixus/shared typecheck && pnpm --filter @nixus/shared test` -- expected: canonical contract remains unchanged and consumable.
- `pnpm --filter @nixus/desktop exec tsc --noEmit && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml && pnpm --filter @nixus/desktop exec playwright test` -- expected: desktop compile, Rust tests, and all user flows pass.
- `pnpm --filter @nixus/web test && pnpm --filter @nixus/web build` -- expected: bilingual legal/marketing changes test and prerender successfully.

## Auto Run Result

Status: complete
Resolution: implemented the frozen architecture literally and deployed the production stack in its inert state through GitHub OIDC. Production enablement remains blocked because the selected inference profile rejects `CountTokens`; `GLOBAL` is unseeded and Lambda reserved concurrency remains `0`.

### Review-patch pass (recorded 2026-08-26)

Fourteen review patches applied in one pass. The frozen intent-contract, model, region,
`CountTokens` gate, and fallback matrix are unchanged; the rejected findings were not
implemented (idempotency tokens stay server-generated and once-computed, the 120s skew
stays global, no provider toggle or status UI was added, no fallback was added for
validation/size/encoding, and `GLOBAL.enabled` was not touched).

| # | Patch | Evidence |
|---|---|---|
| 1 | REST integration timeout + canonical GatewayResponses | `template-scaffold.test.ts` 30 passed; `sam validate --lint` accepts `TimeoutInMillis`. Stage throttling now answers `503 hosted_unavailable`, so it can no longer be misread as monthly `quota_exhausted`. |
| 2 | `refund_failed` / `finalize_failed` observability | `handlers/invoke.test.ts` 44 passed. Failures are logged with only the error's constructor name, never replace a committed response, and cannot skip `sink.end()`. |
| 3 | Delta-before-meta, 1 MiB NDJSON line cap, HTTPS-or-loopback | `ai::hosted_bedrock` 21 passed, `ai::hosted_e2e` 21 passed. |
| 4 | Precedence disclosure + FR locality corrections | `LegalPage.test.tsx` 8 passed; EN/FR key parity 235/235. |
| 5 | Non-cancelling deploy concurrency | `deploy-pipeline.test.ts` 19 passed. |
| 6 | `mktemp` + trap cleanup; stack-resource API lookup | `deploy-pipeline.test.ts`; `bash -n` clean. |
| 7 | Real `createBedrockPort` through the SDK seam | `bedrock-client.test.ts` 26 passed - proves CountTokens carries `system` and ConverseStream carries the per-operation ceiling. |
| 8 | Scripted 401 -> refresh -> 200 | `ai::hosted_e2e` proves exactly two invoke calls and a changed bearer token. Verified non-tautological by replaying the old token (assertion failed as designed). |
| 9 | Privacy guards incl. `commands/import.rs`, multi-line macros | Proven by restoring both a statement path and transaction content in multi-line macro form; both failed the guard, then reverted. |
| 10 | `build_turn` role mapping | `ai::chat` 15 passed. |
| 11 | French footer assertions | `SiteFooter.test.tsx` 11 passed, zero act warnings. |
| 12 | Own-property stop-reason lookup | Regression proven: the object-literal form resolved `constructor` to `[Function Map]`. |
| 13 | User-first alternating-role validation | Confirmed against the AWS Bedrock user guide (Anthropic Messages API "operates on alternating user and assistant conversational turns") and this repo's own `alternating_turns` comment. Trailing-assistant prefill deliberately kept legal. `validation.test.ts` 45 passed. |
| 14 | Typed frontend `hosted_ai` handling | `appError.test.ts` 13 passed. Chat previously replaced the error with a hardcoded English retry line; project advice and trends insight discarded the error object entirely. |

Not implemented, deliberately: a `token_endpoint()` test seam was added for patch 8, gated
behind `#[cfg(test)]` so a release build compiles to the constant and the override branch
does not exist. `cargo check --release` confirms 0 warnings.

### Verification evidence (recorded 2026-08-26)

| Gate | Result |
|---|---|
| `@nixus/api-bedrock` lint / typecheck | clean |
| `@nixus/api-bedrock` test | 235 passed / 10 files |
| `@nixus/api-bedrock` sam:validate / sam:build | valid template; Build Succeeded (artifact self-check asserts the handler loads) |
| `@nixus/shared` typecheck / test | clean; 60 passed |
| `cargo check --all-targets` (debug and release) | 0 warnings, 0 errors in both profiles |
| `cargo test` | 1010 passed, 0 failed (8.5s) |
| `@nixus/desktop` tsc --noEmit | clean |
| `@nixus/desktop` vitest | 432 passed / 23 files |
| `@nixus/desktop` playwright | 607 passed |
| `@nixus/web` lint / typecheck / test | clean; 187 passed / 25 files |
| `@nixus/web` build / verify:prerender / verify:routes | 13 pages prerendered; 10 routes agree; 8 sitemap routes resolve |

### Deployment evidence (recorded 2026-08-26)

| Gate | Result |
|---|---|
| GitHub Actions run | [32989184332](https://github.com/nickbazinet/nixus/actions/runs/32989184332) passed verify and deploy jobs at revision `26df247489ab5950341de8724fa5ed11da384d9b` |
| CloudFormation | `nixus-bedrock-api` is `CREATE_COMPLETE` in `us-east-1` |
| Stable endpoint | `https://api.nixusapp.com` |
| Authentication smoke | `GET /v1/ai/status` and `POST /v1/ai/invoke` both return canonical `401 unauthorized` envelopes without credentials |
| API edge | default execute-api endpoint disabled |
| Inert-state control | Lambda `ReservedConcurrentExecutions = 0` |
| Quota table | PITR `ENABLED`; `GLOBAL / CONFIG` item absent |
| Content logging | Bedrock model invocation logging configuration absent |
| CountTokens gate | exact `us.anthropic.claude-sonnet-4-6` profile probe rejected with `ValidationException: The provided model doesn't support counting tokens` |

The stack is deployed but cannot serve hosted model calls: concurrency `0`, no global
configuration item, and the failed CountTokens gate are independent fail-closed controls.
The model, region, or pre-reservation gate must not change without architecture review.

Notes:
- Desktop Playwright: the JSON reporter records **607 expected, 0 unexpected, 0 flaky, 0 skipped**. The default reporter intermittently fails one test in `chat.spec.ts`'s "Floating Chat Bar" suite or `maintenance.spec.ts`'s Escape test under parallel load, on a *different* test each run. Proven pre-existing rather than caused by the patch-14 frontend changes: with those changes stashed, `chat.spec.ts` still failed 2 of 3 baseline runs, on lines 487 and 473 respectively. No Playwright spec was modified.
- The desktop Playwright suite stubs `window.__TAURI_INTERNALS__.invoke`, so it cannot exercise the Rust hosted path. That coverage is `src/ai/hosted_e2e.rs` (13 tests), which drives the real adapter against a live local gateway speaking the canonical NDJSON contract.
- Two guards were proven non-tautological by forcing the regression they name and watching them fail: statement-path logging and independent tool-loop routing.
