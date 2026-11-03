---
title: 'Switch Bedrock AI paths to Claude Sonnet 5.5'
type: 'chore'
created: '2026-10-28'
status: 'done'
review_loop_iteration: 2
baseline_commit: 'eeb43db0f67c1bf11d0d621d5de3c936dda24d0a'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture-cloud-bedrock.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nixus-hosted AI and the desktop bring-your-own Bedrock adapter remain pinned to Claude Sonnet 4.6, while AWS now offers Sonnet 5.5 through a US cross-region inference profile supported from `us-east-1`.

**Approach:** Move both paths to the official `us.anthropic.claude-sonnet-5-5` profile, keep the existing US routing and request-based quota architecture, and update every live configuration guard, test, operational instruction, and current architecture statement that enforces the model identity.

## Boundaries & Constraints

**Always:** Keep model choice server/application-owned; retain `us-east-1`, US geo routing, request-count quotas, current byte/output limits, streaming-only IAM action, BYO fallback behavior, and privacy-safe logging. Preserve unrelated untracked files.

**Ask First:** Any region or profile other than `us.anthropic.claude-sonnet-5-5`; any live AWS mutation, Marketplace activation, GitHub secret update, deployment, commit, or push.

**Never:** Reintroduce `CountTokens`; expose model selection to clients; use the unprefixed foundation-model ID for invocation; edit historical deployment evidence or old amendment text in place; change quotas, fallback semantics, credentials, or unrelated AI behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Hosted AI invocation | Premium request reaches Lambda in `us-east-1` | Runtime invokes `us.anthropic.claude-sonnet-5-5`; deploy assertions and IAM destination pattern match 5.5 | Existing pre/post-commit and fallback behavior remains unchanged |
| BYO Bedrock invocation | User configured valid AWS credentials | Desktop invokes the same Sonnet 5.5 US profile | Existing typed provider errors remain unchanged |
| Client supplies a model | Request includes `model_id` | Closed validation rejects the field | Existing validation error; no quota or provider call |
| Old model drifts back | Template, workflow, runbook, or tests reference 4.6 as current | Contract tests fail | Historical records are excluded from this guard |

</frozen-after-approval>

## Code Map

- `apps/api-bedrock/template.yaml` -- hosted model default/allowlist, destination foundation-model ARN pattern, and IAM resource authority.
- `.github/workflows/api-bedrock-ci.yml` -- approved model and destination-pattern constants; `infra/bootstrap/**` on the `pull_request` filter ONLY, deliberately absent from `push` so a bootstrap merge cannot trigger the application deploy ahead of the manual bootstrap re-deploy; lint the bootstrap template; explicitly pass all three model-bearing parameters on UPDATE; delegate both model guards to executable scripts; order the profile validation after OIDC credential configuration.
- `apps/api-bedrock/scripts/{validate-inference-profile,assert-deployed-model-grant}.sh` -- the two deploy guards as executable seams, so every refusal path is provable by a nonzero exit instead of by a substring in a YAML block. The first accepts only a system-defined `us-east-1` `inference-profile` ARN ending in the exact approved id, derives the approved destination from the IAM pattern, requires a non-empty `models[]` with every entry carrying a `modelArn`, and redacts account-bearing CLI stderr from a trap-cleaned temporary file.
- `apps/api-bedrock/samconfig.toml` -- current deployment-authority commentary must describe the profile-based, request-quota design rather than the withdrawn direct-model/CountTokens design, and must distinguish the invoked profile from the destination foundation model.
- `infra/bootstrap/github-oidc-deploy.yaml` and `apps/api-bedrock/src/oidc-bootstrap.test.ts` -- the deploy role needs read-only `bedrock:GetInferenceProfile`, scoped in `us-east-1` to the single approved profile ARN via a pinned `ApprovedBedrockModelId`; its contract tests must run whenever the bootstrap template changes; no Bedrock invoke, list, or write.
- `apps/api-bedrock/src/{template-scaffold,deploy-pipeline,rollout-runbook}.test.ts` -- infrastructure, pipeline, deployed-parameter, and runbook identity guards.
- `apps/api-bedrock/src/deploy-scripts.test.ts` -- executable behavior tests driving both guards against stubbed `aws` fixtures and a real `jq`; the stub's call log proves the pre-deploy guard makes exactly one read-only Bedrock call.
- `apps/api-bedrock/src/model-identity.test.ts` -- positive pins for all live authorities, including bootstrap and both architecture authorities, plus a `git ls-files` old-model scan over tracked files only (so an untracked working-tree file cannot change the result) whose exemptions are explicit and counted, and a syntactic guard forbidding the bare foundation id in any invocation binding.
- `apps/api-bedrock/src/lib/{bedrock-client,validation}.test.ts`, `apps/api-bedrock/src/functions/api.test.ts`, `apps/api-bedrock/src/lib/validation.ts` -- model fixtures and current-model explanatory text; behavior stays unchanged.
- `apps/desktop/src-tauri/src/ai/backend.rs` -- independent BYO Bedrock model constant and in-module positive identity guard selected explicitly for this product-wide upgrade.
- `docs/runbooks/hosted-ai-rollout.md` -- fail-fast commands to obtain/validate/create the profile secret at parity with the CI guard, hosted and BYO 5.5 capability/deployment evidence requirements, real per-model throughput-quota instructions for gate 1f, bootstrap-before-app ordering with gate 1j classified pre-deploy and the deploy role derived from its stack output, and retained 4.6 evidence.
- `docs/project-context.md` -- current model invariant for future agents.
- `_bmad-output/planning-artifacts/architecture-cloud-bedrock.md` and `architecture/architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md` -- append a dated Sonnet 5.5 amendment, update frontmatter/current-state summaries including External Integrations and Data Flow, enumerate all unpassed gates including bootstrap gate 1j, and keep the spine terse.
- Historical specs, review snapshots, memlogs, story agent metadata, and deferred-work evidence are read-only.

