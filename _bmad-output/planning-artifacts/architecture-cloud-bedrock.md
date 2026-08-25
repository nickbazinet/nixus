---
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-08-25'
inputDocuments:
  - architecture-entitlements-licensing.md
  - architecture-login.md
  - docs/project-context.md
  - .github/workflows/web-ci.yml
  - architecture/architecture-nixus-2026-08-25/.memlog.md
project_name: 'nixus'
user_name: 'Nbazinet'
date: '2026-08-25'
feature: 'cloud-bedrock'
parentArchitecture: 'architecture.md'
companionSpine: 'architecture/architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md'
---

# Architecture Decision Document — Nixus Cloud Bedrock

_Companion to [ARCHITECTURE-SPINE.md](architecture/architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md). The spine carries the terse, enforceable invariants; this document carries the reasoning, the full contract, and the implementation sequence._

**Related documents:**
- [Entitlements & Module Licensing](architecture-entitlements-licensing.md) — supplies the cloud-service conventions this feature reuses (AWS SAM, TypeScript, Node.js 22 ARM64, structured CloudWatch logs, pay-per-use). **Not shared:** premium hosted-AI access is a separate DynamoDB-managed capability, entirely independent of Keygen entitlements and LemonSqueezy billing. A user can be premium for hosted AI and unlicensed for every paid module, or vice versa.
- [Login / User Identity](architecture-login.md) — supplies the Cognito user pool, the PKCE/loopback auth flow, `credentials.rs` as sole keyring accessor, and `commands/auth.rs` as the token-refresh owner. This feature adds one OAuth scope to that existing system; it does not touch the auth flow itself.
- [Project Context](../../docs/project-context.md) — desktop conventions (`AppError`, Tauri IPC, TanStack Query, Rust structure) this feature must extend, never bypass.
- `architecture.md` (April 2026) is historical for its old Cognito/DynamoDB/Stripe/Lambda licensing design, already superseded by `architecture-entitlements-licensing.md` and `architecture-login.md` for their respective domains — it is not authoritative for identity, licensing, or API design. This feature inherits only the still-valid platform-level conventions `architecture.md` established (monorepo `apps/*` pay-per-use cloud services, each app releasing independently) and defers entirely to `architecture-login.md` for identity and `architecture-entitlements-licensing.md` for licensing on every point where they speak.

## Problem Statement

Nixus's desktop app has four AI surfaces — streaming chat, statement import, project advice, trends insight — each calling AWS Bedrock directly with credentials the user supplies and stores in the OS keyring (BYO). This works, but it's a ceiling: nixus can't offer a "just works" premium tier without asking every premium user to create their own AWS account and paste in credentials. This feature adds a Nixus-hosted path: premium, signed-in Cognito users get Bedrock access brokered entirely server-side, metered by a monthly request quota and a global hard cap, with automatic fallback to their existing BYO configuration when hosted access isn't available.

**Explicit non-goal:** this is not the entitlements/licensing system. Premium hosted-AI access is assigned by editing a DynamoDB record by hand; it has no relationship to Keygen or LemonSqueezy. See the Related Documents note above — this is stated once here and is binding for every section below.

**User decision on disclosure (adopted, binding):** no in-app consent gate or toggle is built for this feature. Terms of Service and Privacy Policy are the sole disclosure/authorization mechanism — see the Legal & Disclosure section below for exactly what they must state before production rollout, and AD-13 in the spine for the enforceable rule.

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
- FR1: A signed-in, premium Cognito user's AI calls (chat, statement import, project advice, trends insight) are served by Nixus-hosted Bedrock instead of their BYO credentials, with no user-facing toggle.
- FR2: Hosted access is metered by a configurable per-user monthly request quota and a global hard cap; exceeding either degrades per the closed fallback table below, never a silent failure.
- FR3: Premium status and quota are administered by hand in the AWS console (DynamoDB item edit) for v1 — no billing integration, no admin UI.
- FR4: Chat remains token-streamed end-to-end through the hosted path; the other three surfaces remain single-shot responses.
- FR5: Hosted infrastructure deploys via a dedicated GitHub Actions pipeline using OIDC (no long-lived AWS keys) — PR verification, then a gated deploy behind a protected environment on push to the default branch.
- FR6: Rollout is gated on Terms/Privacy Policy disclosure of hosted processing (AD-13) — not on any in-app consent UI.

**Non-Functional Requirements:**
- NFR1 — Local-first: hosted-service unavailability degrades per the closed fallback table, never blocks app launch or non-AI functionality.
- NFR2 — Zero-trust to the device: no AWS credential of any kind is ever vended to or cached on a device.
- NFR3 — Privacy (Nixus-controlled scope): no financial content, prompt, response, attachment, or file path is ever persisted in Nixus's own DynamoDB, CloudWatch, or app logs. This does not extend to AWS's own handling of the request under Bedrock's terms — see Legal & Disclosure.
- NFR4 — Cost at low scale: near-zero idle compute charge; the two unbounded cost drivers (Bedrock tokens, request volume) are capped by server-owned ceilings plus a per-user and global hard quota, not left to client discretion or a single control.
- NFR5 — Convention consistency: `AiBackend` does not exist in the live codebase today — this feature introduces it as the new port all four AI surfaces converge on, while extending existing `AppError`, Rust module, and command/db-layering conventions rather than inventing parallel ones. No new frontend/IPC surface is added for hosted-AI status.

**Scale & Complexity:**
- Primary domain: new cloud service (`apps/api-bedrock`) + a routing/adapter change inside the existing desktop AI layer, entirely Rust-side.
- Complexity level: Medium-High — one new AWS service with streaming, idempotent quota transactions (per-user and global), and four call sites to re-route on the desktop.
- Estimated architectural components: 6 — (1) API Gateway + Lambda + DynamoDB stack, (2) Cognito scope/app-client update, (3) shared TypeScript contract package, (4) desktop `AiBackend` port + hosted adapter + `HostedAiState`, (5) GitHub OIDC deploy pipeline, (6) Terms/Privacy disclosure copy.

### Technical Constraints & Dependencies

- Live desktop code has one streaming Bedrock surface (chat, via `ConverseStream`) and three non-streaming surfaces (project advice, trends insight, statement import), currently spread across separate concrete AWS client call sites rather than one abstraction. This feature is the forcing function that introduces the `AiBackend` port all four surfaces converge on.
- The existing Cognito user pool and its `sub` claim (`architecture-login.md`) are the only identity system this feature is allowed to depend on.
- `credentials.rs` is the sole keyring accessor (`architecture-credentials.md` precedent, reaffirmed in `architecture-login.md`); the hosted adapter must call through `commands/auth.rs`, never touch the keyring directly.
- API Gateway HTTP API cannot stream Lambda responses and caps integration timeout at 30s (non-raisable) — ruled out for chat. Regional REST API supports `ResponseTransferMode=STREAM` for `AWS_PROXY` integrations via `InvokeWithResponseStream`, at every REST endpoint type, confirmed against current AWS documentation.
- `web-ci.yml` establishes the GitHub Actions verify→deploy job shape this feature's pipeline follows structurally, but not its credential mechanism: `web-ci.yml` uses a static `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` pair; this pipeline instead uses GitHub OIDC (`aws-actions/configure-aws-credentials@v6`, `role-to-assume`) so no long-lived AWS key exists for this service at all.
- Live `cc_parser.rs` logging must be audited and cleaned before hosted rollout: it must never log the statement file path, and no `AppError`/log call anywhere in the hosted-AI chain may include raw model output or transaction content.

