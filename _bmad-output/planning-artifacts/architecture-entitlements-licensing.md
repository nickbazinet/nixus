---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-08-01'
inputDocuments:
  - architecture.md
  - architecture-desktop.md
  - architecture-web.md
  - architecture-credentials.md
  - product-brief-nixus-marketing-site-2026-04-25.md
  - prd.md
  - docs/project-context.md
workflowType: 'architecture'
project_name: 'nkbaz-finance'
user_name: 'dev'
date: '2026-08-01'
feature: 'entitlements-licensing'
parentArchitecture: 'architecture.md'
supersedes: 'architecture.md licensing/subscription section (Cognito + DynamoDB + Stripe + Stronghold) — never implemented'
---

# Architecture Decision Document — Entitlements & Module Licensing

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

**Supersedes:** The user-accounts / licensing / subscription section of [architecture.md](architecture.md) (April 2026, "READY FOR IMPLEMENTATION" but never built — Cognito, DynamoDB Users/Licenses/Subscriptions tables, Rust Lambda API, Stripe Checkout/Portal/webhooks, Stronghold-cached desktop license check). That design is retained in `architecture.md` for historical record but is no longer the source of truth for licensing/payments once this document reaches "complete" status.

**Related documents:**
- [Platform Architecture](architecture.md) — monorepo structure, cross-module decisions (superseded section noted above)
- [Desktop App](architecture-desktop.md) — sidebar, command registration, AppError pattern this feature hooks into
- [Web App](architecture-web.md) — marketing site; this feature delivers the deferred `/pricing` + checkout capability
- [Credential Management](architecture-credentials.md) — `keyring` crate pattern reused for cached license storage instead of Stronghold

_Sections are appended as the workflow proceeds through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
- FR1: Sell Nixus via hosted checkout (LemonSqueezy) supporting lifetime (one-time) and monthly/yearly (recurring) plans
- FR2: Gate individual feature modules (Finance, Car, future modules) independently based on purchase/subscription (per-module entitlements)
- FR3: Validate license/entitlement state on the desktop app while offline (local-first constraint)
- FR4: Sync entitlement changes (purchase, renewal, cancellation, refund) from LemonSqueezy into desktop licensing state via webhook bridge
- FR5: Customers self-serve manage/cancel their own subscription (LemonSqueezy customer portal)
- FR6: New `/pricing` presence on the existing `apps/web` marketing site driving to checkout

**Non-Functional Requirements:**
- NFR1 — Local-first: app must not be blocked from launch or entitled-module use by lack of network
- NFR2 — Low ops burden: solo indie dev, pre-alpha; minimize new infrastructure (buy over build for licensing)
- NFR3 — Security: license/entitlement checks must resist trivial tampering (cryptographically signed license data)
- NFR4 — Cost at low scale: near-zero cost until meaningful user growth (Keygen free ≤100 ALU, LemonSqueezy no monthly fee)
- NFR5 — Consistency: must follow existing `AppError`, `keyring`, Tauri IPC, TanStack Query/Router conventions — no parallel patterns

**Scale & Complexity:**
- Primary domain: Desktop (Tauri/Rust/React) + minimal cloud webhook-bridge service
- Complexity level: Medium
- Estimated architectural components: 4 — (1) LemonSqueezy product/webhook config, (2) Lambda webhook-bridge, (3) Keygen entitlement/license model, (4) desktop license client + module registry + gating

### Technical Constraints & Dependencies

- Reuse existing `keyring`/`credentials.rs` pattern for local secret storage — do not introduce Stronghold (superseding the abandoned `architecture.md` plan)
- New error cases must extend the existing `AppError` enum (e.g., `NotEntitled`) per `docs/project-context.md` rule #5
- `AppSidebar.tsx` and Tauri command registration in `lib.rs` currently have zero gating mechanism — this feature introduces the first one
- `apps/web` is static-only today (no server functions in use); `/pricing` needs only a new route + outbound link, no new backend capability
- The webhook-bridge Lambda is Nixus's first cloud-hosted compute component — needs its own deploy pipeline, separate from the app's 3-file version-bump release process

### Cross-Cutting Concerns Identified

