---
title: 'Activate hosted AI with a CountTokens-capable direct model'
type: 'feature'
created: '2026-08-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: '7d82c8a5bb7909e11c1205285ae6bc318fd60e39'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/_bmad-output/specs/spec-cloud-bedrock/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deployed hosted-AI gateway is inert because its Sonnet 4.6 inference profile rejects the mandatory pre-reservation `CountTokens` call, the account cannot yet reserve concurrency 10, and no premium user configuration exists.

**Approach:** Replace the unsupported inference profile with direct Claude 3.7 Sonnet in `eu-west-2`, which live testing proves accepts `CountTokens`; preserve the `us-east-1` API stack while making the Bedrock runtime region explicit. After AWS approves the pending Lambda quota increase and EU inference streaming is available, deploy concurrency 10 through GitHub OIDC and grant the confirmed Cognito account a 200-request monthly quota.

## Boundaries & Constraints

**Always:** Keep `CountTokens` before reservation; keep server-owned model/region; scope IAM to the one direct foundation-model ARN; update EN/FR disclosures from US cross-region processing to direct London processing; deploy infrastructure only through GitHub Actions; keep `GLOBAL` disabled until the model stream, concurrency, user record, and all rollout gates pass.

**Ask First:** Any fallback from direct Claude 3.7 Sonnet, any region other than `eu-west-2`, any monthly user limit other than 200, or enabling `GLOBAL` before all acceptance evidence exists.

**Never:** Remove/weaken token counting, use an inference profile for the replacement, deploy locally, expose model selection to clients, enable unbounded Lambda concurrency, overwrite an existing user configuration silently, or put email/content in DynamoDB.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Direct model gate | Claude 3.7 Sonnet in `eu-west-2` | `CountTokens` and `ConverseStream` use the same bare model ID and region | Do not deploy active traffic until both live probes pass |
| Concurrency activation | Lambda quota can preserve AWS's unreserved floor | Deploy reserved concurrency 10 | Quota pending/denied keeps deployed value 0 |
| Premium grant | Confirmed Cognito user `nicobaz010@live.ca` | `USER#<sub>/CONFIG`, premium true, monthly limit 200 | Conditional write refuses overwrite |
| Global state | No `GLOBAL/CONFIG` item or disabled item | Hosted traffic remains unavailable | Never create enabled global state implicitly |

</frozen-after-approval>

## Code Map

- `apps/api-bedrock/src/lib/bedrock-client.ts` -- runtime client currently inherits Lambda region; add required `BEDROCK_REGION` ownership.
- `apps/api-bedrock/template.yaml` -- replace inference-profile parameters/IAM with the direct `eu-west-2` Claude 3.7 foundation model; expose model region to Lambda; active reservation remains exactly 10.
- `apps/api-bedrock/src/{lib/bedrock-client,template-scaffold}.test.ts` -- lock direct model ID, region, ARN, CountTokens/stream command parity, and no inference-profile resource.
- `.github/workflows/api-bedrock-ci.yml`, `src/deploy-pipeline.test.ts` -- remove obsolete inference-profile secret and assert deployed concurrency against the configured active value.
- `_bmad-output/planning-artifacts/architecture-cloud-bedrock.md`, `architecture/.../ARCHITECTURE-SPINE.md` -- record the user-approved direct-model/region amendment.
- `apps/web/src/locales/{en,fr}.json`, `LegalPage.test.tsx` -- disclose direct London Bedrock processing accurately.
- `docs/runbooks/hosted-ai-rollout.md`, `docs/project-context.md` -- replace the resolved CountTokens blocker with the streaming-verification and pending-quota gates.
- DynamoDB `nixus-bedrock-api-HostedAiTable-VE6FZHJTJCBE` -- operational conditional write keyed only by Cognito `sub`.

## Tasks & Acceptance

**Execution:**
- [x] Update architecture, template, runtime client, workflow, legal copy, and tests for direct Claude 3.7 Sonnet in `eu-west-2`.
- [x] Verify `CountTokens` and `ConverseStream` live with the exact configured identity before active deployment. — Both passed against `anthropic.claude-3-7-sonnet-20250219-v1:0` in `eu-west-2`; streaming returned `OK.`.
- [ ] Wait for/verify Lambda concurrency quota approval, then set GitHub environment concurrency to 10 and deploy through OIDC. — **blocked on AWS.** Quota request `87ed4948ee0d48d59c3637f58a2ed33bo8DRLke8` is still `CASE_OPENED`. The code path is ready: template `Default` `0`, `AllowedValues [0, 10]`, activation via `HOSTED_AI_RESERVED_CONCURRENCY` on the protected `production` environment, validated (`0|10` plus a Service Quotas unreserved-floor check) **before** `sam deploy` and asserted against the deployed function afterwards.
- [x] Conditionally create the content-free premium user config with monthly limit 200; leave GLOBAL disabled. — Created `USER#d4d8d418-b0d1-708b-18ba-7ca36956eb1d / CONFIG` with `premium=true`, limit `200`, and no email/content fields; `GLOBAL/CONFIG` remains absent.

**Acceptance Criteria:**
- Given the direct model configuration, when service tests and live probes run, then token counting and streaming target the same model/region and succeed.
- Given approved Lambda quota, when GitHub deploys, then stack update completes and deployed reserved concurrency equals 10.
- Given the confirmed Cognito account, when premium config is written, then exactly one `USER#<sub>/CONFIG` item exists with premium true and monthly limit 200.
- Given completion, when global state is inspected, then hosted traffic is still disabled until an explicit later enablement decision.

## Live Evidence (2026-08-26)

This section is the deployment record. The account-specific values below live here
deliberately and **not** in the runbook's reusable command text, which is parameterised on
`PREMIUM_EMAIL` and derives the pool and table from the deployed stack.

