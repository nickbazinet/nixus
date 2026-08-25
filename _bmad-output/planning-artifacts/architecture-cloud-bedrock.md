---
workflowType: 'architecture'
lastStep: 8
status: 'draft'
inputDocuments:
  - architecture-entitlements-licensing.md
  - architecture-login.md
  - docs/project-context.md
  - .github/workflows/web-ci.yml
  - architecture/architecture-nixus-2026-08-25/.memlog.md
workflowType: 'architecture'
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

Nixus's desktop app has four AI surfaces — streaming chat, statement import, project advice, trends insight — each calling AWS Bedrock directly with credentials the user supplies and stores in the OS keyring (BYO). This works, but it's a ceiling: nixus can't offer a "just works" premium tier without asking every premium user to create their own AWS account and paste in credentials. This feature adds a Nixus-hosted path: premium, signed-in Cognito users get Bedrock access brokered entirely server-side, metered by a monthly request quota, with automatic fallback to their existing BYO configuration when hosted access isn't available.

**Explicit non-goal:** this is not the entitlements/licensing system. Premium hosted-AI access is assigned by editing a DynamoDB record by hand; it has no relationship to Keygen or LemonSqueezy. See the Related Documents note above — this is stated once here and is binding for every section below.

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
- FR1: A signed-in, premium Cognito user's AI calls (chat, statement import, project advice, trends insight) are served by Nixus-hosted Bedrock instead of their BYO credentials, with no user-facing toggle.
- FR2: Hosted access is metered by a configurable monthly request quota per Cognito user; exceeding it degrades to BYO fallback or a typed error, never a silent failure.
- FR3: Premium status and quota are administered by hand in the AWS console (DynamoDB item edit) for v1 — no billing integration, no admin UI.
- FR4: Chat remains token-streamed end-to-end through the hosted path; the other three surfaces remain single-shot responses.
- FR5: Hosted infrastructure deploys via a dedicated, automated GitHub Actions pipeline (PR verification + default-branch deploy) — no manual `sam deploy` step in the steady state.

**Non-Functional Requirements:**
- NFR1 — Local-first: hosted-service unavailability degrades to BYO/typed error, never blocks app launch or non-AI functionality.
- NFR2 — Zero-trust to the device: no AWS credential of any kind is ever vended to or cached on a device.
- NFR3 — Privacy: no financial content, prompt, response, attachment, or file path is ever persisted in DynamoDB or CloudWatch.
- NFR4 — Cost at low scale: near-zero idle cost; the only unbounded cost driver (Bedrock tokens) is capped by server-owned ceilings, not left to client discretion.
- NFR5 — Convention consistency: extends `AppError`, the existing `AiBackend`-shaped routing, TanStack Query, Rust command/db layering — no parallel patterns.

**Scale & Complexity:**
- Primary domain: new cloud service (`apps/api-bedrock`) + a routing/adapter change inside the existing desktop AI layer.
- Complexity level: Medium-High — one new AWS service with streaming, quota transactions, and four call sites to re-route on the desktop.
- Estimated architectural components: 5 — (1) API Gateway + Lambda + DynamoDB stack, (2) Cognito scope/app-client update, (3) shared TypeScript contract package, (4) desktop `AiBackend` port + hosted adapter, (5) GitHub Actions deploy pipeline.

### Technical Constraints & Dependencies

- Live desktop code has one streaming Bedrock surface (chat, via `ConverseStream`) and three non-streaming surfaces (project advice, trends insight, statement import), currently spread across separate concrete AWS client call sites rather than one abstraction. This feature is the forcing function that introduces the `AiBackend` port all four surfaces converge on.
- The existing Cognito user pool and its `sub` claim (`architecture-login.md`) are the only identity system this feature is allowed to depend on.
- `credentials.rs` is the sole keyring accessor (`architecture-credentials.md` precedent, reaffirmed in `architecture-login.md`); the hosted adapter must call through `commands/auth.rs`, never touch the keyring directly.
- API Gateway HTTP API cannot stream Lambda responses and caps integration timeout at 30s (non-raisable) — ruled out for chat. Regional REST API supports `ResponseTransferMode=STREAM` for `AWS_PROXY` integrations via `InvokeWithResponseStream`, at every REST endpoint type, confirmed against current AWS documentation.
- `web-ci.yml` establishes the GitHub Actions pattern this feature's pipeline follows structurally (checkout → pnpm setup → verify job → gated deploy job using `aws-actions/configure-aws-credentials@v4` in `us-east-1`) but not its trigger shape (`apps/web` is a static SPA, no SAM) and not its credential scope — a new, separately scoped deploy principal is required so this pipeline cannot mutate the web CDN or vice versa.