- Offline-first licensing (affects desktop client design end-to-end)
- Error-handling consistency (`AppError::NotEntitled` should support graceful degradation, mirroring the existing AI-service `recoverable: bool` pattern)
- i18n for any new UI (pricing page, upgrade prompts, license status) via i18next
- Open decision: should license/entitlement state changes write to `audit_db`, consistent with the existing "every mutation is audited" rule?
- New Lambda service needs its own versioning/deploy process, distinct from desktop app releases

## Starter Template Evaluation

### Primary Technology Domain

Brownfield addition — no starter needed for `apps/desktop` or `apps/web` (existing conventions apply per `docs/project-context.md`). One net-new component: the LemonSqueezy → Keygen webhook-bridge.

### Starter Options Considered

**Rust via `cargo-lambda`** (v1.9.1) — native cross-compile via Zig, `cargo lambda new --http`, shares language with `src-tauri`, but adds a second Rust cloud-deploy toolchain for a non-performance-sensitive function.

**TypeScript + AWS SAM** (Node.js 22, ARM64) — mature Lambda tooling, official LemonSqueezy webhook SDK available, reuses existing TypeScript skills, simplest IaC (`template.yaml` + `sam deploy --guided`) for a single-function service.

### Selected Starter: AWS SAM (TypeScript, Node.js 22, ARM64)

**Rationale for Selection:**
The webhook bridge is I/O-bound (signature verification + REST calls), not performance-critical, so Rust's main advantage is moot. TypeScript avoids a second cloud-deploy toolchain, reuses skills already used daily in both apps, and SAM is the lowest-ceremony IaC option for a single function — consistent with NFR2 (minimize new infrastructure for a solo indie dev).

**Initialization Command:**

```bash
sam init --runtime nodejs22.x --architecture arm64 --name nixus-licensing-bridge --app-template hello-world --package-type Zip
```

**Architectural Decisions Provided by Starter:**

**Language & Runtime:** TypeScript on Node.js 22 (ARM64 for cost efficiency)
**Styling Solution:** N/A (backend-only)
**Build Tooling:** `sam build` (esbuild under the hood for TS)
**Testing Framework:** Vitest (added manually — SAM's default template doesn't include it)
**Code Organization:** `src/functions/` per webhook route (e.g., `subscription-created.ts`, `subscription-cancelled.ts`), `src/lib/keygen-client.ts`, `src/lib/lemonsqueezy-verify.ts`
**Development Experience:** `sam local invoke` / `sam local start-api` for local testing without deploying

**Note:** Project initialization using this command should be the first implementation story for this feature.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Payment provider: LemonSqueezy (billing + tax MoR)
- Entitlement layer: Keygen (per-module entitlements, offline-signed licenses)
- Webhook-bridge runtime: TypeScript + AWS SAM (Node.js 22, ARM64)
- Local secret storage: reuse existing `keyring`/`credentials.rs` pattern (no Stronghold)

**Important Decisions (Shape Architecture):**
- Offline grace window: 7 days
- Entitlement-check granularity: command-layer helper + frontend hook, two enforcement points
- Secrets management: AWS SSM Parameter Store (SecureString)
- Webhook idempotency: `(event_name, resource_id, updated_at)` as idempotency key
- Locked-module UX: soft lock (visible + `UpgradePrompt`, not hidden/redirected)

**Deferred Decisions (Post-MVP):**
- Dedicated CI/CD pipeline for the webhook bridge — manual `sam deploy` until change frequency justifies automation
- Keygen sandbox/prod environment separation — interim second free-tier account until revenue justifies the Enterprise tier

### Data Architecture