## Tasks & Acceptance

**Execution:**
- [x] Update hosted template and CI model authorities, constraining all three model-bearing parameters and explicitly migrating/asserting them so CloudFormation cannot preserve or widen a 4.6 IAM grant.
- [x] Validate the exact supplied `us-east-1` inference-profile ARN through Bedrock, compare its ARN/ID/status/type/destinations to the approved model and pattern, redact account-bearing output, and compare the deployed parameter back to the validated secret.
- [x] Update coupled API Bedrock contract tests, fixtures, `samconfig.toml`, and model-specific explanatory text without changing runtime behavior.
- [x] Update the desktop BYO Bedrock constant and add a positive Rust guard for the exact US Sonnet 5.5 profile.
- [x] Update the live rollout runbook with fail-fast commands, explicit hosted and BYO 5.5 capability gates, bootstrap-before-application ordering, and preserved dates/text for 4.6 evidence.
- [x] Add concise current architecture/project-context amendments; repair all stale current-state summaries, including the withdrawn `CountTokens` data flow; list gates 1i and 1j wherever outstanding evidence is summarized.
- [x] Grant the GitHub deploy role only `bedrock:GetInferenceProfile` on the one approved `us-east-1` profile ARN; add `infra/bootstrap/**` CI triggers and bootstrap `cfn-lint` so its contract tests and syntax checks run on every bootstrap change.
- [x] Apply the accepted review-loop-2 patch findings: keep `infra/bootstrap/**` off the `push` filter; extract both deploy guards to executable scripts and prove every refusal path by exit code; accept only a system-defined `us-east-1` profile ARN ending in the exact approved id; bring the runbook's manual validation to CI parity and derive the deploy role from its stack output; scan for the old model over tracked files only.

**Acceptance Criteria:**
- Given the hosted stack and BYO adapter, when model identities are inspected, then both resolve to `us.anthropic.claude-sonnet-5-5` and no live authority resolves to 4.6.
- Given an UPDATE of the existing stack, when CI constructs and verifies the deployment, then `BedrockModelId`, `BedrockInferenceProfileArn`, and `BedrockFoundationModelArnPattern` all identify 5.5; no preserved 4.6 parameter can survive a green deploy.
- Given the SAM IAM policy, when the template is validated, then streaming is allowed only for the supplied US 5.5 profile ARN and `anthropic.claude-sonnet-5-5*` destination models, with no `bedrock:CountTokens` grant.
- Given retained 4.6 rollout evidence, when the runbook is rendered and tested, then its original evidence dates remain present while every incomplete 5.5 gate is clearly unpassed.
- Given the bootstrap policy or template changes in a pull request, when CI evaluates path filters, then API Bedrock contract tests and `cfn-lint` run and reject widened Bedrock permissions or malformed infrastructure.
- Given a BYO Bedrock user, when release readiness is reviewed, then the runbook shows an unpassed 5.5 BYO invocation/model-access gate until dated evidence exists.
- Given no authorization for shared infrastructure changes, when implementation completes, then no AWS resource, GitHub secret, deployment, commit, or push has been changed.

