---
title: 'Implementation Plan — Nixus Cloud Billing & Entitlements'
date: 2026-11-18
spine: ARCHITECTURE-SPINE.md
status: final
---

# Implementation Plan — Nixus Cloud Billing & Entitlements

The binding rules are in [ARCHITECTURE-SPINE.md](ARCHITECTURE-SPINE.md) (AD-1 to AD-18). This plan orders the work. The next step is `bmad-create-epics-and-stories`, which turns each epic below into stories.

Two properties shape the order and are worth stating once: **the capability model lands before anything charges money**, and **`HostedAiTable.premium` is retired last** (AD-17), because `quota.ts` carries a live `ConditionCheck` on it that would fail hosted AI closed for every hand-granted user the moment it disappears.

## Order

```
Phase 0 ──► A ──┬─► B ──► C ──┬─► E ──► G ──► H
                │             ├─► F ──┘
                └─► D ────────┘
```

- A (contract) gates everything; nothing else may define a capability name.
- B (billing stack) and D (Stripe catalog setup) are independent once A exists.
- C (entitlement authority + webhook) needs B and D.
- E (desktop) and F (web surfaces) run in parallel once C serves entitlements.
- G is the cutover (AD-17) and is strictly ordered within itself.
- H retires `premium` and closes the rollout. It is last by design.

## Phase 0 — Prerequisites (owner, one-time)

- **Stripe account:** enable Managed Payments; confirm eligibility for a Canadian business location and the SaaS tax code; record the merchant-of-record and tax-remittance scope. Budget the **full 3.5%** — there is no LemonSqueezy account, so the 1.5% migration rate does not apply.
- **Cognito:** add `nixus-api/billing` to the `nixus-api` resource server by reading the current scopes (`DescribeResourceServer`), merging, and submitting the full list. Confirm `ai.invoke`, `profile` and `billing` all exist. Add it to `COGNITO_SCOPES` so clients request the full set (profile AD-9).
- **SSM:** create the `SecureString` paths for the Stripe secret key and the webhook signing secret.
- **KMS:** create the asymmetric `ECC_NIST_P256` `SIGN_VERIFY` key with a `Retain` policy; export the public key for embedding.
- **OIDC:** write and apply the `nixus-billing` bootstrap from a workstation (no static keys).
- **Document hygiene (AD-16):** land supersession notes in the ten planning documents still naming LemonSqueezy or Keygen, and **rewrite the codebase-grep acceptance criteria in `27-4-auth-e2e-coverage-and-licensing-independence-amendment.md` before any billing code exists**, so they do not fail on arrival.
- **Exit:** all three scopes verified, secrets and key in place, bootstrap role exists, stale docs annotated.

## Epic A — Shared contract and the capability union

- **Contract:** create `packages/shared/src/types/billing.ts` — plan catalog, entitlement response, statement claims, the **closed capability union** (`multi_device_sync`, `hosted_ai`, `household_net_worth`), and the closed error union including `premium_required`, `promotion_invalid` and `checkout_in_progress` (AD-13).
- **Rust mirror:** the same union and statement claims in `entitlements.rs`, with a parity test both ways.
- **Deletion, not extension:** `PREMIUM_CLOUD_CAPABILITIES` is removed; `entitlements.rs` keeps **no tier→capability table** and only parses received capability names (AD-1).
- **Guard:** a CI check that no file outside the capability-name parser compares a `tier` value, and that `PREMIUM_CLOUD_CAPABILITIES` no longer exists.
- **Depends on:** nothing.

## Epic B — Billing stack skeleton (`apps/api-billing`, stack `nixus-billing`)

- **SAM template:**
  - Regional REST API; Cognito authorizer requiring `nixus-api/billing` on `POST /checkout`, `POST /portal`, `GET /entitlement` and the admin route; **no authorizer** on `POST /webhook` and `GET /plans` (AD-3).
  - `ApiGatewayV2::ApiMapping` key `v1/billing`; domain referenced by name, never edited.
  - Billing table: `pk = USER#<sub>`, PITR, `Retain`, `EVENT#` TTL, GSI on `stripe_customer_id` (AD-4).
  - Method-level throttles on the two unauthenticated routes; **reserved concurrency** on the Lambda (AD-15).
  - Log groups with 14-day retention; 5xx, throttle, webhook-failure and metadata-malformed alarms; $10/month budget.
  - Every `GatewayResponses` type from AD-13.
  - Raw-body integrity configured so Stripe-signed bytes reach the Lambda unchanged (AD-5).