### Cross-Cutting Concerns Identified

- Denial-of-wallet risk: Bedrock token cost is the one truly unbounded cost driver in this feature. Addressed via server-owned model/operation/output-token ceilings (never client-supplied) plus request quota — two independent controls, not one.
- Streaming failure semantics: once the first hosted byte reaches the desktop, silent fallback would risk duplicate AI output or duplicate downstream actions (e.g., a tool call already fired). The framing and fallback boundary (AD-7 in the spine) exists specifically to close this.
- Credential lifecycle collision risk: Cognito session tokens (machine-level) and BYO AI credentials (per-dataset) must not merge into one lifecycle just because both now feed AI calls.
- CI divergence from `architecture-entitlements-licensing.md`'s deliberately manual, low-ceremony deploy: this service's owner explicitly required automated GitHub Actions deploy, so the two `apps/*` cloud services intentionally differ in delivery maturity. This is a stated choice, not an oversight.

## Starter Template Evaluation

### Primary Technology Domain

Brownfield addition — a new `apps/*` AWS cloud service. `architecture-entitlements-licensing.md` designed (but has not yet implemented) `apps/api-licensing` as a sibling cloud service on the same stack; this feature follows that same planned convention: TypeScript + AWS SAM, Node.js 22, ARM64.

### Selected Starter: AWS SAM (TypeScript, Node.js 22, ARM64) — same as the entitlements precedent

**Rationale:** this service reuses the entitlements document's cloud-service conventions verbatim for language, runtime, and IaC tooling — there is no reason to introduce a second toolchain if/when a second AWS Lambda service exists in this monorepo. What differs from that planned precedent is the **API type** (Regional REST, not HTTP API — streaming requires it) and the **deploy automation** (this service auto-deploys via CI; the licensing bridge's design deploys manually). Both divergences are load-bearing technical requirements (streaming, and an explicit user requirement for automated deploy), not inconsistency.

**Initialization command:**
```bash
sam init --runtime nodejs22.x --architecture arm64 --name nixus-bedrock-api --app-template hello-world --package-type Zip
```

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Transport: Regional API Gateway REST API + Cognito user-pool authorizer + streaming Lambda (see spine AD-2, AD-3).
- Compute topology: one Lambda, operation-discriminated dispatch (AD-4).
- Quota model: reserve-then-refund per-Bedrock-call unit, DynamoDB single-table (AD-5, AD-6).
- Provider precedence: hosted-first ports-and-adapters on the desktop (AD-9).
- CI/CD: automated GitHub Actions deploy, separately scoped from the web CDN key (AD-12).

**Important Decisions (Shape Architecture):**
- NDJSON framing and the pre-first-byte fallback boundary (AD-7).
- Status caching cadence (5 minutes, invalidated by 403/429).
- Custom domain (`api.nixusapp.com`) contingent on existing Route53/ACM resources.

**Deferred Decisions (Post-v1, explicitly out of scope):**
- S3-backed statement upload beyond the 4 MiB raw ceiling.
- A usage reconciler for Lambda-crash-leaked reservations.
- A staging environment/second SAM stack.
- Any admin UI or billing automation for premium/quota management.

### Data Architecture

**Single DynamoDB on-demand table**, partitioned per Cognito user:

| pk | sk | Attributes |
|---|---|---|
| `USER#<sub>` | `CONFIG` | `premium: bool`, `monthly_request_limit: number`, `version: number`, `updated_at` |
| `USER#<sub>` | `USAGE#<YYYY-MM>` | `request_count`, `completed_count`, `refunded_count`, per-operation counters, aggregate `input_tokens`/`output_tokens`, `updated_at` |