## Spec Change Log

### 2026-10-28 — review loop 2, accepted patch findings (no new loop)

Patch review of the loop-2 implementation accepted eight findings and they are applied
here, within loop 2 rather than as a new iteration. The load-bearing ones: `infra/bootstrap/**`
triggered the default-branch `push` as well as `pull_request`, so merging the bootstrap
permission could deploy the application against a role that did not yet hold the grant;
and both new shell guards were asserted only by substring, which can never show the
nonzero exit that is the entire point of a guard. Both guards are now executable scripts
driven against stubbed `aws` fixtures, the profile ARN is accepted only as a
system-defined `us-east-1` profile ending in the exact approved id, the runbook's manual
validation reaches CI parity and derives the deploy role from its stack output, and the
old-model scan reads tracked files only. KEEP every loop-2 property plus the new
asymmetric trigger, the executable guard seams, the `set -f` glob discipline, the
trap-cleaned redaction, and the tracked-files-only scan; avoid re-symmetrising the path
filters, re-adding `application-inference-profile` acceptance, widening the Bedrock grant,
or logging the profile ARN through any echo, printf, or step-summary form.

### 2026-10-28 — review loop 2

The second review found that the new bootstrap IAM guards had no CI trigger when `infra/bootstrap/**` changed, and the architecture's live Data Flow still described the withdrawn `CountTokens` call despite the task to repair all stale current summaries. The spec now requires bootstrap path triggers and `cfn-lint`, complete current-summary cleanup, gate 1j visibility, exact `us-east-1` profile/deployed-secret checks, constrained destination-pattern overrides, fail-fast runbook commands, and an explicit unpassed BYO 5.5 capability gate. KEEP the first re-derivation's explicit CloudFormation parameter migration, exact-ARN Bedrock resolution, least-privilege read grant, positive hosted/BYO identity pins, historical evidence preservation, and fail-closed no-deploy behavior; avoid broad permissions, account-bearing logs, or treating unit identity checks as live model evidence.

### 2026-10-28 — pre-review implementation correction

Pre-review found the new pre-deploy `bedrock:GetInferenceProfile` call had no corresponding permission: `infra/bootstrap/github-oidc-deploy.yaml` granted `GitHubDeployRole` nothing in Bedrock, so the validation step would have failed closed on authorization rather than on a stale ARN. The Code Map and tasks now cover that bootstrap grant — read-only, one action, scoped to a single profile ARN through a pinned `ApprovedBedrockModelId` — and the validation now resolves the EXACT supplied secret ARN and compares it against the response, instead of looking up the public model ID (which would have passed for a secret naming another account, a deleted profile, or an unreadable one). The ARN is kept out of logs by explicit redaction of captured CLI stderr, not by GitHub's secret masking alone. KEEP the single-ARN scoping, the read-only grant, the documented bootstrap-before-application deploy ordering, and the falsifiability-by-revert evidence standard; avoid widening the grant to a profile wildcard or adding any invoke/list action to the deploy role.

### 2026-10-28 — review loop 1

The verification-gap review found that changing only `BedrockFoundationModelArnPattern`'s template default would not migrate an existing CloudFormation stack: the deploy omitted that parameter and did not assert its deployed value, allowing a green release whose IAM grant remained on 4.6. The Code Map, tasks, and acceptance criteria now require explicit migration and post-deploy verification of all model-specific parameters, exact profile-ARN validation, a positive BYO identity guard, preservation of historical gate dates, and repair of stale live `samconfig`/architecture summaries. KEEP the correctly selected 5.5 US profile, unchanged quota/fallback/privacy architecture, explicit hosted and BYO scope, historical evidence preservation, and model-identity regression tests; avoid unbounded exemption markers or duplicated architecture prose.

## Design Notes