### Cross-Cutting Concerns Identified

- Denial-of-wallet risk: Bedrock token cost and request volume are the two truly unbounded cost drivers. Addressed via server-owned model/operation/input-and-output-token ceilings (`CountTokens`-checked, never client-supplied), a per-user quota, and an independent global hard cap plus budget alert — layered controls, not one.
- Streaming commit semantics: once `ConverseStream` emits `messageStart`, silent fallback would risk duplicate AI output or duplicate downstream actions (e.g., a tool call already fired). `messageStart` is therefore the one, exact commit event (AD-7), not "the first byte" loosely defined.
- Credential lifecycle collision risk: Cognito session tokens (machine-level) and BYO AI credentials (per-dataset) must not merge into one lifecycle just because both now feed AI calls; credential *testing* (`test_ai_connection`) must stay scoped to BYO only.
- Multi-user desktop process risk: a `HostedAiState` cache that outlives a sign-out/sign-in-as-different-user cycle would leak one Cognito user's quota status into another's session — closed by binding the cache to `subject_sub` and invalidating on mismatch.
- CI divergence from `architecture-entitlements-licensing.md`'s deliberately manual, low-ceremony deploy: this service's owner explicitly required automated GitHub Actions deploy, so the two `apps/*` cloud services intentionally differ in delivery maturity. This is a stated choice, not an oversight.
- Legal/disclosure risk: the root `README.md` currently claims "data never leaves your machine" — shipping hosted AI without correcting it would make that claim false. The user's adopted choice is Terms/Privacy-only disclosure (no in-app gate) — but that choice is only safe if the legal copy and this known README claim are actually corrected first, which this document gates rollout on (AD-13) without prescribing the in-app UI the user explicitly declined.

## Starter Template Evaluation

### Primary Technology Domain

Brownfield addition — a new `apps/*` AWS cloud service. `architecture-entitlements-licensing.md` designed (but has not yet implemented) `apps/api-licensing` as a sibling cloud service on the same stack; this feature follows that same planned convention: TypeScript + AWS SAM, Node.js 22, ARM64.

### Selected Starter: AWS SAM (TypeScript, Node.js 22, ARM64) — same as the entitlements precedent

**Rationale:** this service reuses the entitlements document's cloud-service conventions verbatim for language, runtime, and IaC tooling — there is no reason to introduce a second toolchain if/when a second AWS Lambda service exists in this monorepo. Node.js 22 is deliberately retained here (rather than adopting Node 24, which is available) specifically for that alignment; it remains supported through April 2027, so retaining it costs nothing in currency. What differs from the licensing precedent is the **API type** (Regional REST, not HTTP API — streaming requires it) and the **deploy automation** (this service auto-deploys via GitHub OIDC; the licensing bridge's design deploys manually). Both divergences are load-bearing technical requirements, not inconsistency.

**Initialization command:**
```bash
sam init --runtime nodejs22.x --architecture arm64 --name nixus-bedrock-api --app-template hello-world --package-type Zip
```

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Transport: Regional API Gateway REST API + Cognito user-pool authorizer + streaming Lambda (spine AD-2, AD-3).
- Compute topology: one Lambda, one entry point, operation-discriminated dispatch (AD-4).
- Quota model: exact-field reserve/refund with per-user and global hard caps, idempotent via `ClientRequestToken` (AD-5, AD-6, AD-14).
- Stream commit semantics: `messageStart` as the sole commit event, with a 10-second soft-deadline abort (AD-7).
- Provider precedence and the closed fallback table (AD-9).
- CI/CD: GitHub OIDC, no long-lived keys, protected `environment: production` (AD-12).
- Disclosure posture: Terms/Privacy only, rollout gated on their correctness (AD-13).

**Important Decisions (Shape Architecture):**
- `HostedAiState` cache cadence and `subject_sub` scoping.
- Deployment topology: stable custom domain, one production stack, `Retain`-protected table (AD-15).
- AWS Budget alerting as a soft, secondary control (AD-14).

**Deferred Decisions (Post-v1, explicitly out of scope):**
- S3-backed statement upload beyond the 4 MiB raw ceiling.
- A reconciler for the accepted soft-deadline/crash leak risk.
- A staging environment/second SAM stack.
- Any admin UI or billing automation for premium/quota management.
- A WAF in front of the API.
- Any in-app status/quota UI.

### Data Architecture

**Single DynamoDB on-demand table**, holding both per-user and global items:

| pk | sk | Attributes |
|---|---|---|
| `USER#<sub>` | `CONFIG` | `premium: bool`, `monthly_request_limit: number`, `updated_at` |
| `USER#<sub>` | `USAGE#<YYYY-MM>` | `charged_count`, `reservation_count`, `refund_count`, `completed_count`, `failed_after_commit_count`, per-operation settled counters, aggregate `input_tokens`/`output_tokens`, `updated_at` |
| `GLOBAL` | `CONFIG` | `enabled: bool`, `monthly_request_limit: number` (default 1000), `updated_at` |
| `GLOBAL` | `USAGE#<YYYY-MM>` | same field set as the user `USAGE#` item |

**Exact field semantics (binding — both `handlers/invoke.ts` and `lib/quota.ts` must agree on these names):**
- `charged_count` is the **sole net quota authority**. Remaining quota = `max(0, monthly_request_limit - charged_count)`.
- `reservation_count`, `refund_count`, `completed_count`, `failed_after_commit_count`, and every per-operation/token field are **monotonic observability counters** — they only ever increase and never gate a decision by themselves.
- Reserve increments both `charged_count` and `reservation_count` in the same transaction. The condition for a first-time-this-month reservation is `attribute_not_exists(charged_count) OR charged_count < :limit` (evaluated against the exact `monthly_request_limit` value from the just-performed strongly consistent config read — there is no separate `version` field for an admin to remember to bump).
- Refund requires `charged_count > 0`, decrements `charged_count`, and increments `refund_count` — on both the user and `GLOBAL` items. Finalize (completion or post-commit failure) never touches `charged_count` — it only increments `completed_count` or `failed_after_commit_count`, the matching per-operation settled counter, and the token aggregates, on both items.

**Idempotency and timing:**
- `period_key` (UTC `YYYY-MM`), a `reservation_id`, and three server-generated idempotency tokens — one each for reserve, refund, and finalize — are computed exactly once at the start of request handling and threaded through every subsequent call. `client_request_id` from the request body remains tracing-only and is never used as an idempotency token.
- Reserve, refund, and finalize are each their own `TransactWriteItems` call, each passed the matching `ClientRequestToken`, so a retried SDK call cannot double-reserve, double-refund, or double-finalize. **All three atomically update both the user's `USAGE#` item and the `GLOBAL` `USAGE#` item in the same transaction** — none of the three is ever applied to only one of the two. The IAM action backing all three is `dynamodb:TransactWriteItems` — there is no separate `dynamodb:ConditionCheckItem` IAM action to grant.
- Finalize is the transaction that records the outcome of a committed (post-`messageStart`) invocation: it increments the applicable `completed_count` or `failed_after_commit_count` on both the user and `GLOBAL` items, the matching per-operation settled counter, and the aggregate `input_tokens`/`output_tokens` — on both items. Finalize never changes `charged_count`; only reserve and refund do.
- The period is computed once at request start and reused verbatim during refund/finalize — it is never re-derived from "the current month" later in the request, which would risk operating on the wrong period near a month boundary.

