---
title: 'Activate hosted AI with request-based US Bedrock quota'
type: 'feature'
created: '2026-08-26'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: '7d82c8a5bb7909e11c1205285ae6bc318fd60e39'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/_bmad-output/specs/spec-cloud-bedrock/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hosted AI moved to London solely to preserve a `CountTokens` preflight even though customer quota accounting is request-based and the product should remain in `us-east-1`.

**Approach:** Restore the `us.anthropic.claude-sonnet-4-6` inference profile in `us-east-1`, remove the `CountTokens` preflight, and charge exactly one quota unit for each actual `ConverseStream` request. Keep request-byte, media-size, output-token, API-throttle, and user/global monthly limits as the cost controls.

## Boundaries & Constraints

**Always:** Charge one `charged_count` unit per actual model invocation; keep the model server-owned; validate request bytes and media before reservation; reserve user/global quota atomically before `ConverseStream`; enforce output ceilings; deploy only through GitHub Actions; keep privacy-safe logs and fallback semantics.

**Ask First:** Any region outside `us-east-1`, any model other than Sonnet 4.6, any monthly user limit other than 200, or any change from request-based accounting.

**Never:** Reintroduce `CountTokens`, issue AWS credentials to devices, deploy locally, expose model selection to clients, count quota by tokens, overwrite user configuration silently, or persist email/content in DynamoDB.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hosted request | Sonnet 4.6 profile in `us-east-1` | One atomic quota reservation, then one `ConverseStream`; success consumes one request | Pre-commit failures refund once; post-commit failures remain charged |
| Oversized input | JSON/media exceeds server byte limits | Reject before quota reservation or model invocation | Canonical validation/size error; no fallback for malformed input |
| Premium grant | Confirmed Cognito user `nicobaz010@live.ca` | `USER#<sub>/CONFIG`, premium true, monthly limit 200 | Conditional write refuses overwrite |
| Global state | No `GLOBAL/CONFIG` item or disabled item | Hosted traffic remains unavailable | Never create enabled global state implicitly |

</frozen-after-approval>

## Code Map

_Reflects the 2026-08-27 amendment (request-based quota, no CountTokens, profile in
`us-east-1`). The earlier direct-model/eu-west-2 entries are superseded._

- `apps/api-bedrock/src/lib/bedrock-client.ts` -- one command only (`ConverseStreamCommand`); no `CountTokensCommand`, no `countInputTokens`, no `BEDROCK_REGION`; the client inherits the Lambda's `us-east-1`.
- `apps/api-bedrock/src/handlers/invoke.ts` -- no pre-reservation counting step; order is transport guard, schema/byte validation, eligibility, reserve, stream. Token figures come from stream metadata for observability.
- `apps/api-bedrock/src/lib/validation.ts` -- `OperationLimits` is bytes + output tokens only; `checkInputTokenCeiling` removed; 4 MiB media cap unchanged.
- `apps/api-bedrock/template.yaml` -- `BedrockModelId` pinned to `us.anthropic.claude-sonnet-4-6`, `BedrockInferenceProfileArn` + `BedrockFoundationModelArnPattern` restored, IAM grants streaming only (never `bedrock:CountTokens`), no `BedrockRegion`/`BEDROCK_REGION`/`BedrockRegionEcho`, no reserved concurrency.
- `apps/api-bedrock/src/{lib/bedrock-client,lib/validation,handlers/invoke,template-scaffold}.test.ts` -- lock: no CountTokens command/IAM/action, one Bedrock call per request, byte/media rejection before reservation, profile identity, request-based `charged_count`.
- `.github/workflows/api-bedrock-ci.yml`, `src/deploy-pipeline.test.ts` -- profile ARN as a deploy secret, model pinned from one job-level constant, post-deploy assertion of the model on stack output + Lambda env plus absence of an orphaned `BEDROCK_REGION`, and the unreserved-concurrency assertion.
- `_bmad-output/planning-artifacts/architecture-cloud-bedrock.md`, `architecture/.../ARCHITECTURE-SPINE.md` -- 2026-08-27 amendment withdrawing AD-8's token gate and restoring the profile.
- `apps/web/src/locales/{en,fr}.json`, `LegalPage.test.tsx`, `README.md` -- US cross-region processing, qualified as possibly outside the reader's country of residence; limit described as a monthly request count.
- `docs/runbooks/hosted-ai-rollout.md`, `docs/project-context.md` -- request-based quota, no CountTokens gate or London gate, capability evidence marked as owed a re-run through the profile.
- DynamoDB: existing `GLOBAL/CONFIG` (enabled, 1000) and the premium `USER#<sub>/CONFIG` (200) are untouched by this change.

## Tasks & Acceptance