AWS documents `us.anthropic.claude-sonnet-5-5` as the US geo inference profile supported from `us-east-1`; the unprefixed `anthropic.claude-sonnet-5-5` is the foundation model identity but has no direct in-region on-demand endpoint. The existing account-specific inference-profile ARN remains a deploy-time secret whose value must be updated separately before deployment.

## Verification

**Commands:**
- `pnpm --filter @nixus/api-bedrock lint && pnpm --filter @nixus/api-bedrock typecheck && pnpm --filter @nixus/api-bedrock test && pnpm --filter @nixus/api-bedrock sam:validate && pnpm --filter @nixus/api-bedrock sam:build` -- expected: all service, infrastructure, and model-identity guards pass warning-free.
- `pnpm --filter @nixus/desktop exec tsc --noEmit && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -- expected: desktop TypeScript and Rust suites pass with the BYO model update.
- Repository search for `us.anthropic.claude-sonnet-4-6` -- expected: occurrences remain only in explicitly historical records and prior evidence.
- `uvx cfn-lint infra/bootstrap/github-oidc-deploy.yaml` -- expected: clean, with the new single-ARN Bedrock read grant present.
- The deploy guards are covered by `src/deploy-scripts.test.ts` inside `pnpm --filter @nixus/api-bedrock test`; it requires a real `bash` and `jq` on PATH and stubs only `aws`.

**External verification:** official AWS model documentation confirms the `us.anthropic.claude-sonnet-5-5` US geo profile from `us-east-1`; the Bedrock API documents exact-ARN lookup plus `inferenceProfileArn`, `inferenceProfileId`, `models[].modelArn`, `ACTIVE`, and `SYSTEM_DEFINED`; the Service Authorization Reference lists `bedrock:GetInferenceProfile` as a read action on `inference-profile`, and AWS's inference-profile IAM guide uses account-scoped system-profile ARNs. No AWS or GitHub call is authorized by this spec.

**Observed (2026-10-28):** API Bedrock lint/typecheck, 430 tests, SAM validation, and SAM build passed warning-free; desktop TypeScript passed and Rust reported 2012 passed with no warnings; bootstrap `cfn-lint`, workflow YAML parsing, and shell syntax checks passed. Deliberate reversions proved the destination-pattern, bootstrap-grant/path-trigger, BYO identity, and unpassed-gate guards fail when their protected invariant regresses.

## Suggested Review Order

**Deployment authority**

- Start with the reviewed model constants, asymmetric triggers, and guarded deployment sequence.
  [`api-bedrock-ci.yml:148`](../../.github/workflows/api-bedrock-ci.yml#L148)

- Validate the exact secret ARN and every resolved Bedrock destination before deployment.
  [`validate-inference-profile.sh:23`](../../apps/api-bedrock/scripts/validate-inference-profile.sh#L23)

- Prove CloudFormation deployed the exact profile and destination pattern supplied by CI.
  [`assert-deployed-model-grant.sh:17`](../../apps/api-bedrock/scripts/assert-deployed-model-grant.sh#L17)

**Infrastructure boundaries**

- Pin all three hosted model-bearing parameters so stack updates cannot preserve 4.6.
  [`template.yaml:43`](../../apps/api-bedrock/template.yaml#L43)

- Grant only profile metadata read access, scoped to the approved US profile.
  [`github-oidc-deploy.yaml:303`](../../infra/bootstrap/github-oidc-deploy.yaml#L303)

- Keep the independent BYO adapter aligned with the hosted Sonnet profile.
  [`backend.rs:25`](../../apps/desktop/src-tauri/src/ai/backend.rs#L25)

**Operational readiness**

- Follow fail-closed secret rotation, bootstrap ordering, and unpassed 5.5 capability gates.
  [`hosted-ai-rollout.md:74`](../../docs/runbooks/hosted-ai-rollout.md#L74)

- Read the concise amendment preserving quota, fallback, privacy, and regional invariants.
  [`architecture-cloud-bedrock.md:25`](../planning-artifacts/architecture-cloud-bedrock.md#L25)

**Regression evidence**

- Execute real shell guards against success and every model-identity mismatch fixture.
  [`deploy-scripts.test.ts:8`](../../apps/api-bedrock/src/deploy-scripts.test.ts#L8)

- Enforce one model identity across hosted, bootstrap, BYO, runbook, and architecture authorities.
  [`model-identity.test.ts:60`](../../apps/api-bedrock/src/model-identity.test.ts#L60)