- **Fail-closed (invoke only):** on `POST /v1/ai/invoke`, a missing `CONFIG` item, a malformed one, `premium=false`, or `monthly_request_limit<=0` all resolve to "not entitled" (`403 premium_required` or `429 quota_exhausted` depending on which check fails). `GET /v1/ai/status` treats the same missing/malformed condition as a normal non-premium read (`200`, zeroed fields) — see API & Communication Patterns. There is no bootstrap/PostConfirmation Lambda — a user who has never been made premium costs Nixus nothing and is indistinguishable from any other non-premium user.
- **Period key:** `YYYY-MM` is computed in UTC at request time; there is no reset job — a new month simply produces a new, previously-nonexistent `USAGE#` item on first use.
- **Enforcement sequence:** (1) strongly consistent `GetItem` on `CONFIG`; (2) `TransactWriteItems` that rechecks `CONFIG.version`/`premium`/`monthly_request_limit` against the value just read and conditionally increments `request_count` on the current-month `USAGE#` item only if the resulting count stays below the limit. This closes the read-then-write race between two concurrent requests from the same user.
- **Reserve/refund:** the transaction above is the reservation, performed before the Lambda calls `ConverseStream`. Refund is a second, targeted `UpdateItem` against the same `USAGE#` item, issued only when the Lambda observes failure before the first valid Bedrock event is received (stream establishment failure, or an error prior to that first event). Once the first Bedrock event has arrived and the Lambda has begun writing the HTTP response (the `meta` frame), the reservation is never refunded, regardless of how the stream ends — this is what makes "one quota unit = one Bedrock invocation" enforceable without a reconciliation pass. A Lambda crash mid-flight may leave one reservation un-refunded; v1 accepts this as a bounded, rare cost rather than building a reconciler.
- **Quota unit definition:** one unit per actual `InvokeModelWithResponseStream` call. A chat turn that triggers a local tool and a second model call to interpret the tool result consumes two units — quota tracks Bedrock cost, not UI-visible messages.

### Authentication & Security

- **Identity:** unchanged Cognito user pool from `architecture-login.md`. This feature adds resource-server scope `nixus-api/ai.invoke` to the existing app client. Existing sessions lack the scope and must sign in again after this ships — a one-time, expected re-auth, not a bug.
- **Authorization:** the API Gateway Cognito authorizer validates the access token and injects the verified `sub` into the Lambda's request context. The Lambda derives the acting user exclusively from that context — a `user_id` field in the request body, if ever present, is never trusted.
- **Transport security:** TLS terminates at API Gateway; no additional application-layer encryption is needed for a Bearer-token-authenticated internal API.
- **No static credentials at runtime:** the Lambda's execution role is the only AWS identity involved in calling Bedrock or DynamoDB. No SSM Parameter Store, no Secrets Manager — nothing here is secret in the way the licensing bridge's Keygen token/webhook secret are.
- **IAM scoping:** the execution role is limited to `logs:*` (CloudWatch), `dynamodb:GetItem`/`TransactWriteItems`/`UpdateItem` on the one table, and `bedrock:InvokeModelWithResponseStream` scoped to the approved inference profile ARN plus its underlying destination foundation-model ARNs (cross-region inference profiles require both to be granted).

### API & Communication Patterns

**Routes** (both behind the Cognito authorizer, scope `nixus-api/ai.invoke`):

- `GET /v1/ai/status` — returns `{ premium: bool, monthly_request_limit: number, request_count: number, period: "YYYY-MM" }`. Read-only, no quota consumption, no Bedrock call. If `CONFIG` is missing or malformed, this route returns **HTTP 200** with `premium: false`, `monthly_request_limit: 0`, `request_count: 0` — a non-premium user is a normal, successful response, not an error. `POST /v1/ai/invoke` is the route that fails closed with `403 premium_required` on the same missing/malformed config; the two routes intentionally disagree on status code because one is a status read and the other is an enforcement gate.
- `POST /v1/ai/invoke` — the sole hosted-AI entry point for all four surfaces.

**Invoke request contract:**
```
{
  "operation": "chat" | "statement_import" | "project_advice" | "trends_insight",
  "messages": [...],        // finalized, desktop-owned conversation turns
  "system": "...",          // finalized system prompt, desktop-owned
  "media": [...] | null,    // finalized attachment payloads, desktop-owned (statement_import)
  "client_request_id": "uuid"  // tracing only — never used for auth or idempotency
}
```
The server never receives a model name, a token-limit override, or an unsupported/unknown operation — the Lambda validates `operation` against the closed enum and resolves model/token ceilings server-side; anything else is `400 validation`. `messages`/`system`/`media` arrive fully assembled and desktop-owned; the Lambda does not re-derive prompts, it forwards them to Bedrock and enforces payload/size ceilings.