**Execution:**
- [x] Update architecture, template, runtime client, workflow, legal copy, and tests for direct Claude 3.7 Sonnet in `eu-west-2`.
- [x] Verify `CountTokens` and `ConverseStream` live with the exact configured identity before active deployment. — Both passed against direct `anthropic.claude-sonnet-4-6` in `eu-west-2`; streaming returned `OK.`.
- [x] Remove function-level reserved concurrency and deploy through GitHub OIDC into the account's shared 50-concurrency pool; retain API throttling and DynamoDB hard caps. — GitHub run `32997823488` passed and `get-function-concurrency` has no reservation key.
- [x] Conditionally create the content-free premium user config with monthly limit 200; leave GLOBAL disabled. — Created `USER#d4d8d418-b0d1-708b-18ba-7ca36956eb1d / CONFIG` with `premium=true`, limit `200`, and no email/content fields; `GLOBAL/CONFIG` remains absent.

**Acceptance Criteria:**
- Given the direct model configuration, when service tests and live probes run, then token counting and streaming target the same model/region and succeed.
- Given the account's regional Lambda quota, when GitHub deploys, then stack update completes with no function-level reservation and the function can use unreserved capacity.
- Given the confirmed Cognito account, when premium config is written, then exactly one `USER#<sub>/CONFIG` item exists with premium true and monthly limit 200.
- Given completion, when global state is inspected, then hosted traffic is still disabled until an explicit later enablement decision.

## Live Evidence (2026-08-26)

This section is the deployment record. The account-specific values below live here
deliberately and **not** in the runbook's reusable command text, which is parameterised on
`PREMIUM_EMAIL` and derives the pool and table from the deployed stack.

| Item | Outcome |
|---|---|
| `CountTokens` on `anthropic.claude-sonnet-4-6` / `eu-west-2` | **PASS** — returned an input-token count; the `us.anthropic.claude-sonnet-4-6` inference profile rejected the same call. |
| `ConverseStream` on the same model/region | **PASS** — streamed to completion; the model replied `OK.` |
| Premium user record | **CREATED** — `USER#d4d8d418-b0d1-708b-18ba-7ca36956eb1d / CONFIG`, written conditionally (`attribute_not_exists(pk) AND attribute_not_exists(sk)`), `premium=true`, `monthly_request_limit=200`, no email/name/content attributes. |
| `GLOBAL/CONFIG` | **ENABLED** — monthly request limit 1000, explicitly activated for the first premium beta account on 2026-08-26. |
| Lambda concurrency quota increase `87ed4948ee0d48d59c3637f58a2ed33bo8DRLke8` | **WAIVED** — no longer a rollout dependency; the function uses the account's shared unreserved pool. |
| Function concurrency | **UNRESERVED** — GitHub run `32997823488` confirmed `get-function-concurrency` returns no reservation key. |
| Inert model deployment | **PASS** — GitHub Actions run `32996088072`; stack `UPDATE_COMPLETE`; stack outputs and Lambda environment both equal the approved direct model and `eu-west-2`. |
| Enabled PDF-compatible build | **PASS** — GitHub Actions run `32998849688`; no Lambda reservation, model/region assertions, PITR, and API smoke tests all passed. |

Additional live evidence: model lifecycle is `ACTIVE`; PDF streamed `PDF_OK`; image
streamed `IMAGE_OK`; `maxTokens: 8192` returned `LIMIT_OK`. Regional RPM/TPM
increases are deferred until real traffic demonstrates a need.

**All rows above describe the superseded direct-model/eu-west-2 deployment.** They are kept
as the historical record; see the 2026-08-27 entry below for what production now runs and
what evidence is owed against the new identity.

## Design Amendment — 2026-08-27 (user-approved): request-based quota, no CountTokens, profile in `us-east-1`

**Entitlement is a request count.** One `charged_count` unit per actual `ConverseStream`
invocation; a chat turn with a local tool round-trip consumes two. Input and output token
figures are read from the stream's own metadata and recorded as **observability counters
only** — they never gate a request, never bill, and are never estimated locally.

**No `CountTokens` anywhere.** Removed: `CountTokensCommand`, the `countInputTokens` port
method and its arg types, the handler's pre-reservation counting step, the per-operation
input-token ceilings and `checkInputTokenCeiling`, and the `bedrock:CountTokens` IAM grant.
Input bounding is now purely byte-based (per-operation serialized-JSON ceilings + the 4 MiB
decoded-media cap) and still happens **before** the reservation, so an oversized request
costs no unit. Request order: transport guard → schema/byte validation → config reads and
eligibility → reserve → `ConverseStream`.

**Model and region.** Back to `us.anthropic.claude-sonnet-4-6` in `us-east-1`. Inference
profiles do not support `CountTokens`, which is the only reason they were ever disqualified;
nothing calls it now. IAM grants `bedrock:InvokeModelWithResponseStream` on the profile ARN
plus its destination foundation-model ARN pattern. `BedrockRegion`, `BEDROCK_REGION`, and
`BedrockRegionEcho` are gone — everything is `us-east-1` and the runtime client inherits it.