**Global hard cap:**
- Every reserve/refund `TransactWriteItems` call atomically includes both the user's `USAGE#` item and the `GLOBAL` `USAGE#` item — one user's request also gates and updates the global counter in the same all-or-nothing transaction.
- A missing, `enabled=false`, or exhausted `GLOBAL` config returns `503 hosted_unavailable`. Flipping `enabled` to `false` is the manual emergency kill switch, independent of and faster than deploying a code change.

**Fail-closed vs. status-read (per-user config):** on `POST /v1/ai/invoke`, a missing/malformed `CONFIG`, `premium=false`, or `monthly_request_limit<=0` all resolve to "not entitled" (`403 premium_required` or `429 quota_exhausted`). `GET /v1/ai/status` treats the same condition as a normal `200` non-premium read with zeroed fields — a status read is not an enforcement gate, and the two routes intentionally disagree on status code for that reason. There is no bootstrap/PostConfirmation Lambda — a user who has never been made premium costs Nixus nothing.

**One-time operational seed (manual, not a Lambda/bootstrap custom resource):** after the first successful stack deployment and before any traffic is enabled, an admin manually creates `pk=GLOBAL, sk=CONFIG` — `enabled=false`, `monthly_request_limit=1000`, `updated_at` — via the AWS console or a runbook. `enabled` is flipped to `true` only once CloudWatch alarms, the AWS Budget, the Legal & Disclosure gate (AD-13), and the Cognito scope update have all been verified. Per-user `CONFIG` items are created the same manual way, one per premium user, matching the existing "manual DynamoDB item edit" administration model (FR3) — no code path creates either.

**Config correctness under concurrency:** the enforcement sequence is (1) strongly consistent `GetItem` on `USER#CONFIG` and `GLOBAL#CONFIG`; (2) one `TransactWriteItems` call that condition-checks the exact `premium`/`monthly_request_limit` values just read (both user and global) and conditionally reserves both usage items. If the condition check fails because config changed between the read and the transaction, the Lambda rereads once, reclassifies the request against the fresh config, and retries the reserve once if still eligible — it does not loop indefinitely.

**Quota unit definition:** one unit per actual `ConverseStream` call that reaches `messageStart`-eligible reservation. A chat turn that triggers a local tool and a second model call to interpret the tool result consumes two units — quota tracks Bedrock invocations, not UI-visible messages.

### Authentication & Security

- **Identity:** unchanged Cognito user pool from `architecture-login.md`. This feature adds resource-server scope `nixus-api/ai.invoke` to the existing app client. The desktop detects the scope from the access token's `scope` claim locally — a token that lacks the scope is classified as `reauthentication_required` client-side, without needing to make a call and inspect a failure.
- **API Gateway `GatewayResponses`:** the authorizer's own `UNAUTHORIZED` and `ACCESS_DENIED` responses (an expired, invalid, or otherwise rejected token — detected by API Gateway itself before the Lambda ever runs) are configured via `GatewayResponses` to emit the canonical pre-output error envelope (`{ "error": { "code": "unauthorized", "message", "request_id" } }`) rather than API Gateway's generic default body. Missing-scope detection stays entirely client-side (previous bullet) — API Gateway's authorizer only ever sees whether the token is valid, not whether it carries the specific scope beyond what Cognito's own scope-based method authorization already enforces.
- **Authorization:** the API Gateway Cognito authorizer validates the access token and injects the verified `sub` into the Lambda's request context. The Lambda derives the acting user exclusively from that context — a `user_id` field in the request body, if ever present, is never trusted.
- **Transport security:** TLS 1.2 minimum policy on the custom domain; no additional application-layer encryption is needed for a Bearer-token-authenticated internal API.
- **No static credentials at runtime:** the Lambda's execution role is the only AWS identity involved in calling Bedrock or DynamoDB. No SSM Parameter Store, no Secrets Manager.
- **IAM scoping (exact actions):** the execution role grants `logs:CreateLogStream` + `logs:PutLogEvents` scoped to the one explicit, CloudFormation-created log group (never `logs:*`); `dynamodb:GetItem` + `dynamodb:TransactWriteItems` scoped to the one table; `bedrock:CountTokens` + `bedrock:InvokeModelWithResponseStream` scoped to the approved inference profile ARN and its destination foundation-model ARNs as far as AWS IAM condition/resource support allows. DynamoDB IAM policy cannot isolate access by sort key, so the code boundary — and its tests — enforce that the Lambda only ever mutates `CONFIG` items through a transaction condition check, never a direct write; only the separate deploy/admin role edits `CONFIG` directly.
- **Non-premium abuse controls:** layered, not single — the Cognito authorizer at the edge, stage throttle (10 RPS / burst 20), reserved concurrency (10), the `GLOBAL` hard cap (AD-14), and the AWS Budget alert. A WAF is deferred unless observed abuse justifies its cost.

### API & Communication Patterns

**Routes** (both behind the Cognito authorizer, scope `nixus-api/ai.invoke`):

- `GET /v1/ai/status` — returns `{ premium: bool, monthly_request_limit: number, charged_count: number, period: "YYYY-MM" }`. Read-only, no quota consumption, no Bedrock call, no `CountTokens` call. Missing/malformed config → `200` with `premium: false`, `monthly_request_limit: 0`, `charged_count: 0`.
- `POST /v1/ai/invoke` — the sole hosted-AI entry point for all four surfaces, fronted by `functions/api.ts` and implemented in `handlers/invoke.ts`.

**Invoke request contract** — public wire shape, snake_case, closed (unknown fields rejected). Attachments are represented as message content, not a separate field:

```
CloudAiContent =
  | { "type": "text", "text": string }
  | { "type": "image", "format": "png" | "jpeg", "data_base64": string }
  | { "type": "document", "format": "pdf", "data_base64": string }

CloudAiMessage = {
  "role": "user" | "assistant",
  "content": CloudAiContent[]
}

CloudAiInvokeRequest = {
  "operation": "chat" | "statement_import" | "project_advice" | "trends_insight",
  "system": string,                    // finalized system prompt, desktop-owned
  "messages": CloudAiMessage[],         // finalized, desktop-owned conversation turns
  "client_request_id": string          // UUIDv4, tracing only — never an auth or idempotency token
}
```

**Operation constraints on content:** `chat`, `project_advice`, and `trends_insight` accept `text` content blocks only — an `image`/`document` block on those operations is `400 validation`. `statement_import` accepts exactly one `user` message containing exactly one `text` block and exactly one `image`-or-`document` block — zero, two, or more of either is `400 validation`. The public `document` block carries no `name` field — the Lambda always supplies a fixed, neutral Bedrock document name (`statement`) when constructing the Converse call, and never trusts or forwards a client-supplied file name. There is no separate `media` field anywhere in the contract; the Lambda validates and translates this snake_case public union into the AWS SDK's own Converse-shaped content blocks internally — the SDK's field naming is never part of the public contract. It rejects: an operation outside the closed enum, unknown top-level or content fields, any client-supplied model ID or token-limit override (neither exists in this contract; presence is a validation error), and any payload exceeding the ceilings below.

