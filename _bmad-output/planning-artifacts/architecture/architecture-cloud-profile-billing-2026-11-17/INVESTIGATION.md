---
title: 'Cloud Profile & Billing — Investigation Baseline'
date: 2026-11-17
status: input-to-architecture
feeds: ARCHITECTURE-SPINE.md (this folder, not yet drafted)
---

# Cloud Profile & Billing — Investigation Baseline

Goal: move the user profile into the cloud so it can be managed from the desktop app and a new web account page. That is the foundation for managing subscriptions and payments on both the web and the app.

## 1. What exists today

| Area | Current state | Key files |
|---|---|---|
| Profile data | Local JSON per Cognito `sub` at `app_data_dir/profiles/<sub>.json` (schema v1): first/last name, `birth_date`, `income_bracket` + currency, `country_code`, `subdivision_code`. Validated in Rust against bundled ISO 3166 data. | `src-tauri/src/profile_store.rs`, `commands/profile.rs`, `hooks/useProfile.ts`, `routes/profile.tsx` |
| Avatar | Separate SQLite file `profiles/avatars.db`, one row per `sub`, 256px / 64 KiB derivative only | `src-tauri/src/avatar_store.rs` |
| Profile lifecycle | Independent of datasets. Excluded from backups **and from multi-device sync** (sync spine *Deferred*: "needs a separate decision and mechanism"). Removed by delete-all. | `sync/host.rs::wipe_local`, `commands/danger_zone.rs` |
| Identity | Cognito pool `us-east-1_7gfGQ0emg`, domain `auth.nixusapp.com`, **configured by hand in the console (no IaC)**. Only one app client: the desktop public PKCE client with loopback redirect `http://127.0.0.1:52847/callback`. No web client, no groups, Google sign-in deferred. | `commands/auth.rs`, story 26-1 |
| Subject handling | `current_subject()` resolves `sub` in Rust and it never crosses IPC. `AuthState` has no premium or profile fields. | `commands/auth.rs`, `commands/datasets.rs::is_signed_in` |
| Cloud API | `api.nixusapp.com` = stack `nixus-bedrock-api`: REST API with a Cognito authorizer (scope `nixus-api/ai.invoke`), one streaming Lambda, and `HostedAiTable` (`USER#<sub>/CONFIG` holds `premium` and `monthly_request_limit`). | `apps/api-bedrock/template.yaml`, `src/lib/table.ts` |
| Premium / entitlement | Premium is granted **manually** with `aws dynamodb put-item` (runbook). The desktop reads it from `GET /v1/ai/status`. `entitlements.rs` maps that one boolean onto `MULTI_DEVICE_SYNC`. The only IPC is `get_cloud_ai_premium() -> bool`. | `ai/hosted_bedrock.rs`, `ai/hosted_state.rs`, `entitlements.rs`, `docs/runbooks/hosted-ai-rollout.md` |
| Sync | S3 bucket plus a Cognito **identity pool**, scoped to `acct/<identity-id>/*`. No compute. Entitlement is enforced only on the client. | `infra/sync/template.yaml`, `sync/auth.rs`, `sync/gate.rs` |
| Web | Fully static, prerendered TanStack Start site on S3 `nixus-web-cdn` + CloudFront `E39FCWVISAOWBF`. No auth, no server runtime. `/account`, `/account/billing`, `/pricing` and `/login` were planned in `architecture-web.md` but never built. | `apps/web`, `.github/workflows/web-ci.yml` |
| Shared contracts | `packages/shared/src/types/cloud-ai.ts` is the canonical snake_case wire contract. `api-error.ts` looks legacy and unused. | `packages/shared/src/types/` |
| Payments / licensing | **None implemented.** `architecture-entitlements-licensing.md` (LemonSqueezy + Keygen) exists only as a plan. | — |

## 2. Findings that change prior plans

1. **LemonSqueezy is not an option.** It no longer accepts sign-ups and shuts down on 2027-03-31. Its successor is **Stripe Managed Payments** (Stripe acts as merchant of record, Canadian sellers are supported, +3.5% on top of standard Stripe fees). The provider decision in `architecture-entitlements-licensing.md` is therefore invalid, and this run supersedes it.
2. **The profile was deliberately designed to stay on the device** (`architecture-user-profile.md` NFR2: "No profile data leaves the machine"). Moving name, date of birth and income bracket to the cloud reverses a recorded decision. The README, Privacy Policy and Terms must change with it, as they did for hosted AI (Bedrock AD-13) and sync.
3. **The website has no way to sign anyone in.** A web profile page needs a new Cognito app client with web redirect URIs, and a decision on where tokens live (in the browser or on a server).
4. **Entitlements are hand-edited database records.** Billing needs one authoritative entitlement record per `sub`, written by payment webhooks and read by hosted AI, sync and the desktop. Otherwise there will be two sources of "is this user premium".
5. **Profile data has no server today.** Hosted AI goes through `api.nixusapp.com` and sync talks to S3 directly. A profile API is a new backend surface. The Bedrock invariants (one Lambda, streaming, closed operation set) argue for a **separate stack**, not for adding profile routes to `nixus-bedrock-api`.
6. **Mobile store rules limit what "manage your subscription in the app" can mean.** Nixus is not a "reader app" on iOS. Linking out to an external purchase page without a commission is US-only, rests on a court order, and that order is under Supreme Court review in the 2026 term. Google's programs are also region-specific and charge fees. Desktop (direct distribution) has no such constraint.