**Response framing** — `application/x-ndjson`, one JSON object per line:
- `{"type":"meta", ...}` — first frame, emitted only after the quota reservation succeeds **and** the Bedrock stream has actually started (the first valid Bedrock event has been received). It is not emitted immediately after reservation.
- `{"type":"delta", "text": "..."}` — zero or more; chat streams many, the other three surfaces typically emit one accumulated delta before `end`.
- `{"type":"end"}` — terminal success frame.
- `{"type":"error", "code": "...", "message": "..."}` — terminal in-band failure, only possible after `meta` has been sent.

**Pre-output vs. mid-stream errors:** the Lambda reserves quota, then calls `ConverseStream`. If stream establishment fails, or any error occurs before the first Bedrock event is received, the Lambda refunds the reservation and returns a normal HTTP error with a real status code — `400`, `401`, `403`, `413`, `429`, or `503` — and the connection carries no NDJSON body. Only once the first valid Bedrock event arrives does the Lambda write the HTTP response headers/streaming metadata and the `meta` frame; from that point forward, no refund and no fallback are possible — any further failure is an in-band `error` frame. This sequencing (reserve → invoke → refund-and-503-if-pre-first-event, else commit-and-stream) is what makes desktop fallback to BYO safe, because the desktop can distinguish "never started" from "started and failed."

**Server-owned ceilings (v1, concrete):**

| Operation | Serialized JSON | Output tokens |
|---|---|---|
| chat | 1 MiB | 4096 |
| project_advice | 256 KiB | 1024 |
| trends_insight | 256 KiB | 1024 |
| statement_import | 256 KiB (excl. media) | 8192 |

Raw statement media (pre-base64) is capped at 4 MiB and rejected with `413 payload_too_large` before base64 encoding — encoding a 4 MiB file would otherwise silently balloon the JSON payload by ~33%. S3-backed upload is explicitly deferred until real statements are observed exceeding this cap; nothing in this feature builds toward that path yet.

**Typed error mapping** (HTTP status for pre-output; error-frame `code` for mid-stream):

| Code | HTTP status | Meaning |
|---|---|---|
| `validation` | 400 | malformed request body/operation |
| `unauthorized` | 401 | authorizer/session rejected the token |
| `premium_required` | 403 | `CONFIG.premium` is false or missing |
| `payload_too_large` | 413 | JSON or raw media ceiling exceeded |
| `quota_exhausted` | 429 | monthly limit reached |
| `hosted_unavailable` | 503 | Bedrock/service failure before output |

The desktop maps every one of these into the existing `AppError` philosophy (extending it with an AI-hosted-specific variant carrying `recoverable: bool`, mirroring the existing `ai_service` pattern) — it never surfaces the raw code or an upstream Bedrock error string to the user.

### Desktop Architecture (Rust-owned; no new frontend/IPC surface)

**Ports-and-adapters `AiBackend`:** all four AI surfaces (chat, statement import, project advice, trends insight) call through one Rust trait/module boundary. `HostedBedrockAdapter` and the existing BYO Bedrock/OpenAI clients are adapters behind it — none of the four call sites talks to a concrete AWS or OpenAI client directly anymore. This is the structural fix for the fragmentation noted in Cross-Cutting Concerns.

**Precedence rule:** whenever a signed-in premium user has remaining quota and the hosted gateway is reachable, `HostedBedrockAdapter` is selected — even if the user has explicitly configured OpenAI for that surface. This is a deliberate override of user provider choice for premium users, chosen because "premium" is meant to mean "it just works," not "it works if you also remembered to pick it."