**Canonical protocol schema:**

| Surface | Shape |
|---|---|
| `GET /v1/ai/status` response | `{ premium, monthly_request_limit, charged_count, period }` |
| `POST /v1/ai/invoke` request | `CloudAiInvokeRequest` — `{ operation, system, messages, client_request_id }` (see `CloudAiMessage`/`CloudAiContent` above) |
| Pre-output error body | `{ "error": { "code": string, "message": string, "request_id": string } }` |
| `meta` frame | `{ "type": "meta", "operation": string, "request_id": string }` |
| `delta` frame | `{ "type": "delta", "text": string }` |
| `end` frame | `{ "type": "end", "stop_reason": CloudAiStopReason, "input_tokens": number, "output_tokens": number }` |
| `error` frame (mid-stream) | `{ "type": "error", "code": string, "message": string }` |

**Normalized `stop_reason` union** (`CloudAiStopReason`): `end_turn | max_tokens | stop_sequence | content_filtered | guardrail_intervened | model_context_window_exceeded | other`. The Lambda maps every Converse `stopReason` value AWS returns into this closed set; any AWS reason not explicitly named above maps to `other` rather than passing an unrecognized string through — the desktop never has to handle an open-ended string here.

**Error code union** (`CloudAiErrorCode`, the same set the Closed Fallback Table below is keyed on): `validation | unauthorized | reauthentication_required | premium_required | payload_too_large | quota_exhausted | hosted_unavailable | unsupported_encoding`.

The Rust desktop maps the pre-output error body to `AppError::HostedAi { code, message, recoverable }`, which serializes as `{ "type": "hosted_ai", "code": "...", "message": "...", "recoverable": true|false }` — the same discriminated-union JSON convention every other `AppError` variant already uses. `packages/shared/src/types/cloud-ai.ts` owns the TypeScript side of every shape in this table (`CloudAiMessage`, `CloudAiContent`, `CloudAiInvokeRequest`, `CloudAiFrame`, `CloudAiStopReason`, `CloudAiErrorCode`, `CloudAiStatusResponse`) unambiguously; the Rust wire models mirror it deliberately, field for field, type for type.

**Response framing** — `application/x-ndjson`. The Node handler must emit API Gateway's required streaming-metadata JSON followed by exactly eight NUL bytes before the first NDJSON line; a missing or malformed prelude is a `500`, not a silently broken stream.
- `{"type":"meta", ...}` — emitted only once `ConverseStream` has actually reached its `messageStart` event. Not emitted immediately after quota reservation, and not emitted on "the first byte" loosely defined — `messageStart` is the exact, named commit point.
- `{"type":"delta", ...}` — zero or more; chat streams many, the other three surfaces typically emit one accumulated delta before `end`.
- `{"type":"end", ...}` — terminal success frame, always carrying `stop_reason` (from the normalized `CloudAiStopReason` union above), `input_tokens`, `output_tokens`. A `max_tokens` `stop_reason` is an explicit, typed, recoverable condition on the desktop — never treated as a parse failure.
- `{"type":"error", ...}` — terminal in-band failure, only possible after `meta` has been sent.

**Request handling order (binding — matches spine AD-8):** (0) transport guard — `Content-Encoding` must be absent or `identity`; any other value is rejected pre-output with `415 unsupported_encoding`, no fallback. (1) Schema/byte validation against the closed `CloudAiInvokeRequest`/`CloudAiMessage`/`CloudAiContent` union — an unknown field, wrong content type for the operation, or a malformed statement_import shape is `400 validation` here, before any AWS call. Base64 content is decoded only after this schema validation passes, and the decoded media size is checked against the 4 MiB raw ceiling immediately, before `CountTokens` is ever called — API Gateway's and Lambda's own request-size ceilings remain outer limits on top of this. (2) Strongly consistent `USER#CONFIG`/`GLOBAL#CONFIG` reads and eligibility classification — a non-premium, disabled, missing-config, or globally-exhausted caller is rejected here (`403`/`429`/`503`) and **never reaches `CountTokens`**, so no Bedrock cost is spent classifying an ineligible caller. (3) `bedrock:CountTokens` on the final Converse-shaped input, only for an eligible caller whose decoded media already passed the size check; a `CountTokens` failure is pre-reservation `503 hosted_unavailable`, and an input-ceiling overage is pre-reservation `400 validation`. (4) The reserve transaction (user + global, `TransactWriteItems`), which rechecks the same config read in step 2. (5) `ConverseStream`.

**Pre-output vs. post-commit errors:** any failure in steps (1)–(4) above is pre-output: refund the reservation if one was taken and return a real HTTP status (`400`, `401`, `403`, `413`, `429`, `503`) with no NDJSON body — this is exactly when desktop fallback is legal. `messageStart` (step 5) is the commit event; from that point the Lambda has already written the API Gateway streaming prelude and the `meta` frame, `failed_after_commit_count` is the only counter any later failure touches, and the frame stream carries the failure in-band with no refund and no fallback.

**Soft deadline:** when the Lambda's remaining execution time reaches 10 seconds, an `AbortController` stops any outstanding upstream Bedrock/DynamoDB call, and idempotent finalize/failure accounting runs inside a `finally` block using the request's precomputed idempotency tokens. A hard Lambda crash or timeout that occurs before that accounting completes may still leak one `charged_count`/settled-metric increment — this is the same accepted, bounded v1 risk the spine names, not newly introduced here, and it is not covered by a reconciler.

**Server-owned ceilings (v1, concrete):**

| Operation | Serialized JSON | Input tokens (CountTokens-checked) | Output tokens |
|---|---|---|---|
| chat | 1 MiB | 32,768 | 4096 |
| project_advice | 256 KiB | 8,192 | 1024 |
| trends_insight | 256 KiB | 8,192 | 1024 |
| statement_import | 256 KiB (excl. media) | 64,000 | 8192 |

Raw statement media (pre-base64, on the desktop side) is capped at 4 MiB before the desktop even base64-encodes and sends it — encoding a 4 MiB file would otherwise silently balloon the JSON payload by ~33%. The Lambda independently re-checks this same 4 MiB ceiling against the decoded media size immediately after schema validation (step 1 of the Request handling order above) and rejects with `413 payload_too_large` if exceeded — it never trusts the desktop's own pre-encoding check. S3-backed upload is explicitly deferred until real statements are observed exceeding this cap.

**Closed Fallback Table** — every desktop-side fallback decision is one lookup in this table, never ad hoc code per surface:

| Pre-output condition | Desktop behavior |
|---|---|
| `400 validation` | No fallback. Surface a typed, non-recoverable error. |
| `415 unsupported_encoding` | No fallback — a clear, typed transport error; the request itself is malformed at the transport layer, so retrying against another provider would not help. |
| `401`, token expired | Refresh once via `commands/auth.rs` before any reservation is attempted; if still unauthorized, mark the session expired and notify the user to re-sign-in. A configured BYO provider may still run for this call. |
| `401`, `nixus-api/ai.invoke` scope missing (`reauthentication_required`) | A refresh cannot add a missing scope. Require a full sign-in. A configured BYO provider may run meanwhile. |
| `403 premium_required` | Fall back to the surface's configured provider (BYO Bedrock, or OpenAI where supported). |
| `413 payload_too_large` | No fallback — a clear, typed size error; retrying against another provider would not fix an oversized payload. |
| `429 quota_exhausted` | Fall back to the configured provider. |
| `503 hosted_unavailable` (Bedrock/`CountTokens` failure or `GLOBAL` kill switch/exhaustion) | Fall back to the configured provider. |
| Anything after `messageStart` (in-band `error` frame) | No fallback, no retry — surfaces as the desktop's standard AI error state. |