## 3. Payment-provider facts (verified 2026-11-17)

| Option | Model | Cost | Notes |
|---|---|---|---|
| Stripe Managed Payments | Stripe is merchant of record (handles tax) | Stripe fees + 3.5% | Canada supported; SaaS/software eligible; customers manage subscriptions through Link; standard Stripe webhooks; can be enabled per product or market |
| Stripe Billing + Stripe Tax | Nixus is merchant of record | Stripe fees + Tax | Mature Customer Portal and Checkout. Nixus must handle GST/HST, US state and EU VAT registration and filing itself (EU VAT applies from the first sale). |
| Paddle | Paddle is merchant of record | 5% + $0.50 | `custom_data` carries over to renewals automatically |
| RevenueCat (mobile, later) | Entitlement layer across App Store and Play | Free under $2.5k monthly tracked revenue, then 1% | `appUserID` = Cognito `sub`; the web-billing (Stripe) integration was not confirmed during this research |

Linking a payment customer to `sub`: Stripe `client_reference_id` / `metadata.cognito_sub`, Paddle `custom_data`, RevenueCat `appUserID`. Webhook signatures must always be verified.

## 4. Decisions needed (forks)

| # | Fork | Options | Leaning |
|---|---|---|---|
| F1 | Where the profile is stored | (a) New Profile API with a DynamoDB item per `sub`; (b) S3 object through the sync identity pool | **(a)** — the web can use it with a normal bearer token, no identity pool needed in a browser; the 64 KiB avatar fits in a DynamoDB item |
| F2 | Source of truth | (a) Cloud is authoritative, desktop keeps a local read cache, edits need a connection; (b) local-first, changes pushed later with merge | **(a)** — edits are rare and come from several surfaces; avoids a second merge engine |
| F3 | Who gets a cloud profile | Every signed-in account vs premium only | **Every account** — the profile is identity, not a premium feature |
| F4 | Web account surface | (a) Browser-side PKCE app calling `api.nixusapp.com`; (b) server-side backend with an httpOnly session cookie | Needs a decision — (b) is safer for billing pages but adds the site's first server runtime |
| F5 | Payment provider | Stripe Managed Payments vs Stripe Billing + Tax vs Paddle | **Stripe Managed Payments** (merchant of record, Canada supported, direct LemonSqueezy successor) |
| F6 | Entitlement authority | One `ENTITLEMENT` record per `sub`, written only by billing webhooks plus an admin override, read by every consumer; is Keygen dropped? | One record; **drop Keygen** — the app already checks online and can cache status for an offline grace period |
| F7 | Service topology | New stack (e.g. `apps/api-account`) served under the same `api.nixusapp.com` domain via base-path mapping vs extending `nixus-bedrock-api` | **New stack**, same domain (base-path coexistence still to be verified) |
| F8 | Mobile purchases | Show status and link to the web vs in-app purchase via RevenueCat | Defer; design the entitlement record so it can accept App Store and Play as sources |
| F9 | Migrating existing local profiles | On first signed-in launch, upload local data if the cloud has none; if both exist, cloud wins | Cloud wins; keep the local file as a `.bak` |
| F10 | Privacy and legal | README, Privacy Policy and Terms updated before rollout (as Bedrock AD-13 required) | Required gate |

## 5. Proposed implementation sequence (draft, before the fork decisions)

1. **Identity groundwork:** bring the Cognito pool under IaC (or document it as a managed exception); add a web app client and a `nixus-api/profile` scope.
2. **Account API stack:** SAM stack, REST API + Cognito authorizer, DynamoDB `USER#<sub>/PROFILE` (+ avatar), `GET/PUT /v1/profile`, wire contract in `packages/shared/src/types/account.ts`, GitHub OIDC CI.
3. **Desktop cutover:** `profile_store.rs` becomes a cache in front of the API; one-time migration of local data; offline read path; privacy copy.
4. **Web account page:** login, `/account` profile view and edit (EN/FR).
5. **Entitlement authority:** `USER#<sub>/ENTITLEMENT` record; hosted AI, sync and the desktop all read it; the manual put-item runbook is replaced by an admin path.
6. **Billing:** Stripe Managed Payments checkout from `/pricing`, webhook Lambda writing the entitlement record, customer-portal link from the web and desktop.
7. **Mobile (later):** RevenueCat or link-out, depending on store rules at that time.