**Fallback rule:** a `quota_exhausted` or `hosted_unavailable` response *before the `meta` frame* causes the adapter to retry the same call against the prior configured provider (BYO Bedrock, or OpenAI where that surface supports it). Bedrock-only surfaces (statement_import's multimodal path) require BYO Bedrock specifically or return a typed error — OpenAI is not a valid fallback there. A failure *after* `meta` never falls back; it surfaces as the desktop's standard AI error state.

**Credential call path:** `HostedBedrockAdapter` obtains a call-time access token from `commands/auth.rs`, which refreshes proactively at a 120-second skew before expiry and performs exactly one refresh+retry on a `401` before giving up and falling back/erroring. It never reads the keyring directly — `credentials.rs` remains the sole accessor, unchanged from `architecture-login.md`.

**Status cache — entirely Rust-side, no frontend/IPC surface:** a new `ai/hosted_state.rs` module owns a process-wide `HostedAiState` (in-memory cache of the last-known `/v1/ai/status` response plus its fetch time), read and refreshed only by `AiBackend`/`HostedBedrockAdapter`, never exposed as a Tauri command or a TanStack Query hook. Rules:
- No call to `/v1/ai/status` is made while there is no auth session (logged out).
- The cache is refreshed once after login and once after app launch when a session is available.
- Before any AI call, if the cache is absent or older than 5 minutes, `HostedBedrockAdapter` lazily refreshes it first.
- A `403` or `429` from `/v1/ai/invoke` invalidates the cache immediately, so a manual console premium/limit change is reflected within 5 minutes without any polling loop, and without a background timer.
- No status UI exists in v1 — there is no premium badge, no quota indicator, nothing rendered from `HostedAiState`. A future quota/premium badge surfaced through a Tauri command is explicitly Deferred, not built now.

### Decision Impact Analysis

**Implementation sequence:**
1. AWS console: add scope `nixus-api/ai.invoke` to the existing Cognito resource server/app client (one-time, out-of-band — do not attempt to import the existing user pool into this stack).
2. `apps/api-bedrock` (`sam init`) — SAM template (API Gateway REST + Cognito authorizer + one Lambda + DynamoDB), `src/functions/api.ts` (sole `streamifyResponse` handler/router), `src/handlers/status.ts`, `src/handlers/invoke.ts`, `src/lib/quota.ts` (reserve/refund), `src/lib/bedrock-client.ts`, Vitest specs.
3. `packages/shared/src/types/cloud-ai.ts` — the invoke request/response contract, operation enum, error codes; mirrored Rust wire models in the existing Rust models location.
4. Desktop: introduce the `AiBackend` port, retrofit the four existing surfaces onto it, add `HostedBedrockAdapter` and `ai/hosted_state.rs`, extend `commands/auth.rs` for call-time tokens, extend `AppError`.
5. `.github/workflows/api-bedrock-ci.yml` — paths-filtered PR verify (install/lint/typecheck/test/`sam validate`/`sam build`) + default-branch deploy job using a new, separately scoped `AWS_INFRA_DEPLOY_ACCESS_KEY_ID`/`SECRET` pair.
6. If a Route53 hosted zone/ACM certificate for `api.nixusapp.com` already exist, wire the SAM template's Regional custom-domain parameters; otherwise ship on the default execute-api URL and revisit.

**Cross-component dependency:** the shared `cloud-ai.ts` contract (step 3) blocks both the Lambda handlers (step 2) and the `AiBackend` retrofit (step 4) — define it once before either side hardens its own shape.

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Cloud (`apps/api-bedrock`, new domain):**
- Files: `src/functions/api.ts` (sole Lambda entry point, `streamifyResponse`-wrapped router), `src/handlers/status.ts`, `src/handlers/invoke.ts`, `src/lib/quota.ts`, `src/lib/bedrock-client.ts`, `src/lib/table.ts`.
- Functions: camelCase (`reserveQuotaUnit`, `refundQuotaUnit`, `getUserConfig`).
- Logs: structured `console.log`/`console.error` JSON (`{ event, request_id, sub, operation, status }`) — same non-unification-with-`tracing` rationale as `architecture-entitlements-licensing.md`: different runtime, no cross-boundary logging library requirement. Fields are `snake_case` to match the desktop's IPC convention, even in TypeScript, since these logs describe the same domain the Rust side reasons about.

**Shared:**
- `packages/shared/src/types/cloud-ai.ts` exports `CloudAiOperation`, `CloudAiInvokeRequest`, `CloudAiFrame` (discriminated union `meta|delta|end|error`), `CloudAiErrorCode`.

**Desktop (Rust):**
- New trait/module: `ai/backend.rs` defines `AiBackend` (or the existing `ai/` module gains this boundary if a suitable seam already exists at implementation time — verify against live code before creating a parallel one).
- New: `ai/hosted_bedrock.rs` (adapter), extends `commands/auth.rs` with a `get_hosted_ai_token()`-shaped internal helper (not a new Tauri command — this is adapter-internal, not IPC-exposed).
- New: `ai/hosted_state.rs` defines `HostedAiState` (cached status + fetch timestamp) and the refresh/invalidate functions consumed only by `ai/hosted_bedrock.rs` — no Tauri command, no frontend hook.
- `AppError` gains a variant analogous to the existing `ai_service` shape, carrying `recoverable: bool` and the mapped code, per the existing discriminated-union JSON convention (`{ "type": "...", "message": "...", "recoverable": true }`).

### Structure Patterns

- `apps/api-bedrock/` is a new top-level `apps/*` deployable, matching the monorepo's existing convention (`apps/desktop`, `apps/web`) and the same convention `architecture-entitlements-licensing.md` designed for its own not-yet-implemented `apps/api-licensing` — never nested inside `apps/desktop`.
- Cloud tests co-located per handler (`invoke.ts` + `invoke.test.ts`), Vitest — same convention `architecture-entitlements-licensing.md` designed for `apps/api-licensing`.
- Desktop-side files slot into the existing `ai/`, `commands/`, `hooks/` structure — no new top-level folder in `apps/desktop`.

### Format Patterns

- Wire JSON: `snake_case` throughout the invoke contract and status response — matches Rust IPC convention exactly, even though this boundary is TypeScript-to-TypeScript-then-Rust, so the shape never has to be transformed as it crosses from cloud to desktop.
- NDJSON frames are always single-line, newline-terminated JSON — no pretty-printing, no partial-line buffering assumptions on either side.
- Desktop IPC surfacing of hosted-AI errors: unchanged `AppError` envelope, no custom shape.

### Enforcement Guidelines

**All AI agents implementing this feature MUST:**
- Accept only finalized, desktop-owned `messages`/`system`/`media` in the request body — the Lambda may consume these fields as sent, but must reject a client-supplied model ID, a client-supplied token-limit override, an operation outside the closed enum, and any payload exceeding the per-operation ceiling.
- Never emit the `meta` frame until the quota-reserving transaction has succeeded **and** the first valid Bedrock event has been received — not immediately after reservation.
- Never call `keyring_core::Entry` from anywhere in the hosted-adapter code path — always through `credentials.rs` via `commands/auth.rs`.
- Never introduce a second Lambda for a second operation or route — `src/functions/api.ts` is the sole entry point and dispatches internally to `handlers/status.ts` / `handlers/invoke.ts`.
- Never expose `HostedAiState` via a Tauri command or a frontend hook — it is Rust-internal to `ai/hosted_bedrock.rs` and `ai/hosted_state.rs`.
- Never persist or log `messages`, `system`, `media`, or any Bedrock response text.

### Pattern Examples

**Good:** `HostedBedrockAdapter::invoke()` calls `commands/auth.rs::get_hosted_ai_token()`, which internally calls `credentials.rs::load_cognito_session()` — never touches the keyring itself.
**Anti-pattern:** a second Lambda (`invoke-chat.ts`, `invoke-advice.ts`, ...) instead of one `functions/api.ts` router — rejected in AD-4 for the same reason `architecture-entitlements-licensing.md` rejected one-Lambda-per-webhook-event.

## Project Structure & Boundaries

### Complete Project Directory Structure (delta)

```
nixus/
├── apps/
│   ├── desktop/
│   │   └── src-tauri/src/
│   │       ├── ai/
│   │       │   ├── backend.rs              # NEW — AiBackend trait, provider precedence/fallback logic
│   │       │   ├── hosted_bedrock.rs        # NEW — HostedBedrockAdapter (NDJSON client, calls apps/api-bedrock)
│   │       │   └── hosted_state.rs          # NEW — HostedAiState cache (no Tauri command, no frontend hook)
│   │       ├── commands/
│   │       │   └── auth.rs                  # MODIFIED — call-time token helper (120s skew, one 401 retry)
│   │       └── error.rs                     # MODIFIED — hosted-AI AppError variant (recoverable: bool)
│   │
│   └── api-bedrock/                          # NEW — a new AWS cloud service alongside apps/desktop, apps/web
│       ├── package.json
│       ├── template.yaml                     # SAM: REST API + Cognito authorizer + one Lambda + DynamoDB
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
│           │   ├── invoke.ts                 # POST /v1/ai/invoke logic — dispatches on operation
│           │   └── invoke.test.ts
│           └── lib/
│               ├── table.ts                  # DynamoDB client, key builders
│               ├── quota.ts                  # reserve/refund transaction logic
│               ├── quota.test.ts
│               └── bedrock-client.ts          # InvokeModelWithResponseStream wrapper
│
├── packages/
│   └── shared/src/types/
│       └── cloud-ai.ts                       # NEW — CloudAiOperation, request/frame/error contracts
│
└── .github/workflows/
    └── api-bedrock-ci.yml                    # NEW — paths-filtered verify + auto-deploy (implementation target, not written now)
```

### Architectural Boundaries

**API Boundaries:**
- External inbound: desktop → API Gateway `GET /v1/ai/status` / `POST /v1/ai/invoke`, Cognito-authorizer-gated — the only public entry points.
- Lambda → Bedrock: outbound-only, `InvokeModelWithResponseStream`, IAM-scoped to one inference profile.
- Lambda → DynamoDB: outbound-only, scoped to the one table.
- Desktop internal: `AiBackend` is the only boundary any of the four AI surfaces cross to reach either hosted or BYO providers.

**Component Boundaries:**
- `hosted_bedrock.rs` depends on `commands/auth.rs` for tokens and never on `credentials.rs` directly.
- `ai/hosted_state.rs` is the sole owner of `HostedAiState`; only `ai/hosted_bedrock.rs` reads or invalidates it — no Tauri command and no frontend hook exist for hosted-AI status.

**Service Boundaries:**
- After this feature, three independently deployable units are implemented: `apps/desktop`, `apps/web`, `apps/api-bedrock` — each keeps its own release cadence and its own deploy credentials. `apps/api-licensing` (`architecture-entitlements-licensing.md`) remains a designed-but-not-yet-implemented sibling; this document does not claim it exists.

**Data Boundaries:**
- `apps/api-bedrock`'s DynamoDB table holds only quota/config metadata keyed by Cognito `sub` — no financial data, no licensing data, no overlap with any table the entitlements feature might introduce.
- Desktop SQLite is untouched by this feature — hosted-AI status lives only in the Rust-process-local `HostedAiState` cache, never in SQLite, never in the webview/TanStack Query cache.

### Requirements to Structure Mapping

- FR1 (hosted routing, no toggle) → `ai/backend.rs`, `ai/hosted_bedrock.rs`
- FR2 (quota metering, fallback/error) → `handlers/invoke.ts`, `lib/quota.ts`, `ai/backend.rs` fallback logic
- FR3 (manual console admin) → DynamoDB `CONFIG` item, edited directly — no code
- FR4 (chat streaming preserved) → `template.yaml` `ResponseTransferMode: RESPONSE_STREAM`, NDJSON `delta` frames
- FR5 (automated CI/CD) → `.github/workflows/api-bedrock-ci.yml`

### Integration Points

**Internal Communication:** unchanged Tauri IPC inside the desktop; the new hosted call path is an HTTP/NDJSON client inside `hosted_bedrock.rs`, not a new IPC command.
**External Integrations:** Cognito (auth, unchanged provider, one new scope), Amazon Bedrock (`us.anthropic.claude-sonnet-4-6`), DynamoDB, API Gateway.
**Data Flow:** desktop obtains a Cognito access token via `commands/auth.rs` → `HostedBedrockAdapter` POSTs to `/v1/ai/invoke` with the Bearer token → API Gateway authorizer verifies + injects `sub` → Lambda reads `CONFIG`, reserves `USAGE#<month>`, calls `ConverseStream` → on the first valid Bedrock event the Lambda commits to streaming and emits `meta`, then relays `delta`/`end` frames → the adapter surfaces the stream to the calling AI surface and invalidates `HostedAiState` on any `403`/`429`.

## Cost

At zero traffic: API Gateway, Lambda, and DynamoDB on-demand all carry a **$0 minimum/idle charge** — nothing accrues between requests. At beta scale, Lambda's free tier and per-request compute cost, and DynamoDB's on-demand request-unit cost, are both negligible next to the two costs that actually matter:

- **API Gateway REST API requests:** current AWS list price is **$3.50 per million requests in `us-east-1`**, plus data-transfer and streaming-specific charges — small at beta volume. This feature does not invent a per-token Bedrock price: token pricing is dynamic, and the [AWS Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) is the authoritative, always-current source — re-check it before setting or changing `monthly_request_limit` defaults.
- **Bedrock tokens are the dominant, unbounded-if-uncapped cost.** This is exactly why AD-8's server-owned output-token ceilings and AD-5's per-invocation quota unit both exist as independent controls — either one alone would leave a gap the other closes.

## Cited Sources (retrieved 2026-08-25)

- [API Gateway — Configure a response transfer mode](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html) — `ResponseTransferMode=STREAM` for REST API `AWS_PROXY` integrations via `InvokeWithResponseStream`; not supported on HTTP APIs.
- [Lambda — Response payload streaming for API Gateway REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode-lambda.html) — the Lambda-side response-streaming integration format.
- [AWS SAM — `Api` event source `ResponseTransferMode` property](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-function-api.html) — `RESPONSE_STREAM`, and `AWS::Serverless::Api` `DefinitionBody`/OpenAPI `x-amazon-apigateway-integration.responseTransferMode=STREAM`.
- [Amazon Cognito — Control access to REST APIs with Amazon Cognito user pools](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html) — user-pool authorizers for API Gateway REST APIs and custom resource-server scopes.
- [Amazon DynamoDB — Condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html) and [`TransactWriteItems`](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html) — race-safe conditional writes.
- [AWS Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) — `nodejs22.x` on `arm64` current and supported.
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/) and [Amazon API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/) — the $3.50/million REST-request figure and Lambda's compute/free-tier basis cited in Cost.
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) — authoritative, dynamic source of truth for token cost; not reproduced as a fixed number in this document.

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** Regional REST API + Cognito authorizer + streaming Lambda + DynamoDB reserve/refund + ports-and-adapters desktop routing all interoperate with no version or capability conflict. The one deliberate divergence from the entitlements-feature precedent — automated CI/CD instead of manual `sam deploy` — is explicitly justified (explicit user requirement) rather than left unexplained, matching the bar `architecture-entitlements-licensing.md` set for its own Lambda-logging divergence.