- **Lambda skeleton (Node 24, ARM64):** `functions/api.ts` dispatch; `lib/table.ts` as the **sole** key-composition module; `lib/stripe.ts` loading secrets from SSM at cold start with the **mode assertion** (AD-7); `lib/errors.ts`, `lib/validation.ts`, and `lib/logging.ts` built as a **single allow-list serializer** (AD-14).
- **CI:** `billing-ci.yml` — PR verify, deploy on `master` through `production`. No step prints or compares key material.
- **Gates:** IAM isolation in all three directions; scope tests; the unauthenticated route set matches AD-3 exactly; `GET /v1/ai/status` and `GET /v1/profile` still reach their stacks after deploy.
- **Depends on:** Phase 0, A.

## Epic C — Entitlement authority, webhook and statement

- **Catalog (`lib/catalog.ts`):** read Products and Prices by `lookup_key`; derive tier from `metadata.nixus_tier`; validate every capability name against A's union, dropping unknowns with a warning; **the malformed case yields a paid-but-capability-less entitlement plus an alarm** (AD-6). One TTL, declared here, honoured by every layer.
- **Derivation (`lib/entitlement.ts`):** Stripe subscription → `tier`, `capabilities[]`, `status`, `current_period_end`, `monthly_request_limit`.
- **Signing (`lib/signing.ts`):** KMS sign-only; `exp = now + 24 h`, clamped to `current_period_end` **only when one exists**; `key_id` emitted from day one (AD-9).
- **Webhook (`handlers/webhook.ts`):** timing-safe verification on the raw body within Stripe's tolerance window → `livemode` match → dedupe read → **re-fetch the subscription from Stripe** → sign → write `ENTITLEMENT` + `EVENT#` **in one transaction** → 2xx. A signing failure fails the event (AD-5).
- **Entitlement read (`handlers/entitlement.ts`):** return the stored statement; re-sign when remaining life is below half the window, persisting conditional on `version` and touching **cache attributes only** (AD-9). Absent record → signed `free` statement, rate-limited per `sub`. Refuse clients below the minimum version.
- **Admin override (`handlers/admin.ts`):** authenticated route with `source = admin`, `admin_expires_at` and a reason; ranked above a converging webhook (AD-2). Replaces `docs/runbooks/hosted-ai-rollout.md` §3.2.
- **Gates:** every item under AD-16's *Webhook correctness* and *Statement correctness*, plus the log-serializer test.
- **Depends on:** B, D.

## Epic D — Stripe catalog and operability (Dashboard, no code)

- Create Products for `classic` and `advance` with `metadata.nixus_tier` and their capability lists; monthly CAD Prices with `lookup_key`s `classic_monthly_cad` and `advance_monthly_cad`; `monthly_request_limit` in metadata.
- Configure the Customer Portal: cancel, payment-method update, and plan switching; dunning/smart-retry schedule (this is the only grace period — none is hard-coded, AD-11).
- Create one test promotion code.
- **Sandbox verification (AD-16):** confirm `allow_promotion_codes`, `discounts[]` and `subscription_data.metadata` behave as assumed under Managed Payments — the spine relies on their *absence* from Stripe's removed-parameter lists, not an affirmative doc statement. Also verify the portal's switch-plan tax recalculation.
- **Operability proof:** change a price with `transfer_lookup_key: true` and confirm the advertised and charged price both move with no deploy, within the catalog TTL.
- **Depends on:** Phase 0.

## Epic E — Desktop: statement verification and capability gating