| Item | Outcome |
|---|---|
| `CountTokens` on `anthropic.claude-3-7-sonnet-20250219-v1:0` / `eu-west-2` | **PASS** — returned an input-token count. Every probed `us.anthropic.*` inference profile and the Nova direct models returned `ValidationException: The provided model doesn't support counting tokens`. |
| `ConverseStream` on the same model/region | **PASS** — streamed to completion; the model replied `OK.` |
| Premium user record | **CREATED** — `USER#d4d8d418-b0d1-708b-18ba-7ca36956eb1d / CONFIG`, written conditionally (`attribute_not_exists(pk) AND attribute_not_exists(sk)`), `premium=true`, `monthly_request_limit=200`, no email/name/content attributes. |
| `GLOBAL/CONFIG` | **ABSENT** — deliberately not created, so every `POST /v1/ai/invoke` answers `503 hosted_unavailable` and no hosted traffic is possible. |
| Lambda concurrency quota increase `87ed4948ee0d48d59c3637f58a2ed33bo8DRLke8` | **CASE_OPENED** — still pending at AWS. Sole remaining activation blocker. |
| Reserved concurrency | `0` (inert) — the function cannot execute at all. |

Not proved by any of the above, and not to be treated as proved: direct-model
lifecycle/access, multimodal PDF+image compatibility, the 8192 output ceiling, and
`eu-west-2` per-model RPM/TPM quotas (runbook §0.3, gates 1c–1f).

## Spec Change Log

### 2026-08-26 — code, docs, and disclosure landed; quota is the only blocker

Implemented: `BEDROCK_REGION` ownership in `src/lib/bedrock-client.ts` (explicit, required,
trimmed, region-shape checked, one client shared by both commands) plus runtime rejection of
a profile-shaped `BEDROCK_MODEL_ID` before any SDK call; template parameters
`BedrockModelId` and `BedrockRegion` pinned to single-entry `AllowedValues` and deliberately
never passed as deploy-time overrides; the Bedrock IAM grant narrowed to one derived
foundation-model ARN; the obsolete `BedrockInferenceProfileArn` /
`BedrockFoundationModelArnPattern` parameters and the `BEDROCK_INFERENCE_PROFILE_ARN` deploy
secret removed; the reservation hoisted to one job-level env source, validated (`0|10` plus a
Service Quotas unreserved-floor check) **before** `sam deploy`, and asserted afterwards
together with the deployed model/region on **both** the stack outputs and the Lambda
environment; EN+FR **Terms and** Privacy copy moved to direct London processing
(`privacyPage.limits.crossRegion` → `privacyPage.limits.processingRegion`) with the absolute
"outside your own country" claim replaced by "may be outside your country of residence";
runbook §0 rewritten around two passing probes, §0.3 added for the four capability checks a
text-only stream probe does not cover, model-invocation logging checked in both `eu-west-2`
and `us-east-1`, and §3.2 parameterised on `PREMIUM_EMAIL` with stack-derived pool/table and
an exactly-one-confirmed-match guard; both architecture documents carry a dated,
user-approved amendment.

Not implemented: the concurrency activation, which is waiting on AWS.

## Design Notes

Live evidence: every tested `us.anthropic.*` inference profile and Nova direct model rejected Runtime `CountTokens`. Bare `anthropic.claude-3-7-sonnet-20250219-v1:0` in `eu-west-2` returned an input-token count and then streamed `OK.` through `ConverseStream`. Lambda quota increase request `87ed4948ee0d48d59c3637f58a2ed33bo8DRLke8` remains open for 1000 concurrent executions.

## Verification

**Commands:**
- `pnpm --filter @nixus/api-bedrock lint && pnpm --filter @nixus/api-bedrock typecheck && pnpm --filter @nixus/api-bedrock test && pnpm --filter @nixus/api-bedrock sam:validate && pnpm --filter @nixus/api-bedrock sam:build` -- expected: clean and warning-free.
- `pnpm --filter @nixus/web test && pnpm --filter @nixus/web build` -- expected: bilingual legal copy and prerender pass.
- GitHub `API Bedrock CI` -- expected: OIDC deploy succeeds and asserts reserved concurrency 10.
- AWS SDK live driver -- expected: direct model returns token count and streamed text.

## Suggested Review Order

**Model and region authority**

- Direct model and London region become single-valued infrastructure invariants.
  [`template.yaml:43`](../../apps/api-bedrock/template.yaml#L43)

- One explicitly region-pinned SDK client serves counting and streaming.
  [`bedrock-client.ts:117`](../../apps/api-bedrock/src/lib/bedrock-client.ts#L117)

**Safe activation**

- GitHub validates quota and configuration before the only sanctioned deployment.
  [`api-bedrock-ci.yml:101`](../../.github/workflows/api-bedrock-ci.yml#L101)

- Operational gates preserve concurrency zero until AWS approves reservation ten.
  [`hosted-ai-rollout.md:12`](../../docs/runbooks/hosted-ai-rollout.md#L12)

**Disclosure and architecture**

- Architecture amendment records the direct-model and cross-region decision.
  [`ARCHITECTURE-SPINE.md:231`](../../_bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md#L231)

- Bilingual legal copy identifies direct London processing without absolute residency claims.
  [`LegalPage.tsx:34`](../../apps/web/src/components/LegalPage.tsx#L34)

**Verification**

- Infrastructure tests reject model, region, IAM, or concurrency drift.
  [`template-scaffold.test.ts:175`](../../apps/api-bedrock/src/template-scaffold.test.ts#L175)

- Runtime tests exercise the production client path and command identity parity.
  [`bedrock-client.test.ts:274`](../../apps/api-bedrock/src/lib/bedrock-client.test.ts#L274)