**Pattern Consistency:** Every naming/error/structure pattern extends an existing convention (`AppError`, `credentials.rs` sole-accessor, `queryKeys`, `apps/*` top-level services, Vitest co-location) — nothing here is a parallel convention.

**Structure Alignment:** The directory delta introduces exactly one new top-level app (`apps/api-bedrock`) and one new shared-types file, and modifies desktop files only inside their existing `ai/`, `commands/`, `hooks/`, `lib/` homes.

### Requirements Coverage Validation ✅

All 5 FRs map to specific files in the Requirements-to-Structure table. All 5 NFRs are addressed structurally: NFR1 by the fallback/typed-error boundary, NFR2 by IAM-role-only Bedrock access, NFR3 by content statelessness, NFR4 by the dual quota+token-ceiling control, NFR5 by the enforcement guidelines above.

### Implementation Readiness Validation ✅

**Decision Completeness:** every critical decision — region, model, transport, auth scope, quota semantics, table shape, provider precedence, CI posture — carries a concrete value, not a placeholder. No "TBD" remains anywhere in this document.
**Structure Completeness:** every new/modified file has a defined location and role.
**Pattern Completeness:** all naming/error/logging/structure conflict points have an explicit resolution.

### Gap Analysis Results

**Critical Gaps:** None — nothing here blocks starting implementation.