- **Source of truth split:** LemonSqueezy = billing source of truth; Keygen = entitlement source of truth. The bridge syncs one-directionally: LemonSqueezy event → Keygen license update.
- **Local cache:** the signed license/machine file (opaque blob from `keygen-rs`) is stored via the existing OS-keychain `keyring`/`credentials.rs` pattern — no Stronghold. Non-secret display data (plan name, expiry, entitlements list) is cached in the existing SQLite `config` table, mirroring the AI-credentials precedent exactly (secret in keyring, metadata in SQLite).
- **Validation:** entitlement strings validated against a shared `ModuleId` enum (`"finance" | "car" | ...`); unknown/future values are ignored gracefully for forward compatibility.
- **Offline grace window:** `keygen-rs` validates offline on every launch (instant, no network); re-validates online opportunistically. If online validation fails but the last successful check is within **7 days**, entitled modules stay unlocked (reviving the old plan's grace-period number as a sensible default). Past 7 days, modules lock until reconnected.

### Authentication & Security

- No traditional login. "Account" = an email known to LemonSqueezy + a Keygen license/machine activation — no login form anywhere in the desktop app.
- **Authorization, two layers:**
  1. Rust: a `require_entitlement(state, "car")?` helper at the top of each command in a module's group, returning a new `AppError::NotEntitled { module }` variant (extends the existing enum).
  2. Frontend: a shared `useEntitlements()` hook (backed by a new `get_license_status` command) drives sidebar visibility and route guards.
- **Webhook security:** Lambda verifies LemonSqueezy's `X-Signature` header via HMAC-SHA256 over the **raw** request body (confirmed against current LemonSqueezy docs) — API Gateway must pass the raw body through unparsed.
- **Secrets:** Keygen Admin API token + LemonSqueezy webhook signing secret in **AWS SSM Parameter Store (SecureString)** — cheaper than Secrets Manager for one function with two secrets.
- License file is already Ed25519-signed by Keygen and stored in the OS-encrypted keychain — no extra app-level encryption needed.

### API & Communication Patterns

- Inbound events handled: `order_created` (lifetime), `subscription_created/updated/cancelled/expired/resumed`.
- **Idempotency:** treat `(event_name, resource_id, updated_at)` as the idempotency key and upsert — LemonSqueezy retries webhook delivery like Shopify does.
- Outbound: bridge → Keygen Admin API only for provisioning (create/update/suspend license + entitlements). Desktop talks to Keygen **directly** via `keygen-rs` 0.11.1 for activation/validation — the bridge is not a proxy for every license check.
- Lambda returns `200` after logging internal errors (stops retry storms) but non-2xx specifically on signature-verification failure.
- Default API Gateway throttling is sufficient at this volume — no custom rate limiting needed yet.

### Frontend Architecture

- `useLicenseStatus()` (TanStack Query, `["license", "status"]` in `queryKeys`) wraps `get_license_status`; `useEntitlement(moduleId)` derives per-module checks — follows the existing one-file-per-feature hooks convention.
- New `components/licensing/`: an `UpgradePrompt` shown in place of locked route content, and a `LicenseStatus` panel in Settings with a "Manage Subscription" link opening the LemonSqueezy customer portal via Tauri's shell/opener.
- **Locked-module UX — soft lock**: locked modules stay visible in the sidebar (so users know they exist) and render an `UpgradePrompt` instead of redirecting away, rather than hiding/hard-blocking navigation. Better for conversion; revisitable once real UX input exists for this feature.
- Entitlement check runs synchronously against the cached signed file at launch — never blocks first paint, matching the existing "never block launch on service errors" principle.

### Infrastructure & Deployment

- AWS Lambda (Node.js 22, ARM64) + API Gateway HTTP API, deployed via AWS SAM.
- Region: same region as existing Bedrock usage, to keep one region to reason about.
- **CI/CD:** manual `sam deploy` for now — a dedicated pipeline is deferred until change frequency justifies it (NFR2, low ops burden pre-alpha).
- Monitoring: default CloudWatch Logs; no APM needed at this volume.
- **Open item — environments:** LemonSqueezy has a test mode, but Keygen's environment separation is an Enterprise-tier feature. Interim approach: a second free-tier Keygen account for testing until revenue justifies upgrading.

### Decision Impact Analysis

**Implementation sequence:**
1. Keygen account + policies/entitlements (`finance`, `car`) configured
2. LemonSqueezy store + products/variants + webhook configured
3. Webhook-bridge service (`sam init`) — signature verification, event handlers, Keygen Admin API client
4. Desktop: `keygen-rs` + `tauri-plugin-keygen-rs2`, extended `AppError`, `get_license_status` command, module registry
5. Frontend: hooks, `UpgradePrompt`, Settings license panel, sidebar gating
6. `apps/web`: new `/pricing` route linking to LemonSqueezy checkout

**Cross-component dependency:** the module registry (step 4) and frontend gating (step 5) both depend on one shared `ModuleId` enum — define it once in `packages/shared` (TS) with a mirrored Rust enum, not duplicated across three places.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical conflict points identified:** 6 — Rust command/error naming, frontend hook/component naming, shared `ModuleId` placement, webhook-bridge file/dispatch structure (no existing precedent), local cache storage format, and logging strategy across the Rust/Node boundary.

### Naming Patterns

**Rust (desktop backend) — follows existing `docs/project-context.md` rules exactly, no new conventions:**
- Commands: `get_license_status`, `activate_license`, `deactivate_license`, `refresh_license` — snake_case, registered in `lib.rs`
- Files: `commands/license.rs`, `db/license.rs` (if persisted state is needed beyond the keyring blob)
- Structs: `LicenseStatus`, `ModuleEntitlement` — PascalCase, `#[derive(Debug, Clone, Serialize, Deserialize)]`, snake_case fields
- New `AppError` variant: `AppError::NotEntitled { module: String }` → serializes as `{ "type": "not_entitled", "message": "...", "module": "car" }`, extending the existing discriminated-union shape (same pattern as `ai_service`'s ad hoc `recoverable` field)

**Frontend (desktop + shared):**
- Hooks: one file `hooks/useLicensing.ts` exporting `useLicenseStatus()`, `useEntitlement(moduleId)`, `useActivateLicense()` — per existing one-file-per-feature convention
- Components: `components/licensing/UpgradePrompt.tsx`, `components/licensing/LicenseStatusPanel.tsx`
- Query keys: `queryKeys.license.status` → `["license-status"]`, added to `lib/constants.ts`
- Shared type: `ModuleId` (`"finance" | "car" | ...`) lives in `packages/shared/src/types/modules.ts` — single definition consumed by desktop, web, and mirrored by a Rust enum, not duplicated three times

**Webhook-bridge (new domain — establishing fresh conventions):**
- **Single Lambda, internal dispatch** (not one Lambda per event type): `src/functions/webhook.ts` is the sole API Gateway integration; it verifies the signature, then dispatches on `X-Event-Name` to `src/lib/handlers/{event-name}.ts` (e.g., `order-created.ts`, `subscription-cancelled.ts`) — one deployable, one route, simplest IAM/API Gateway wiring for this volume
- Function/variable naming: camelCase (TS convention, matches `apps/desktop`/`apps/web`)
- Keygen client: `src/lib/keygen-client.ts`; signature verification: `src/lib/lemonsqueezy-verify.ts`

### Structure Patterns

- Webhook-bridge lives as a new top-level `apps/api-licensing/` — a genuinely separate deployable, not nested inside `apps/desktop` or `apps/web`, matching the monorepo's existing `apps/*` convention
- Bridge tests co-located (`webhook.ts` + `webhook.test.ts`), Vitest — matching `apps/web`'s co-location convention, not desktop's Playwright-only approach (this is a backend Node service)
- Desktop-side license Rust/TS files slot into the *existing* `commands/`, `db/`, `hooks/`, `components/{feature}/` structure — no new top-level folders in `apps/desktop`

### Format Patterns

- Webhook response body on success: `{ "received": true }` — minimal, no custom envelope (LemonSqueezy doesn't require one)
- Inbound webhook payload shape: LemonSqueezy's own JSON:API-ish format, unchanged — we don't reshape it before use
- Outbound to Keygen: Keygen's own JSON:API spec — again, not ours to redefine
- Desktop IPC: unchanged — still the existing `AppError` JSON envelope, snake_case args, ISO 8601 date strings (rule #4)
- Local cache format: entitlements + expiry + plan name stored as one JSON-serialized value under a single `config` key (e.g. `license_status_cache`) — no new SQLite table, consistent with "non-secret metadata in `config`" precedent

### Communication Patterns

- No internal event bus — webhook handling is a linear verify → dispatch → call Keygen → respond flow per invocation, appropriate at this volume
- Frontend state: license status flows through TanStack Query like every other Nixus data source — no separate global store introduced
- Logging: Lambda uses structured `console.log`/`console.error` JSON (`{ event, requestId, ... }`) for CloudWatch queryability. This is intentionally **not** unified with Rust's `tracing` crate — different runtime, no cross-boundary logging library requirement

### Process Patterns

- Rust: every new command still returns `Result<T, AppError>`, never panics — no exception to existing rule
- Lambda: try/catch wraps all processing; returns `200` after logging internal errors (avoids retry storms), `400` specifically on signature-verification failure
- Loading states: `useLicenseStatus()` follows the same `isLoading`/`isError` TanStack Query pattern as every other hook — no special-casing
- **Flagged, non-blocking:** the bridge doesn't retry failed Keygen calls in v1 (low volume, manual reconciliation acceptable) — but a failed provisioning call means a paying customer doesn't get their entitlement, so this failure path should log loudly enough to notice. Worth a CloudWatch alarm eventually; not required for MVP.

### Enforcement Guidelines

**All AI agents MUST:**
- Extend `AppError` rather than inventing a new error type for licensing
- Define `ModuleId` once in `packages/shared`, never re-declare it per app
- Keep the webhook-bridge as a single Lambda with internal dispatch, not one function per event

### Pattern Examples

**Good:** `AppError::NotEntitled { module: "car".into() }` → frontend catches it via the existing error-handling path, shows `UpgradePrompt` instead of a generic error toast.

**Anti-pattern to avoid:** creating a second `ApiError`/error shape for the bridge that doesn't resemble the desktop's `AppError` — keep the *shape* philosophy (typed, discriminated) consistent even though it's a different runtime.

## Project Structure & Boundaries

### Complete Project Directory Structure

```
nixus/
├── apps/
│   ├── desktop/                              # existing
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── licensing/                # NEW
│   │   │   │   │   ├── UpgradePrompt.tsx
│   │   │   │   │   └── LicenseStatusPanel.tsx
│   │   │   │   └── shared/
│   │   │   │       └── AppSidebar.tsx        # MODIFIED — gates nav via useEntitlement()
│   │   │   ├── hooks/
│   │   │   │   └── useLicensing.ts           # NEW — useLicenseStatus, useEntitlement, useActivateLicense
│   │   │   ├── lib/
│   │   │   │   ├── constants.ts              # MODIFIED — add queryKeys.license
│   │   │   │   └── types.ts                  # MODIFIED — add LicenseStatus, ModuleEntitlement
│   │   │   └── routes/
│   │   │       ├── car.tsx                   # MODIFIED — entitlement guard, soft-lock render
│   │   │       └── settings.tsx              # MODIFIED — mounts LicenseStatusPanel
│   │   └── src-tauri/
│   │       ├── Cargo.toml                    # MODIFIED — add keygen-rs, tauri-plugin-keygen-rs2
│   │       └── src/
│   │           ├── commands/
│   │           │   └── license.rs            # NEW — get_license_status, activate_license, deactivate_license, refresh_license
│   │           ├── models/mod.rs             # MODIFIED — add LicenseStatus, ModuleEntitlement
│   │           ├── error.rs                  # MODIFIED — add AppError::NotEntitled { module }
│   │           ├── credentials.rs            # MODIFIED — cache signed license blob under a new keyring key
│   │           └── lib.rs                    # MODIFIED — register new commands, init keygen-rs plugin
│   │
│   ├── web/                                  # existing, static-only today
│   │   └── src/
│   │       └── routes/
│   │           ├── pricing.tsx               # NEW — EN pricing page, LemonSqueezy checkout overlay
│   │           └── fr/
│   │               └── pricing.tsx           # NEW — FR pricing page
│   │
│   └── api-licensing/                        # NEW — Nixus's first cloud service
│       ├── package.json
│       ├── template.yaml                     # SAM template: API Gateway + Lambda + SSM param refs
│       ├── samconfig.toml
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── .env.example
│       └── src/
│           ├── functions/
│           │   ├── webhook.ts                # single Lambda entry point (API Gateway integration)
│           │   └── webhook.test.ts
│           └── lib/
│               ├── lemonsqueezy-verify.ts     # HMAC-SHA256 signature check
│               ├── keygen-client.ts           # Keygen Admin API wrapper
│               └── handlers/
│                   ├── order-created.ts
│                   ├── order-created.test.ts
│                   ├── subscription-created.ts
│                   ├── subscription-updated.ts
│                   ├── subscription-cancelled.ts
│                   ├── subscription-expired.ts
│                   ├── subscription-resumed.ts
│                   └── *.test.ts              # co-located per handler
│
└── packages/
    └── shared/                               # existing
        └── src/
            └── types/
                └── modules.ts                 # NEW — ModuleId union + module metadata (label, route prefix)
```

### Architectural Boundaries

**API Boundaries:**
- External inbound: LemonSqueezy → API Gateway → `POST /webhook` on `apps/api-licensing` — single public endpoint, HMAC signature is the only auth
- Bridge → Keygen: outbound-only REST (Admin API) for provisioning
- Desktop → Keygen: outbound-only REST (Licensing API via `keygen-rs`) for activation/validation — **the bridge is never in this path**
- Desktop internal: unchanged Tauri IPC boundary, same conventions as every other feature

**Component Boundaries:**
- `AppSidebar.tsx` and route loaders depend on `useEntitlement()` — one-way; neither owns entitlement logic itself
- `UpgradePrompt` is presentational only (takes `moduleId` prop, doesn't fetch) — data-fetching stays in hooks, matching existing convention

**Service Boundaries:**
- Three independently deployable units now exist: `apps/desktop` (ships to users), `apps/web` (static site), `apps/api-licensing` (AWS) — each keeps its own release process; none share a cadence

**Data Boundaries:**
- Desktop SQLite `config` table gains exactly one new key (`license_status_cache`) — no new table
- Keygen holds entitlement state; LemonSqueezy holds billing/customer state — **neither lives in Nixus's own database**, keeping customer PII entirely off Nixus's infrastructure

### Requirements to Structure Mapping

- FR1 (lifetime/subscription sale) → `apps/web/src/routes/pricing.tsx` + LemonSqueezy store config (dashboard, no code)
- FR2 (per-module gating) → `commands/license.rs`, `hooks/useLicensing.ts`, `components/licensing/`, `packages/shared/src/types/modules.ts`
- FR3 (offline validation) → `keygen-rs` integration in `lib.rs` + `credentials.rs` cache
- FR4 (entitlement sync) → `apps/api-licensing/src/lib/handlers/*`
- FR5 (self-serve subscription mgmt) → `LicenseStatusPanel.tsx` (link-out to LemonSqueezy portal, no new backend)
- FR6 (pricing/marketing) → `apps/web/src/routes/pricing.tsx` (+ `fr/` variant)

### Integration Points

**Internal Communication:** unchanged Tauri IPC for desktop; no new internal communication pattern introduced
**External Integrations:** LemonSqueezy (checkout, billing, webhooks), Keygen (licensing API), AWS (Lambda/API Gateway/SSM hosting the bridge)
**Data Flow:** customer buys via LemonSqueezy checkout overlay on `/pricing` → LemonSqueezy fires webhook → `apps/api-licensing` verifies + dispatches → Keygen Admin API updates the license/entitlements → next time the desktop app is online, `keygen-rs` refreshes the cached signed license → `get_license_status` reflects new entitlements → sidebar/routes unlock

### File Organization Patterns

**Configuration Files:** `apps/api-licensing/template.yaml` (SAM/CloudFormation) + `.env.example` for local `sam local` testing; real secrets live only in SSM, never committed
**Source Organization:** mirrors each app's existing convention — desktop keeps `commands/`/`models/`/`hooks/`/`components/{feature}/`; web keeps file-based routes; bridge introduces `functions/`/`lib/handlers/`
**Test Organization:** desktop gets one new Playwright E2E scenario for module-locked UI (no new test framework); bridge uses Vitest, co-located per handler
**Asset Organization:** no new static assets

### Development Workflow Integration

**Development Server Structure:** `sam local start-api` for local webhook testing; desktop/web dev servers unchanged
**Build Process Structure:** `sam build` for the bridge; desktop/web builds unchanged
**Deployment Structure:** bridge deployed independently via manual `sam deploy`; desktop follows the existing 3-file version-bump release process; web follows its existing deploy — all three release independently

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** LemonSqueezy (billing) + Keygen 0.11.1 (entitlements) + TypeScript/AWS SAM (bridge) + `keygen-rs`/`tauri-plugin-keygen-rs2` 0.11.1 (desktop, requires `tauri ^2.0.1` — satisfied by the existing `tauri 2.x` dependency) all interoperate with no version conflicts. No decision forces an incompatible pairing (e.g., we did not force Rust onto the I/O-bound bridge just for language consistency).

**Pattern Consistency:** New patterns (webhook-bridge naming/dispatch, `AppError::NotEntitled`) extend rather than replace existing conventions from `docs/project-context.md`. The one place we deliberately diverged — Lambda's `console.log` JSON logging instead of Rust's `tracing` — is justified by the runtime boundary, not left unexplained.

**Structure Alignment:** The directory tree respects existing app boundaries (`commands/`, `hooks/`, file-based routes) and introduces exactly one new top-level app (`apps/api-licensing`), consistent with the monorepo's existing `apps/*` pattern.

### Requirements Coverage Validation ✅

**Functional Requirements Coverage:** All 6 FRs (checkout/billing, per-module gating, offline validation, entitlement sync, self-serve management, pricing presence) map to specific files per the Requirements-to-Structure table in the previous section — no FR is unaddressed.

**Non-Functional Requirements Coverage:**
- NFR1 (local-first) → offline-signed license + 7-day grace window ✅
- NFR2 (low ops burden) → buy-don't-build licensing, manual deploy for v1, no Cognito/DynamoDB ✅
- NFR3 (tamper resistance) → Ed25519-signed Keygen license files ✅
- NFR4 (low cost at low scale) → Keygen free ≤100 ALU, LemonSqueezy no monthly fee, SSM over Secrets Manager ✅
- NFR5 (convention consistency) → `AppError`, `keyring`, hooks-per-feature, i18n all extended not replaced ✅

### Implementation Readiness Validation ✅

**Decision Completeness:** All critical decisions carry verified current versions (Keygen/`tauri-plugin-keygen-rs2` 0.11.1, Node.js 22 ARM64, LemonSqueezy's documented HMAC-SHA256 signature scheme).

**Structure Completeness:** Every new file has a defined location; every modified file is called out explicitly rather than left implicit.

**Pattern Completeness:** All 6 identified conflict points (naming, error shape, hook placement, `ModuleId` ownership, bridge dispatch structure, logging strategy) have an explicit resolution.

### Gap Analysis Results

**Critical Gaps:** None — nothing here blocks starting implementation.

**Important Gaps (non-blocking, resolve during implementation or before launch):**
- **Device/machine limit per license** (how many devices one license activates) is a pricing/product decision, not an architecture one — was flagged during planning and never resolved. Needs a decision before launch copy/pricing page goes live.
- Exact SQLite `config` table access pattern wasn't verified against the live `db/` code (I inferred a key-value shape from `architecture-credentials.md`'s description) — verify at implementation time before adding `license_status_cache`.
- AWS region for `apps/api-licensing` wasn't pinned to a specific value — pick one (e.g., matching wherever Bedrock calls currently originate) during bridge setup, story 1.
- The soft-lock UX pattern (locked modules visible + `UpgradePrompt`) was an architectural recommendation, not validated against a UX spec for this feature — revisit if/when one exists.

**Nice-to-Have Gaps:**
- No CloudWatch alarm on failed Keygen provisioning calls yet (flagged in Process Patterns) — worth adding once real customers exist.
- No dedicated CI/CD for the bridge yet — deliberately deferred (NFR2), revisit once deploy frequency increases.

### Validation Issues Addressed

No critical issues found requiring resolution before implementation. The Important Gaps above are explicitly carried forward as known open items rather than silently assumed — none require an architectural change, only a product decision (device limit) or an implementation-time verification (config table shape, region).

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Explicitly supersedes and corrects a stale, never-built plan (Cognito/DynamoDB/Stripe/Stronghold) rather than leaving two contradictory documents in the repo
- Every new pattern extends an existing, proven convention (`AppError`, `keyring`, hooks-per-feature) instead of inventing parallel ones
- Buy-don't-build call on licensing is grounded in a real cost/effort comparison, not assumed

**Areas for Future Enhancement:**
- Formalize device-limit and Keygen environment-separation decisions once there's real revenue to justify them
- Add CI/CD and alerting for the bridge once deploy/incident frequency justifies the investment
- Revisit the soft-lock UX decision if a dedicated UX pass is done for this feature

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented above
- Use implementation patterns consistently — especially `AppError::NotEntitled` and the single-Lambda dispatch structure
- Respect the three-service boundary (`apps/desktop`, `apps/web`, `apps/api-licensing`) — do not couple their release processes
- Refer to this document for all architectural questions on this feature; it supersedes the licensing/subscription section of `architecture.md`

**First Implementation Priority:**
`sam init --runtime nodejs22.x --architecture arm64 --name nixus-licensing-bridge --app-template hello-world --package-type Zip` — stand up the webhook-bridge skeleton first, since every other component depends on entitlements existing somewhere to check against.