- **Billing client:** one new network module, added to the `cloud_link.rs` allowlist; release builds hard-code `https://api.nixusapp.com` (AD-7).
- **Statement cache:** on-disk cached statement plus a monotonic **`iat` high-water mark**; offline verification against the **embedded trusted-key set** with `not_after`; expired, tampered, wrong-`sub`, unknown-`key_id` or past-`not_after` grants nothing (AD-9).
- **`entitlements.rs`:** capability-name parsing and statement verification replace `from_cloud_entitlement(bool)`; nothing in `sync/**` changes (sync AD-14).
- **Hosted AI:** `classify_status` stops reading a `premium` boolean; `HostedEligibility::NotPremium` becomes capability-derived; `home_surface::authorize`'s message stops saying "premium" (AD-12). `CloudAiOperation` stays closed at four operations.
- **Relink trigger:** the sync host decides from **durable sync state** — the recorded freeze and last published position — whether re-entitlement needs a relink. A cleared cache is never evidence of a lapse, so an ordinary sign-in can never raise the destructive publish-over-cloud prompt (AD-11).
- **Copy:** EN/FR for every refusal surface, naming the capability and routing free and Classic accounts to an upgrade.
- **Gates:** AD-16's *Tier model* and *Statement correctness* items; a Classic entitlement refused by hosted AI and accepted by sync; a BYO-credentials user on every tier reaching every AI surface.
- **Depends on:** C.

## Epic F — Web surfaces: pricing, checkout and portal

- **`GET /plans` consumer:** `apps/web` `/pricing` ships baked EN/FR fallback copy and hydrates over the live catalog, so a price change needs no rebuild (AD-6). Four columns: Local, Free, Classic, Advance.
- **Copy (AD-16):** CAD list price, shown in the visitor's currency at checkout, **tax included** — never "taxes extra". "Nixus Cloud" untranslated in French.
- **Account app:** `/billing` showing tier and status with portal and upgrade links; `/checkout/complete`; `/fr/*` equivalents with the locale parity test. The BFF calls the billing API with the user's access token and holds **no** Stripe credential (AD-7).
- **Checkout:** `POST /checkout` with the `checkout_lock`, catalog-validated `plan_lookup_key`, optional promo, `client_reference_id` + `subscription_data.metadata`, and a Stripe idempotency key for customer creation (AD-8, AD-18). An account with a live subscription is routed to the portal instead.
- **Desktop entry points:** upgrade and manage open the returned URL in the **system browser**, never the webview.
- **Gates:** cross-account test (A cannot open B's portal or checkout); concurrent-checkout test; promo-code applied with no deploy; invalid code returns `promotion_invalid` and is not echoed.
- **Depends on:** C.

## Epic G — Cutover (AD-17, strictly ordered)

1. Deploy `nixus-billing` with no traffic (table, Lambda, KMS).
2. Run `scripts/backfill-entitlements.ts`: every `USER#<sub>/CONFIG` with `premium = true` becomes an `ENTITLEMENT` with the **Advance** capability set, `source = admin`, no Stripe customer. Idempotent and re-runnable.
3. Cut `nixus-bedrock-api` over to the AD-4 canonical read, in a release that **still tolerates** the old attribute. It learns the billing table by a **deploy-time parameter**, never a CloudFormation export.
4. Ship the desktop release (E). Older clients keep working: `GET /v1/ai/status` serves a `premium`-shaped answer derived from the authority for one deprecation window.
5. Legal and disclosure gate — Terms name **Stripe as seller of record**; the Privacy Policy states no card data is stored and names Stripe; `README.md` and the `apps/web` locales stop saying billing does not exist. **Before the first live charge.**
6. Enable live mode.
- **Gate:** every hand-granted premium user retains hosted AI, proven against a copy of production data **before** the switch. Rollback for steps 1–4 is reverting the bedrock read, with no data loss.
- **Depends on:** E, F.

## Epic H — Retire `HostedAiTable.premium`

- Remove `premium` and its `ConditionCheck` from `apps/api-bedrock/src/lib/{table,quota}.ts`; `HostedAiTable` keeps counted usage and the `GLOBAL` kill switch only (AD-2).
- Remove the `premium`-shaped compatibility answer from `GET /v1/ai/status` once the deprecation window closes.
- Close `docs/runbooks/hosted-ai-rollout.md` §3.2 in favour of the admin route; write the billing operations runbook (catalog TTL, override procedure, alarm response, duplicate-subscription reconciliation).
- **Last by design:** after this, rollback is a forward fix, which is why it is gated on G's cutover test.
- **Depends on:** G.

## Out of scope

Everything under the spine's *Deferred*, most immediately: identity-pool credential denial for sync (AD-10's defence in depth, needs a coordinated `infra/sync/template.yaml` change), mobile purchases, annual prices, tier N+1's software capability, an admin UI, account deletion and the erasure path, and metered pricing.