**Important Gaps (non-blocking, resolve during implementation):**
- Whether `api.nixusapp.com`'s Route53 hosted zone/ACM certificate already exist needs verifying against the live AWS account before the SAM template's custom-domain parameters are wired in — if absent, ship on the default execute-api URL for v1 and add the custom domain later without changing any route contract.
- Whether a suitable seam already exists in the live `ai/` module for the `AiBackend` port, or whether it needs to be introduced fresh, should be confirmed by reading the current code at implementation time rather than assumed from this document alone.

**Nice-to-Have Gaps:**
- A CloudWatch alarm on elevated `hosted_unavailable`/`quota_exhausted` rates would help catch either a Bedrock outage or an underscoped quota default early — not required for v1.

### Architecture Readiness Assessment

**Overall Status:** DRAFT — READY FOR IMPLEMENTATION PENDING REVIEWER GATE
**Confidence Level:** High — every critical decision was made in coaching with the user and is carried here with a concrete value; the two Important Gaps are implementation-time verifications, not open architectural questions.

### Implementation Handoff

**AI Agent Guidelines:**
- Follow this document and its companion spine exactly; where the two overlap, the spine's `AD` wording is the enforceable statement and this document is the reasoning behind it.
- Never conflate this feature's `premium` flag with any Keygen/LemonSqueezy entitlement — they share no code, no table, no concept.
- Refer to `architecture-login.md`'s loopback amendment for the current OAuth callback shape; it is unrelated to this feature and unaffected by it.

**First Implementation Priority:**
`sam init --runtime nodejs22.x --architecture arm64 --name nixus-bedrock-api --app-template hello-world --package-type Zip` inside `apps/api-bedrock/`, immediately followed by drafting `packages/shared/src/types/cloud-ai.ts` — every other component (Lambda handlers, the desktop `AiBackend` retrofit) depends on that contract existing first.