**Unchanged, deliberately:** `charged_count` remains the sole quota authority at 1000 global
/ 200 per user; refund stays pre-`messageStart` only; finalize still never touches
`charged_count`; `GLOBAL` stays **enabled** for the beta account and the premium user record
was not touched; no reserved concurrency; stage throttle 10 RPS / burst 20; 4 MiB media cap;
serialized byte limits; output `maxTokens`; closed validation; AD-11 log limits; desktop
fallback behaviour; OIDC-only deployment.

**Disclosure.** EN and FR Terms **and** Privacy Policy now state US cross-region Bedrock
processing (qualified as possibly outside the reader's country of residence) and describe
the limit as a monthly request count. `README.md` matches.

**Evidence owed against the new identity.** Streaming, multimodal PDF+image, and the 8192
output ceiling were verified against `anthropic.claude-sonnet-4-6` — the model this profile
routes to — so the capability evidence concerns the same model, but the invocation identity
changed. Re-run all three through `us.anthropic.claude-sonnet-4-6`, and re-run the deploy
job's model assertion, before treating gates 1a/1c/1d/1e/1h as current (runbook §0.2). None
of those re-runs has been performed here. `GLOBAL` stays enabled meanwhile; if a
re-confirmation fails, the kill switch is the response, not a silent gate.

## Spec Change Log

### 2026-08-26 — code, docs, and disclosure landed; quota is the only blocker

Implemented: `BEDROCK_REGION` ownership in `src/lib/bedrock-client.ts` (explicit, required,
trimmed, region-shape checked, one client shared by both commands) plus runtime rejection of
a profile-shaped `BEDROCK_MODEL_ID` before any SDK call; template parameters
`BedrockModelId` and `BedrockRegion` pinned to single-entry `AllowedValues` and passed from
the same approved job-level constants used by post-deploy assertions (CloudFormation keeps
old parameter values on updates, so explicit migration is required); the Bedrock IAM grant narrowed to one derived
foundation-model ARN; the obsolete `BedrockInferenceProfileArn` /
`BedrockFoundationModelArnPattern` parameters and the `BEDROCK_INFERENCE_PROFILE_ARN` deploy
secret removed; the user-approved pre-revenue simplification removes function-level
reserved concurrency and its quota-increase path while preserving API throttling and
atomic user/global request caps; deployment asserts no reservation exists, together with
the deployed model/region on **both** the stack outputs and the Lambda
environment; EN+FR **Terms and** Privacy copy moved to direct London processing
(`privacyPage.limits.crossRegion` → `privacyPage.limits.processingRegion`) with the absolute
"outside your own country" claim replaced by "may be outside your country of residence";
runbook §0 rewritten around two passing probes, §0.3 added for the four capability checks a
text-only stream probe does not cover, model-invocation logging checked in both `eu-west-2`
and `us-east-1`, and §3.2 parameterised on `PREMIUM_EMAIL` with stack-derived pool/table and
an exactly-one-confirmed-match guard; both architecture documents carry a dated,
user-approved amendment.

Completed: the function uses unreserved capacity and the first premium beta account is enabled.

## Design Notes

Historical: the `us.anthropic.claude-sonnet-4-6` inference profile rejected Runtime `CountTokens`, which is why a bare foundation model in `eu-west-2` was briefly adopted (it returned an input-token count and streamed `OK.`).

Superseded 2026-08-27: quota counts requests, so no `CountTokens` call exists and the profile's lack of that capability no longer disqualifies it. The profile is the deployed model again, in `us-east-1`.

## Verification

**Commands:**
- `pnpm --filter @nixus/api-bedrock lint && pnpm --filter @nixus/api-bedrock typecheck && pnpm --filter @nixus/api-bedrock test && pnpm --filter @nixus/api-bedrock sam:validate && pnpm --filter @nixus/api-bedrock sam:build` -- expected: clean and warning-free.
- `pnpm --filter @nixus/web test && pnpm --filter @nixus/web build` -- expected: bilingual legal copy and prerender pass.
- GitHub `API Bedrock CI` -- expected: OIDC deploy succeeds and asserts no reserved concurrency.
- AWS SDK live driver -- expected: `us.anthropic.claude-sonnet-4-6` streams text in `us-east-1`. **Not run for this change.**

**Observed for this change (local gates only):** `@nixus/api-bedrock` lint, typecheck, 340
tests, `sam validate`, and `sam build` all clean; `@nixus/web` 195 tests and a successful
prerendering build. No deployment was performed and nothing was committed or pushed, so the
deploy job's post-change model assertion and the live profile probes remain owed.

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