Bedrock-only surfaces (statement_import's multimodal path) require BYO Bedrock specifically wherever this table says "fall back to the configured provider" — OpenAI is not a valid fallback there; absent a configured BYO Bedrock credential, the surface returns a typed error instead.

**Typed error codes** (map 1:1 to the table above): `validation` (400), `unsupported_encoding` (415), `unauthorized` (401), `reauthentication_required` (401), `premium_required` (403), `payload_too_large` (413), `quota_exhausted` (429), `hosted_unavailable` (503). The desktop maps every one into `AppError::HostedAi` per the canonical schema above — it never surfaces the raw code or an upstream Bedrock error string to the user.

### Desktop Architecture (Rust-owned; no new frontend/IPC surface)

**Ports-and-adapters `AiBackend`:** all four AI surfaces (chat, statement import, project advice, trends insight) call through one Rust trait/module boundary. `HostedBedrockAdapter` and the existing BYO Bedrock/OpenAI clients are adapters behind it — none of the four call sites talks to a concrete AWS or OpenAI client directly anymore. This is the structural fix for the fragmentation noted in Cross-Cutting Concerns.

**Precedence rule:** whenever a signed-in premium user has remaining quota (per-user and global) and the hosted gateway is reachable, `HostedBedrockAdapter` is selected — even if the user has explicitly configured OpenAI for that surface. This is a deliberate override of user provider choice for premium users, chosen because "premium" is meant to mean "it just works."

**Fallback rule:** governed entirely by the Closed Fallback Table above — no separate prose rule exists outside it. Tool-loop calls within one visible chat turn are evaluated independently: it is accepted v1 behavior for the first Bedrock invocation in a turn to be hosted and a second (post-tool-call) invocation in the same turn to fall back to BYO if quota state changed in between; each invocation obeys the table on its own.

**Credential call path:** `HostedBedrockAdapter` obtains a call-time access token from `commands/auth.rs`, which refreshes proactively at a 120-second skew before expiry — a deliberate change from the live zero-skew `is_session_expired` check, whose comment and tests must be updated to describe the new skew rather than silently diverging from it — and performs exactly one refresh+retry on a `401` before falling back per the table. It never reads the keyring directly — `credentials.rs` remains the sole accessor, unchanged from `architecture-login.md`. `commands/settings.rs::test_ai_connection` is explicitly untouched by this feature: it continues to test whatever BYO credential the user entered, never the hosted path.

**Status cache — entirely Rust-side, no frontend/IPC surface:** `ai/hosted_state.rs` owns a process-wide `HostedAiState` (cached `/v1/ai/status` response, its fetch time, and the `subject_sub` it was fetched for), read and refreshed only by `AiBackend`/`HostedBedrockAdapter`, never exposed as a Tauri command or a TanStack Query hook. Rules:
- No call to `/v1/ai/status` is made while there is no auth session (logged out).
- The cache is refreshed once after login and once after app launch when a session is available.
- Before any AI call, if the cache is absent, older than 5 minutes, or its `subject_sub` doesn't match the current session's `sub`, `HostedBedrockAdapter` lazily refreshes it first.
- The cache is cleared on sign-out, on `SessionExpired`, on sign-in as a different `sub`, and on an auth-callback subject change — no cross-user process cache is possible.
- A `403`, `429`, or `503` from `/v1/ai/invoke` invalidates the cache immediately, so a manual console premium/limit change or a global kill-switch flip is reflected within 5 minutes without any polling loop. On a `503`/`hosted_unavailable` specifically, the adapter may additionally cache "hosted unavailable" for up to 60 seconds to avoid hammering a disabled or globally exhausted gateway with repeated calls in quick succession — this is a client-side rate-limiting courtesy only; the server's per-user and `GLOBAL` state remains authoritative, and the 60-second window never substitutes for a real status check once it elapses.
- No status UI exists in v1 — nothing is rendered from `HostedAiState`. A future quota/premium badge is explicitly Deferred.

### Legal & Disclosure (binds rollout, not code)

The adopted decision is Terms/Privacy-only disclosure — **no in-app consent gate, toggle, or modal is built.** This section states what must be true in those legal documents before hosted AI can ship to production; it does not add any new UI.

- Terms of Service and/or Privacy Policy must clearly state: (1) financial prompts and statement content are transmitted through Nixus's own infrastructure to AWS Bedrock for processing; (2) Bedrock's cross-region (`us.` inference profile) processing and AWS's own abuse-detection policies may apply to that content, and Nixus's non-retention guarantee (AD-11) covers only Nixus-controlled systems, not AWS's; (3) hosted use is subject to a request quota with BYO fallback behavior as described above.
- The root `README.md` currently states that data never leaves the user's machine — this is a known, identified rollout-copy target that must be corrected as part of AD-13, not merely a generic "locate at implementation time" item. Any marketing-site copy making the same claim remains a locate-and-audit requirement, since its exact file(s) are not independently confirmed here.
- This is a legal/product capability, not an architectural one — no file in `apps/api-bedrock` or the desktop `ai/` module depends on it, but production deployment (AD-13, AD-15) is explicitly gated on it.

### Decision Impact Analysis

**Implementation sequence:**
1. AWS console: add scope `nixus-api/ai.invoke` to the existing Cognito resource server/app client (one-time, out-of-band — do not attempt to import the existing user pool into this stack). Separately, one-time and out-of-band: provision the GitHub OIDC identity provider and the least-privilege deploy role via a reviewed bootstrap stack or manual step — `nixus-bedrock-api` must never create the role that deploys it. The role's IAM trust policy restricts the `sub` claim to this repository and the `production` GitHub environment; the default-branch-only restriction comes separately from the workflow's own trigger condition and the `production` environment's GitHub branch-protection policy, not from the trust policy's `sub` claim.
2. `packages/shared/src/types/cloud-ai.ts` — the invoke request/response/frame/error contract from the canonical schema table. This must exist before any handler or adapter implementation is written, though the SAM scaffold itself (`sam init`, empty `template.yaml`) may be created in parallel.
3. `apps/api-bedrock` — SAM template (API Gateway REST + Cognito authorizer + one Lambda + DynamoDB, with the `GLOBAL` items, PITR, and `Retain` policies from AD-6/AD-15), `src/functions/api.ts` (sole `streamifyResponse` router), `src/handlers/status.ts`, `src/handlers/invoke.ts`, `src/lib/quota.ts` (exact-field reserve/refund/finalize with `ClientRequestToken`), `src/lib/bedrock-client.ts` (`CountTokens` + `ConverseStream`), Vitest specs.
4. Desktop: introduce the `AiBackend` port, retrofit the four existing surfaces onto it, add `HostedBedrockAdapter` and `ai/hosted_state.rs` (`subject_sub`-scoped `HostedAiState`), extend `commands/auth.rs` for call-time tokens (120s skew — update `is_session_expired`'s comment/tests), extend `AppError` with `HostedAi`.
5. Desktop: `cc_parser.rs` logging cleanup (no file path) and an audit of every `AppError`/log call in the hosted-AI chain for raw content, before rollout.
6. `.github/workflows/api-bedrock-ci.yml` — paths-filtered PR verify (install/lint/typecheck/test/`sam validate`/`sam build`) + default-branch deploy via GitHub OIDC into a protected `production` environment.
7. Legal/docs: update Terms/Privacy Policy per the Legal & Disclosure section, and correct the root `README.md`'s "data never leaves your machine"-equivalent claim plus any matching marketing-site copy — both block production rollout (AD-13), independent of code readiness.
8. AWS: `api.nixusapp.com` custom domain wiring against the existing Route53 hosted zone/ACM certificate (SAM parameters, not an optional execute-api fallback), plus the AWS Budget ($50/mo, 80%/100% alerts).
9. Manual operational seed: after the first deployment and before enabling traffic, create `GLOBAL#CONFIG` (`enabled=false`, `monthly_request_limit=1000`) via console/runbook; flip `enabled=true` only once alarms, budget, Legal & Disclosure, and the Cognito scope update are all verified.

**Cross-component dependency:** the shared `cloud-ai.ts` contract (step 2) blocks both the Lambda handlers (step 3) and the `AiBackend` retrofit (step 4) — define it once before either side hardens its own shape. Rollout (step 7/8) is independent of and does not block earlier implementation steps, but blocks going to production.

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Cloud (`apps/api-bedrock`, new domain):**
- Files: `src/functions/api.ts` (sole Lambda entry point, `streamifyResponse`-wrapped router), `src/handlers/status.ts`, `src/handlers/invoke.ts`, `src/lib/quota.ts`, `src/lib/bedrock-client.ts`, `src/lib/table.ts`.
- Functions: camelCase (`reserveQuotaUnit`, `refundQuotaUnit`, `finalizeQuotaUnit`, `getUserConfig`, `getGlobalConfig`) — both `invoke.ts` and `quota.ts` reference the exact field names `charged_count`, `reservation_count`, `refund_count`, `completed_count`, `failed_after_commit_count`; no ad hoc synonyms.
- Logs: structured `console.log`/`console.error` JSON (`{ event, request_id, sub, operation, status }`) — same non-unification-with-`tracing` rationale as `architecture-entitlements-licensing.md`: different runtime, no cross-boundary logging library requirement. Fields are `snake_case` to match the desktop's IPC convention.

**Shared:**
- `packages/shared/src/types/cloud-ai.ts` exports `CloudAiOperation`, `CloudAiContent`, `CloudAiMessage`, `CloudAiInvokeRequest`, `CloudAiFrame` (discriminated union `meta|delta|end|error`), `CloudAiStopReason`, `CloudAiErrorCode`, `CloudAiStatusResponse` — the full canonical protocol schema table, typed once and unambiguously.

**Desktop (Rust):**
- New trait/module: `ai/backend.rs` defines `AiBackend` (or the existing `ai/` module gains this boundary if a suitable seam already exists at implementation time — verify against live code before creating a parallel one).
- New: `ai/hosted_bedrock.rs` (adapter), extends `commands/auth.rs` with a `get_hosted_ai_token()`-shaped internal helper (not a new Tauri command — adapter-internal, not IPC-exposed).
- New: `ai/hosted_state.rs` defines `HostedAiState { premium, monthly_request_limit, charged_count, period, subject_sub, fetched_at }` and the refresh/invalidate functions consumed only by `ai/hosted_bedrock.rs` — no Tauri command, no frontend hook.
- `AppError` gains `HostedAi { code, message, recoverable }`, serializing as `{ "type": "hosted_ai", "code": "...", "message": "...", "recoverable": true|false }`, per the existing discriminated-union convention.

### Structure Patterns

- `apps/api-bedrock/` is a new top-level `apps/*` deployable, matching the monorepo's existing convention (`apps/desktop`, `apps/web`) and the same convention `architecture-entitlements-licensing.md` designed for its own not-yet-implemented `apps/api-licensing` — never nested inside `apps/desktop`.
- Cloud tests co-located per handler/file (`invoke.ts` + `invoke.test.ts`, `api.ts` + `api.test.ts`), Vitest — same convention `architecture-entitlements-licensing.md` designed for `apps/api-licensing`.
- Desktop-side files slot into the existing `ai/`, `commands/` structure — no new top-level folder in `apps/desktop`, and no new `hooks/`/`lib/constants.ts` entries, since hosted-AI status has no frontend surface.

### Format Patterns

- Wire JSON is snake_case at the public API boundary (matches Rust IPC convention); the Lambda internally translates to/from the AWS SDK's own Converse-shaped types, which are never part of the public contract.
- NDJSON frames are always single-line, newline-terminated JSON, preceded by API Gateway's required metadata JSON and exactly eight NUL bytes — no pretty-printing, no partial-line buffering assumptions on either side.
- Desktop IPC surfacing of hosted-AI errors: unchanged `AppError` envelope (`HostedAi` variant), no custom shape.

### Enforcement Guidelines

**All AI agents implementing this feature MUST:**
- Accept only the closed `CloudAiMessage`/`CloudAiContent` union as sent — `system` and `messages` are required, desktop-owned fields; reject a client-supplied model ID, a client-supplied token-limit override, an operation outside the closed enum, a content-type not permitted for that operation (e.g. an image block on `chat`), and any payload exceeding the per-operation ceiling.
- Follow the exact request handling order from spine AD-8: schema/byte validation → config read/eligibility classification → `CountTokens` (only for an eligible caller) → reserve → `ConverseStream`. Never call `CountTokens` for a caller already rejected at the eligibility step.
- Never emit the `meta` frame, or the API Gateway streaming prelude, before `ConverseStream`'s `messageStart` event has actually been received — not immediately after quota reservation.
- Use the three precomputed idempotency tokens (reserve/refund/finalize) as the `ClientRequestToken` on their respective `TransactWriteItems` calls; never reuse one token across two different transaction kinds.
- Never call `keyring_core::Entry` from anywhere in the hosted-adapter code path — always through `credentials.rs` via `commands/auth.rs`.
- Never introduce a second Lambda for a second operation or route — `src/functions/api.ts` is the sole entry point.
- Never expose `HostedAiState` via a Tauri command or a frontend hook — it is Rust-internal to `ai/hosted_bedrock.rs` and `ai/hosted_state.rs`, and must be invalidated on any `subject_sub` mismatch before use.
- Never route `commands/settings.rs::test_ai_connection` through the hosted path — it tests BYO credentials only.
- Never persist or log `messages`, `system`, any message `content` block, or any Bedrock response text in Nixus-controlled storage; never log the statement file path from `cc_parser.rs`.
- Never claim `dynamodb:ConditionCheckItem` as a grantable IAM action — the transactions above are authorized entirely by `dynamodb:TransactWriteItems`.

### Pattern Examples

**Good:** `HostedBedrockAdapter::invoke()` calls `commands/auth.rs::get_hosted_ai_token()`, which internally calls `credentials.rs::load_cognito_session()` — never touches the keyring itself.
**Anti-pattern:** a second Lambda (`invoke-chat.ts`, `invoke-advice.ts`, ...) instead of one `functions/api.ts` router — rejected for the same reason `architecture-entitlements-licensing.md` rejected one-Lambda-per-webhook-event.
**Anti-pattern:** emitting `meta` right after the quota transaction succeeds, before `ConverseStream` has even been called — this is exactly the ambiguity this revision closes; `messageStart` is the only valid trigger.

## Project Structure & Boundaries

### Complete Project Directory Structure (delta)

```
nixus/
├── apps/
│   ├── desktop/
│   │   └── src-tauri/src/
│   │       ├── ai/
│   │       │   ├── backend.rs              # NEW — AiBackend trait, precedence/closed-fallback-table logic
│   │       │   ├── hosted_bedrock.rs        # NEW — HostedBedrockAdapter (NDJSON client, calls apps/api-bedrock)
│   │       │   └── hosted_state.rs          # NEW — HostedAiState cache, subject_sub-scoped, no Tauri command
│   │       ├── commands/
│   │       │   └── auth.rs                  # MODIFIED — call-time token helper (120s skew, one 401 retry;
│   │       │                                #             is_session_expired comment/tests updated for the skew)
│   │       └── error.rs                     # MODIFIED — AppError::HostedAi { code, message, recoverable }
│   │
│   └── api-bedrock/                          # NEW — a new AWS cloud service alongside apps/desktop, apps/web
│       ├── package.json
│       ├── template.yaml                     # SAM: REST API + Cognito authorizer + one Lambda + DynamoDB
│       │                                      #   (USER#/GLOBAL items, PITR, Retain, custom domain params)
│       ├── samconfig.toml
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── functions/
│           │   ├── api.ts                    # sole Lambda handler (streamifyResponse), routes both endpoints
│           │   └── api.test.ts
│           ├── handlers/
│           │   ├── status.ts                 # GET /v1/ai/status logic, called from functions/api.ts
│           │   ├── status.test.ts
│           │   ├── invoke.ts                 # POST /v1/ai/invoke logic — CountTokens, reserve, ConverseStream
│           │   └── invoke.test.ts
│           └── lib/
│               ├── table.ts                  # DynamoDB client, key builders (USER#/GLOBAL)
│               ├── quota.ts                  # reserve/refund/finalize, exact fields, ClientRequestToken
│               ├── quota.test.ts
│               └── bedrock-client.ts          # CountTokens + ConverseStream wrapper
│
├── packages/
│   └── shared/src/types/
│       └── cloud-ai.ts                       # NEW — canonical protocol schema (status/invoke/error/frames)
│
└── .github/workflows/
    └── api-bedrock-ci.yml                    # NEW — paths-filtered verify + OIDC deploy (implementation target, not written now)
```

### Architectural Boundaries

**API Boundaries:**
- External inbound: desktop → API Gateway `GET /v1/ai/status` / `POST /v1/ai/invoke`, Cognito-authorizer-gated — the only public entry points.
- Lambda → Bedrock: outbound-only, `CountTokens` + `InvokeModelWithResponseStream` (`ConverseStream`), IAM-scoped to one inference profile.
- Lambda → DynamoDB: outbound-only, scoped to the one table; config mutation only via transaction condition checks, never a direct Lambda write.
- Desktop internal: `AiBackend` is the only boundary any of the four AI surfaces cross to reach either hosted or BYO providers.

**Component Boundaries:**
- `hosted_bedrock.rs` depends on `commands/auth.rs` for tokens and never on `credentials.rs` directly.
- `ai/hosted_state.rs` is the sole owner of `HostedAiState`; only `ai/hosted_bedrock.rs` reads or invalidates it — no Tauri command and no frontend hook exist for hosted-AI status.
- `commands/settings.rs::test_ai_connection` never calls into `ai/hosted_bedrock.rs` — it remains a BYO-only credential test.

**Service Boundaries:**
- After this feature, three independently deployable units are implemented: `apps/desktop`, `apps/web`, `apps/api-bedrock` — each keeps its own release cadence and its own deploy mechanism (the latter via OIDC, no static keys). `apps/api-licensing` (`architecture-entitlements-licensing.md`) remains a designed-but-not-yet-implemented sibling; this document does not claim it exists.

**Data Boundaries:**
- `apps/api-bedrock`'s DynamoDB table holds only quota/config metadata keyed by Cognito `sub` plus one `GLOBAL` partition — no financial data, no licensing data, no overlap with any table the entitlements feature might introduce. The table itself is `Retain`-protected against the stack's own deploy role.
- Desktop SQLite is untouched by this feature — hosted-AI status lives only in the Rust-process-local, `subject_sub`-scoped `HostedAiState` cache, never in SQLite, never in the webview/TanStack Query cache.

### Requirements to Structure Mapping

- FR1 (hosted routing, no toggle) → `ai/backend.rs`, `ai/hosted_bedrock.rs`
- FR2 (quota + global cap, closed fallback) → `handlers/invoke.ts`, `lib/quota.ts`, `ai/backend.rs`'s closed-table logic
- FR3 (manual console admin) → DynamoDB `CONFIG` items, edited directly — no code
- FR4 (chat streaming preserved) → `template.yaml` `ResponseTransferMode: RESPONSE_STREAM`, NDJSON `delta` frames
- FR5 (OIDC CI/CD) → `.github/workflows/api-bedrock-ci.yml`
- FR6 (Terms/Privacy disclosure gate) → Legal & Disclosure section; no code artifact

### Integration Points

**Internal Communication:** unchanged Tauri IPC inside the desktop; the new hosted call path is an HTTP/NDJSON client inside `hosted_bedrock.rs`, not a new IPC command.
**External Integrations:** Cognito (auth, unchanged provider, one new scope), Amazon Bedrock (`us.anthropic.claude-sonnet-4-6`, `CountTokens` + `ConverseStream`), DynamoDB, API Gateway.
**Data Flow:** desktop obtains a Cognito access token via `commands/auth.rs` → `HostedBedrockAdapter` POSTs to `/v1/ai/invoke` with the Bearer token → API Gateway authorizer verifies + injects `sub` → Lambda validates the request schema, reads `USER#CONFIG`/`GLOBAL#CONFIG` and classifies eligibility, calls `CountTokens` (only if eligible), reserves both usage items in one transaction, calls `ConverseStream` → on `messageStart` the Lambda commits (API GW prelude + `meta`), then relays `delta`/`end` frames → the adapter surfaces the stream to the calling AI surface and invalidates `HostedAiState` on any `403`/`429`/`503`.

## Cost

At zero traffic, API Gateway, Lambda, and DynamoDB on-demand carry **no minimum compute or request charge** — nothing accrues purely from existing. That said, once the service has been used, retained data isn't free forever: DynamoDB storage for the `CONFIG`/`USAGE#` items and 14-day CloudWatch log retention can incur small storage charges after use, typically within beta-scale free-tier allowances but not literally zero.

- **API Gateway REST API requests** cost **$3.50 per million requests in `us-east-1`**, plus data-transfer and streaming-specific charges — small at beta volume.
- **Bedrock token pricing is dynamic** and not reproduced as a fixed number in this document; the [AWS Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) is the authoritative, always-current source — re-check it before setting or changing `monthly_request_limit` defaults on either the user or `GLOBAL` config.
- **Bedrock tokens remain the dominant, unbounded-if-uncapped cost.** This is why the per-operation input/output ceilings (`CountTokens`-checked), the per-user quota, and the `GLOBAL` hard cap (AD-6/AD-14) are the layered, service-specific stops. An AWS Budget of $50/month scoped to **Amazon Bedrock service spend across the AWS account** (80%/100% alerts) is an additional, softer notification-only control — cost allocation isolating spend to this one stack specifically is not claimed here unless separately verified against the account's actual cost-allocation tag setup. Separate CloudWatch alarms/metrics on API Gateway and Lambda error rates cover the non-Bedrock portion of the stack, since the Budget alert alone would not surface an API/Lambda-side failure spike.

## Cited Sources (retrieved 2026-08-25)

- [API Gateway — Configure a response transfer mode](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html) — `ResponseTransferMode=STREAM` for REST API `AWS_PROXY` integrations via `InvokeWithResponseStream`; not supported on HTTP APIs.
- [Lambda — Response payload streaming for API Gateway REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode-lambda.html) — the Lambda-side response-streaming integration format, including the required metadata-JSON + eight-NUL-byte prelude.
- [AWS SAM — `Api` event source `ResponseTransferMode` property](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-function-api.html) — `RESPONSE_STREAM`, and `AWS::Serverless::Api` `DefinitionBody`/OpenAPI `x-amazon-apigateway-integration.responseTransferMode=STREAM`.
- [Amazon Cognito — Control access to REST APIs with Amazon Cognito user pools](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html) — user-pool authorizers for API Gateway REST APIs and custom resource-server scopes.
- [Amazon DynamoDB — Condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html) and [`TransactWriteItems`](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html) — race-safe conditional writes and the `ClientRequestToken` idempotency mechanism.
- [Amazon DynamoDB — Point-in-time recovery](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html) — PITR configuration referenced in AD-15.
- [Amazon Bedrock — CountTokens](https://docs.aws.amazon.com/bedrock/latest/userguide/count-tokens.html) — the pre-invocation input-token check used in AD-8.
- [Amazon Bedrock — Cross-region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html) — the `us.` inference-profile data-handling behavior disclosed in Legal & Disclosure.
- [AWS Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) — `nodejs22.x` on `arm64` current and supported through April 2027; `nodejs24.x` available but not adopted here.
- [`aws-actions/configure-aws-credentials`](https://github.com/aws-actions/configure-aws-credentials) — GitHub Actions OIDC federation (`role-to-assume`), current major `v6`, referenced in AD-12.
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/) and [Amazon API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/) — the $3.50/million REST-request figure and Lambda's compute/free-tier basis cited in Cost.
- [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) — the $50/month alert mechanism referenced in AD-14.
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) — authoritative, dynamic source of truth for token cost; not reproduced as a fixed number in this document.

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** Regional REST API + Cognito authorizer + streaming Lambda + exact-field, idempotent reserve/refund (per-user and global) + `messageStart`-gated commit + ports-and-adapters desktop routing all interoperate with no version or capability conflict. The deliberate divergences from the licensing-feature precedent — automated OIDC CI/CD instead of manual `sam deploy`, and Regional REST instead of a hypothetical HTTP API — are each explicitly justified rather than left unexplained.

**Pattern Consistency:** Every naming/error/structure pattern extends an existing convention (`AppError`, `credentials.rs` sole-accessor, `apps/*` top-level services, Vitest co-location) — nothing here is a parallel convention. The Closed Fallback Table replaces what was previously scattered fallback prose with one authoritative lookup both the desktop and this document reference.

**Structure Alignment:** The directory delta introduces exactly one new top-level app (`apps/api-bedrock`) and one new shared-types file, and modifies desktop files only inside their existing `ai/`, `commands/` homes — no new `hooks/`/`lib/constants.ts` entries, since hosted-AI status is entirely Rust-internal.

### Requirements Coverage Validation ✅

All 6 FRs map to specific files (or, for FR6, an explicitly non-code legal artifact) in the Requirements-to-Structure table. All 5 NFRs are addressed structurally: NFR1 by the Closed Fallback Table, NFR2 by IAM-role-only Bedrock access, NFR3 by content statelessness scoped honestly to Nixus-controlled systems, NFR4 by the four-layer cost control (input/output ceilings, per-user quota, global cap, budget alert), NFR5 by the enforcement guidelines above and the absence of any new frontend surface.

### Implementation Readiness Validation ✅

**Decision Completeness:** every critical decision — region, model, transport, auth scope/detection, exact quota field names, idempotency mechanism, commit event, closed fallback table, CI credential mechanism, disclosure gating — carries a concrete value or a named table, not a placeholder. No "TBD" remains anywhere in this document.
**Structure Completeness:** every new/modified file has a defined location and role.
**Pattern Completeness:** all naming/error/logging/structure conflict points have an explicit resolution, including the field-name agreement between `invoke.ts` and `quota.ts`.

### Gap Analysis Results

**Critical Gaps:** None — nothing here blocks starting implementation.

**Important Gaps (non-blocking, resolve during implementation):**
- Any marketing-site copy repeating the "data never leaves your machine" claim (beyond the already-identified root `README.md`) must still be located and audited at rollout time — not invented here.
- Whether a suitable seam already exists in the live `ai/` module for the `AiBackend` port, or whether it needs to be introduced fresh, should be confirmed by reading the current code at implementation time.
- Whether CloudFormation's `DeletionPolicy`/`UpdateReplacePolicy: Retain` on the table is sufficient on its own, or whether a separate stack policy / manual break-glass step is also needed to fully prevent the deploy role from replacing the table, should be verified against the account's actual deploy tooling at implementation time (AD-15 states the requirement; the exact enforcement mechanism is an implementation-time verification).

**Nice-to-Have Gaps:**
- A CloudWatch alarm on elevated `hosted_unavailable`/`quota_exhausted` rates, on top of the AWS Budget alert, would help distinguish a Bedrock outage from an underscoped quota default early — not required for v1.

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION. Production rollout additionally requires the Legal & Disclosure gate (AD-13) to be satisfied.
**Confidence Level:** High — every critical decision, including this revision's exact quota semantics, commit-event timing, closed-fallback table, request handling order, and canonical message schema, was resolved to a concrete value; the remaining Important Gaps are implementation-time verifications, not open architectural questions.

### Implementation Handoff

**AI Agent Guidelines:**
- Follow this document and its companion spine exactly; where the two overlap, the spine's `AD` wording is the enforceable statement and this document is the reasoning behind it.
- Never conflate this feature's `premium` flag with any Keygen/LemonSqueezy entitlement — they share no code, no table, no concept.
- Never build an in-app consent gate for hosted AI — the adopted disclosure mechanism is Terms/Privacy Policy only (AD-13).
- Refer to `architecture-login.md`'s loopback amendment for the current OAuth callback shape; it is unrelated to this feature and unaffected by it.

**First Implementation Priority:**
Draft `packages/shared/src/types/cloud-ai.ts` from the canonical protocol schema table above — every other component (Lambda handlers, the desktop `AiBackend` retrofit) depends on that contract existing first. `sam init --runtime nodejs22.x --architecture arm64 --name nixus-bedrock-api --app-template hello-world --package-type Zip` inside `apps/api-bedrock/` may proceed in parallel as scaffolding, but handler logic should not be written until the shared contract is in place.
