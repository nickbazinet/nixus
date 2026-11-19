---
title: 'Billing & Entitlements — Investigation Baseline'
date: 2026-11-18
status: final — ready to feed ARCHITECTURE-SPINE.md
feeds: ARCHITECTURE-SPINE.md (this folder, not yet drafted)
supersedes: '../../architecture-entitlements-licensing.md (provider + entitlement authority)'
sources:
  - '../architecture-cloud-profile-billing-2026-11-17/INVESTIGATION.md'
  - '../architecture-cloud-profile-billing-2026-11-17/ARCHITECTURE-SPINE.md (AD-3, AD-4, AD-10, AD-11, AD-12, AD-13, AD-14, AD-17, CAP-7, Deferred)'
  - '../architecture-multi-device-sync-2026-10-13/ARCHITECTURE-SPINE.md (AD-14)'
  - '../../product-brief-nixus-2026-10-13.md'
  - 'docs.stripe.com (verified 2026-11-18)'
---

# Billing & Entitlements — Investigation Baseline

Goal: take payments for Nixus Cloud subscriptions, and make the resulting entitlement the single
authority that hosted AI, sync and the desktop all gate on. This is the spine the cloud-profile run
deferred (CAP-7, AD-17, *Deferred → Billing and payments*).

Trigger: LemonSqueezy is dead. The owner has chosen **Stripe Managed Payments**, and wants two
operational properties that the old plan never addressed — **discount codes** and **price changes**
that do not require a code deploy.

## 1. What this actually is

**There is nothing to migrate.** Verified across the whole repo: no Stripe, LemonSqueezy, Keygen or
Paddle dependency in any `package.json` or `Cargo.toml`; no `apps/api-licensing`; no
`lemonsqueezy-verify.ts` despite that exact path being specified in
`architecture-entitlements-licensing.md`. "Replacing LemonSqueezy with Stripe" is therefore **two
unrelated jobs**:

1. **A documentation correction** (cheap, mechanical). Ten planning documents still name
   "Keygen/LemonSqueezy" as the entitlement provider. The 2026-11-17 run already recorded the
   supersession; the notes just have to land. Affected:
   `architecture-entitlements-licensing.md` (the whole document), `architecture-login.md`,
   `epics-login.md`, `architecture-cloud-bedrock.md`, `architecture.md`, `prd.md`,
   `architecture/architecture-nixus-2026-08-25/**`, `specs/spec-cloud-bedrock/**`,
   `implementation-artifacts/deferred-work.md` (the `apps/api-licensing` parking-lot entry), and
   `research/pricing-model-competitive-analysis-2026-08-12.md` (asserts the provider is "already
   locked").
2. **A net-new build.** Everything below.

One of those documents is load-bearing, not cosmetic:
`implementation-artifacts/27-4-auth-e2e-coverage-and-licensing-independence-amendment.md` has
acceptance criteria that **grep the codebase for `lemonsqueezy|keygen|entitlement`** to prove auth
has no billing coupling. That assertion will start failing the moment real billing code exists and
must be rewritten to target the new module names before, not after, the first billing commit.

## 2. What already exists to build on

The 2026-11-17 cloud-profile run shipped most of the substrate this spine needs:

| Needed for billing | Already built | Where |
|---|---|---|
| A server runtime on the web with sessions | `apps/account` TanStack Start BFF, `__Host-` opaque session cookie, server-held tokens, CSRF/fixation/open-redirect gates | AD-10, `apps/account/src/server/**` |
| A confidential Cognito client | Web client with PKCE, secret in SSM `SecureString`, read at cold start | AD-10 |
| A second REST API on the shared domain | `nixus-account` attaches to `api.nixusapp.com` by `ApiMapping` key `v1/profile`, longest-match over the Bedrock catch-all | AD-3 |
| Lambda + DynamoDB conventions | `apps/api-account`: one `functions/api.ts`, `handlers/`, `lib/{table,errors,validation,logging}.ts`, co-located Vitest | `apps/api-account/src/**` |
| Versioned-write + closed-error-union contract | `packages/shared/src/types/account.ts`, `expected_version` conditional writes, `version_conflict` with `current_version` | AD-4, AD-13 |
| A capability seam on the desktop | `entitlements.rs` — the one place a tier and a capability are named together; `sync/gate.rs` checks it before every network op | sync AD-14 |
| Deploy envelope | GitHub OIDC per-stack bootstrap, protected `production` env, 14-day logs, $10 budget | AD-12, AD-14 |

So the billing spine is a **third stack plus a tier model**, not a new platform.

## 3. Provider verification (Stripe, verified 2026-11-18)

Managed Payments went GA **2026-04-22** in 39 countries. Canada is a supported business location;
SaaS (`txcd_10103001`) is an eligible product category. Stripe is merchant of record through its
Link consumer brand and **files and remits** GST/HST for Canada and VAT for all 27 EU states.
Fee: **3.5% on top of standard Stripe processing.**

All six requirements hold. A Managed Payments subscription is an ordinary Stripe `Subscription`
object with an added `managed_payments` sub-object, so Billing mechanics are unmodified:

| Requirement | Verdict |
|---|---|
| Recurring subscriptions | ✅ `mode=subscription` with `managed_payments[enabled]=true` |
| Multiple tiers, upgrade/downgrade, proration | ✅ Standard `POST /v1/subscriptions/{id}` with `proration_behavior`; `payment_behavior` and subscription schedules explicitly supported |
| Promotion codes, operator-created | ✅ `allow_promotion_codes` / `discounts[]` are **not** on the removed-parameter list; codes are created in the Dashboard |
| Customer Portal | ✅ Managed Payments is listed under portal Interoperability, **and** every customer gets Link's own portal for free |
| Webhooks | ✅ `checkout.session.completed` documented for the MoR flow; the subscription lifecycle events follow from it being a normal `Subscription` |
| Free trials | ✅ Enabled Feb 2026 |

### 3.1 Limitations that actually constrain this design

Most of the unsupported-feature list (Connect, Elements, ad-hoc invoicing, third-party tax engines)
is irrelevant here. Four items are not:

1. **Subscriptions can only be created through Checkout or Payment Links.** There is no path to
   create a Managed Payments subscription directly via the Subscriptions API. Every purchase
   therefore starts with a server-created Checkout Session — which is the design anyway, but it
   closes the door on ever provisioning a paid subscription from an admin script.
2. **`subscription.default_payment_method` cannot be updated via the API.** Card updates *must* go
   through the Customer Portal or Link. The desktop and the account app must link out to a portal
   session; a custom card form is not buildable.
3. **Adaptive Pricing is always enabled.** A visitor outside Canada may be charged in their own
   currency at a Stripe-chosen rate. The screenshot's footnote (`prices in CAD, taxes extra`) is
   therefore only correct for Canadian visitors, and "taxes extra" needs rewording — Stripe
   calculates and adds tax at checkout as merchant of record.
4. **Ongoing eligibility review.** Stripe can revoke Managed Payments on dispute-rate performance,
   and can issue refunds within 60 days without seller approval. The entitlement writer must treat
   a Stripe-initiated refund/cancellation as a normal inbound event, not an anomaly.

### 3.2 Economics, stated plainly

At 3.5% MoR + ~2.9% + $0.30 processing:

| List price | Fees | Net | Take rate |
|---|---|---|---|
| $9.99/mo | ~$0.94 | ~$9.05 | ~9.4% |
| $19.99/mo | ~$1.58 | ~$18.41 | ~7.9% |

**Open risk:** LemonSqueezy's migration programme offers a reduced **1.5%** Managed Payments fee
through 2027-12-01 for migrating merchants. Nixus has no LemonSqueezy account (sign-ups already
closed), so it almost certainly **does not qualify** and should budget the full 3.5%. Worth one
email to Stripe sales before launch — it is a 2% swing on all revenue. The LemonSqueezy migration
tooling (launching 2026-12-02) is irrelevant to Nixus for the same reason.

## 4. The real architectural change: `premium: boolean` → a tier

This is the part the prior documents do not cover, and it is bigger than the payment integration.

**Today there is exactly one bit of entitlement in the entire system.** `HostedAiTable`'s
`USER#<sub>/CONFIG` holds `premium: boolean`, hand-written with `aws dynamodb put-item`. The desktop
reads it from `GET /v1/ai/status` and `entitlements.rs` projects that same bit onto
`MULTI_DEVICE_SYNC`. **One boolean grants both hosted AI and sync.**

The proposed pricing page breaks that in two:

| Tier | Account | Sync | Hosted AI | Status |
|---|---|---|---|---|
| Local | none | — | — | ships today |
| **Nixus Cloud Free** | signed in, not subscribed | — | — | ships today; **shown on the pricing page** (D2) |
| Classic $9.99 | subscribed | ✅ | ❌ | new; also advertises household net worth (D5, built shortly after) |
| Advance $19.99 | subscribed | ✅ | ✅ | new; also advertises custom dashboards (D5, gating open — §4.2) |
| *(tier N+1)* | subscribed | ✅ | ✅ | **planned** — one new in-app capability plus non-software perks (D4) |

Three consequences:

1. **Hosted AI and sync must be decoupled.** `PREMIUM_CLOUD_CAPABILITIES` in `entitlements.rs` — a
   flat `&[Capability]` slice — becomes a tier→capability table. `AccountCapabilities::from_cloud_entitlement(bool)`
   and `get_cloud_ai_premium() -> bool` both change shape. Per sync AD-14 this is an edit to
   `entitlements.rs` and nothing in `sync/**`, which is exactly what that invariant was for.
2. **The pricing page needs the free cloud tier.** Every signed-in account already has a cloud
   profile (AD-2, and the README says so publicly), and the owner has confirmed sign-in must work
   with no subscription (D2). The page gains a fourth column, and `free` becomes a real tier in the
   model rather than "absence of an entitlement".
3. **Two advertised features do not exist.** "Household net worth" (Classic) and "Custom
   dashboards" (Advance) are not built, and the product brief's third tier (**Privilege**) is absent
   from the page. The tier→capability table must be allowed to contain capabilities no code consumes
   yet, or the page is selling vapour.

Also note: the existing manually-granted premium users were granted *hosted AI*. On cutover they map
to **Advance**, not Classic.

### 4.1 Tier extensibility is a hard requirement (D3)

A further tier is already planned, so "add a tier" must not be a redesign. That splits the model
along a precise seam:

| Change | Cost |
|---|---|
| Add a tier that reuses existing capabilities | **Dashboard only.** Create the Stripe Product with `metadata.nixus_tier`, add a Price with a `lookup_key`, list its capabilities in the Product metadata. No deploy. |
| Change any price, add an annual interval, run any discount | **Dashboard only.** |
| Add a brand-new *capability* | **Deploy.** The capability set is a closed compile-time union in both `billing.ts` and `entitlements.rs` — that closedness is what makes the gate exhaustive rather than a lookup that can silently miss. |

So `tier` is an opaque server-supplied string the client never branches on, and **capabilities** are
the only thing any gate reads. No surface anywhere — not `sync/**`, not hosted AI, not the UI —
may ever test `tier == "advance"`. That rule is what keeps tier N+1 free. The signed statement
(§5.3) therefore carries `capabilities[]` as the authoritative grant and `tier` only as a display
label.

Corollary: the capability list per tier lives in Stripe Product metadata, and the webhook validates
each name against the compile-time union, dropping unknown names with a loud log. An operator can
grant an existing capability to a new tier without a deploy, and cannot invent one by typo.

### 4.2 Custom dashboards already exist, and already answer their own gating question (D5)

AI-generated dashboards ship today: `ai/home_surface.rs` drives the Home page's "Edit with AI"
composer ("Your personalized insights", `home.widgets.count` = N of 12 widgets), proposing widgets
from a component catalog that the user confirms. So this bullet advertises a built feature, not a
promise.

More importantly, the gating question is already settled **in code**, and settled the right way.
`home_surface::authorize` is documented as:

> *"The hosted-reason gate: called by `commands::home` only when the user has configured no BYO
> provider at all, to name why the composer is locked. A configured BYO key skips this entirely
> (same precedence every other AI surface uses) and reaches `generate` below regardless of it."*

That is option (a) verbatim, and it is the established precedence for **every** AI surface. So:

- **No `custom_dashboards` capability is needed.** The existing `hosted_ai` capability covers it.
- **No new `CloudAiOperation` is needed.** The composer deliberately travels under
  `AiOperation::Chat`, with the reason recorded in the source: the hosted gateway's operation union
  is closed and CI-deployed, so until it learns a Home operation, chat's limits apply and they fit.
  Adding a `home_surface` operation later is an optional quota-accounting improvement, independent
  of billing.

### 4.2.1 But `premium_required` becomes ambiguous the moment two paid tiers exist

This is the one genuine defect the tier split creates, and it is not in the billing stack at all.

Today `premium` is one bit, so "not premium" and "not entitled to AI" are the same sentence.
`hosted_bedrock::classify_status` branches on `status.premium` into
`HostedEligibility::NotPremium`, and `home_surface::authorize` renders it as:

> *"The Home dashboard composer requires Nixus Cloud premium."*

Under Classic/Advance that message is **wrong for a paying customer**. A Classic subscriber is
premium — they pay $9.99/month — and will be told they need premium when what they actually need is
a plan that includes AI. The same applies to `CloudAiErrorCode`'s `premium_required` in the shared
contract, which three surfaces render.

Required changes, none of them large but all of them load-bearing for launch quality:

- `premium_required` keeps its wire name (additive-only evolution, AD-13) but its **meaning**
  narrows to "your plan does not include this capability".
- `HostedEligibility::NotPremium` becomes capability-shaped rather than tier-shaped — it is derived
  from "the entitlement does not grant `hosted_ai`", not from a `premium` boolean.
- EN/FR copy on every surface that renders it must name the plan that includes the capability, and
  the free and Classic cases should route to an upgrade rather than read as an error.
- The distinction matters for `QuotaExhausted` too: an Advance subscriber out of quota and a Classic
  subscriber with no AI entitlement are different conversations.

This is why §4.1's rule is "gates read capabilities, never `tier`" — the one place the codebase
currently reasons in tiers is exactly the place that breaks.

### 4.3 Freeze and resume (D8, D9)

D8 and D9 together define the lapse path, and it maps onto a mechanism the sync spine already has
rather than needing a new one.

On losing `multi_device_sync` at period end, sync enters AD-14's **Frozen** state: transfers stop,
the local app keeps working, the cloud copy is retained (never deleted — D8). While frozen the
device keeps accumulating local changes that are never published, and the cloud change-log segments
behind the last snapshot age out normally.

On re-subscribing, an incremental resume is therefore unsound: the device's local state and the
cloud copy have diverged with no common recent ancestor. D9 requires a **full publish**. The clean
implementation is to reuse the existing link decision — the one prompt the sync spine already
owns ("load the cloud copy, keeping your local file as a dated backup, or keep your local data and
publish it over the cloud copy") — by treating re-entitlement after a freeze as a **relink**, not a
resume. No new UX, no new merge path, and the README copy already describes the behaviour.

**One case is not yet decided:** two devices both frozen, both edited offline, then re-subscribed.
Whichever relinks first publishes; the second is offered the link decision against a cloud copy it
has never seen. That is survivable and consistent, but it means the second device's owner must
choose, and only one side's offline work survives automatically. Flagged in §9.

## 5. Decisions needed (forks)

| # | Fork | Options | Recommendation |
|---|---|---|---|
| B1 | Entitlement home | (a) `ENTITLEMENT`/`BILLING_CUSTOMER` sort keys in the existing profile table, as AD-4 reserved; (b) a dedicated billing table in a new stack | **(b)** — see §5.1. Declared departure from AD-4's reservation. |
| B2 | Service topology | (a) New stack `nixus-billing`, mapped at `v1/billing`; (b) add billing routes to `nixus-account`; (c) webhook on a Lambda Function URL | **(a)** — follows the AD-3 precedent, and keeps the unauthenticated webhook out of a Cognito-authorized API by stack boundary. |
| B3 | Who calls Stripe | (a) The account BFF calls Stripe directly; (b) only the billing Lambda holds Stripe keys and the BFF calls it over HTTP with the user's token | **(b)** — the AD-11 rule ("the account server never touches profile storage") generalises: one writer, one key holder. The BFF gets no Stripe credential. |
| B4 | Signed statement mechanism | (a) Sign per request; (b) sign once on entitlement change, store the statement, re-sign lazily near expiry | **(b)** — see §5.3. One KMS call per entitlement change instead of per request. |
| B5 | Tier → price mapping | (a) Hardcode `price_id` per tier in code; (b) SSM parameter; (c) Stripe `lookup_key` + Product `metadata.nixus_tier` | **(c)** — see §6. This is what makes "change pricing without a deploy" true rather than aspirational. |
| B6 | Pricing page location | (a) Static `/pricing` on `nixusapp.com` with baked prices; (b) live prices from a public `GET /v1/billing/plans`; (c) move `/pricing` to the account app | **(b)** on the static site, hydrating over baked fallback copy — keeps SEO, keeps prices honest. |
| B7 | Webhook convergence | (a) Apply the event payload's deltas; (b) on any relevant event, re-fetch the subscription from Stripe and write the derived entitlement | **(b)** — makes out-of-order and duplicate delivery harmless. |
| B8 | Free cloud tier on the pricing page | Show it vs leave the page as drawn | **Decided (D2): shown.** `free` is a real tier; sign-in works with no subscription. |
| B9 | Annual prices | Monthly only at launch vs monthly + annual | Two prices per tier is free architecturally; `lookup_key` already carries the interval. |
| B10 | Hosted-AI quota per tier | One global quota vs a per-tier `monthly_request_limit` | Per-tier, read from the entitlement — otherwise Advance has no lever to be worth $10 more. |
| B11 | `HostedAiTable.premium` | (a) Keep it, written by the webhook; (b) retire it — the table keeps quota counters only | **(b)**, per D1. Keeping it recreates the two-sources-of-truth defect this spine exists to fix. The write path is the thing being replaced, so there is no reason to preserve the field. |

### 5.0 Owner decisions recorded 2026-11-18

- **D1 — `HostedAiTable.premium` is retired, not repurposed.** Known and accepted. `HostedAiTable`
  keeps quota counters (`USAGE#<period>`, global config); the entitlement moves out entirely and the
  bedrock Lambda reads it from the billing table. Closes INVESTIGATION finding #4.
- **D2 — Sign-in works on a free account.** `free` is a first-class tier, so the entitlement
  authority answers for every valid token rather than only for payers. It needs no stored record:
  absent `ENTITLEMENT` derives `free` with an empty capability list, and the response is **still a
  signed statement**, so the desktop can distinguish "verified free" from "could not reach the
  server" — the first invites an upgrade, the second is a transient. The pricing page shows the
  tier (B8). A paid record is created only by the webhook.
- **D3 — A further paid tier is coming.** Adding a tier must cost no deploy. See §4.1.
- **D4 — Tier N+1 is mostly non-software.** It grants one or more new in-app capabilities **plus
  perks outside the system**: goodies, direct access to the founder, faster support. Those perks need
  **no capability and no code** — they are fulfilled by a human. The architectural consequence is
  that `tier` must be legible to *operations*, not just to the UI: support has to know who is owed
  faster support. `tier` is therefore carried on the entitlement and surfaced in the admin path, and
  is still never branched on by a feature gate (§4.1). Its new in-app capability is the only part
  that costs a release.
- **D5 — Classic advertises household net worth; Advance advertises custom dashboards.** Both stay
  on the page. `household_net_worth` is reserved as a capability name now and granted by Classic
  before any code consumes it, which §4.1 explicitly permits. **Custom dashboards already ship**
  (`ai/home_surface.rs`) and need no new capability — see §4.2.
- **D11 — Two frozen devices that diverge offline: accepted.** Whichever relinks first publishes;
  the second is offered the existing link decision against a cloud copy it has not seen. No merge
  is built for this case (§4.3).
- **D12 — Tier N+1 is perks-only for now.** It unlocks nothing in the app that Advance does not
  already grant; goodies, founder access and faster support are fulfilled by a human. So tier N+1
  ships as a **pure Stripe Dashboard change** — a Product with `metadata.nixus_tier`, a Price with a
  `lookup_key`, and Advance's capability list. Zero code, zero deploy. A future capability for it
  stays possible and costs one release, which is exactly the seam §4.1 defines. This makes
  "capabilities, never `tier`" (§4.1) and "`tier` is legible to operations" (D4) the two rules that
  have to survive into the spine: the first is what makes N+1 free, the second is what lets support
  see who is owed faster support.
- **D6 — Monthly prices only at launch.** Annual is a later Dashboard change (B9), not a redesign.
- **D7 — The pricing footnote is reworded, availability is not restricted.** Adaptive Pricing stays
  on. Copy must say prices are in CAD, shown in the visitor's currency at checkout, with tax
  included — never "taxes extra", because Stripe is merchant of record and adds tax itself.
- **D8 — Downgrades take effect at period end. No data is ever deleted on tier loss.** Historical
  data is retained in full; the tier simply stops granting capabilities. Classic → free loses sync.
- **D9 — Re-subscribing after a lapse requires a full sync push, not an incremental resume.**
  See §4.3.
- **D10 — The offline window is under 7 days, and the entitlement is revalidated on app start and
  on sign-in.** A cached statement may never be the reason an unpaid user keeps a paid feature.
  See §5.4.

### 5.0.1 Fee outcome

No LemonSqueezy account exists, so the 1.5% migration rate does not apply. **Budget the full 3.5%
MoR fee** per §3.2 (~9.4% all-in on a $9.99 subscription). No further action.

### 5.1 Why a separate billing table (B1)

AD-4 reserved `ENTITLEMENT` and `BILLING_CUSTOMER` in the profile table and said "the profile
Lambda's IAM policy is limited to `PROFILE`/`AVATAR` sort keys". **That IAM isolation is not
expressible in DynamoDB.** Fine-grained access control offers `dynamodb:LeadingKeys` (partition key
only), `dynamodb:Attributes`, `dynamodb:Select`, `dynamodb:ReturnValues` — there is no sort-key
condition key. The isolation in `apps/api-account/src/lib/table.ts` today is real but it is *by
construction in the module*, exactly as its own comment says ("unreachable from this module by
construction"), not by IAM.

So keeping billing in the profile table means the profile Lambda's role can read and write payment
state, and three stacks write one table. A separate table gives genuine IAM isolation in both
directions, its own PITR/`Retain` policy, and a self-contained stack. **Verify the no-sort-key-
condition claim against current IAM docs before committing** — it is the whole basis of this fork.

### 5.2 Proposed topology

```
api.nixusapp.com
├── v1/profile   → nixus-account   (Cognito authorizer, scope nixus-api/profile)   [exists]
├── v1/billing   → nixus-billing   (NEW)
│   ├── POST /checkout        Cognito authorizer, scope nixus-api/billing
│   ├── POST /portal          Cognito authorizer, scope nixus-api/billing
│   ├── GET  /entitlement     Cognito authorizer, scope nixus-api/billing
│   ├── GET  /plans           NO authorizer — public price catalog, CloudFront-cached
│   └── POST /webhook         NO authorizer — Stripe signature verification in the Lambda
└── (catch-all) → nixus-bedrock-api                                                [exists]
```

`GET /v1/ai/status` keeps its shape for compatibility but sources `premium` from the entitlement
rather than from `HostedAiTable`. `HostedAiTable` keeps only quota counters — its `premium` field is
retired, which closes INVESTIGATION finding #4 ("two sources of truth").

Data model, billing table, `pk = USER#<sub>`:

- `sk = ENTITLEMENT` — `tier`, `capabilities[]`, `status`, `current_period_end`, `source`
  (`stripe | app_store | play | admin`), the cached signed statement + its `exp`, `version`,
  `stripe_event_watermark`.
- `sk = BILLING_CUSTOMER` — `stripe_customer_id`, `stripe_subscription_id`, `price_lookup_key`.
- `sk = EVENT#<stripe_event_id>` — dedupe record with a TTL.

A GSI on `stripe_customer_id` is required: webhooks arrive keyed by Stripe customer, not by `sub`.

Checkout flow (desktop and web are the same two calls):

```
surface → POST /v1/billing/checkout {plan_lookup_key, promo?}   [user access token]
        ← {url}
surface → opens url   (web: 303 redirect · desktop: system browser, never the webview)
Stripe  → POST /v1/billing/webhook   (signature verified, subscription re-fetched)
        → write ENTITLEMENT + BILLING_CUSTOMER, sign the statement
surface → GET /v1/billing/entitlement   (on focus / on return)
```

### 5.3 The AD-17 signed statement

AD-17 is binding and non-negotiable: a premium feature that runs **on the device** may gate only on
a server-signed, `sub`-bound, expiring statement verified offline against an embedded public key.
Sync is that feature, and its gate is client-side today — AD-17's "current exception", which this
spine must close.

Proposed shape: a compact signed token (`sub`, `tier`, `capabilities[]`, `iat`, `exp`, `key_id`)
signed by a **KMS asymmetric key** (`ECC_NIST_P256`), public key embedded in the desktop binary.

The cost trick is B4: **sign on write, not on read.** The webhook signs once per entitlement change
and stores the statement verbatim in the `ENTITLEMENT` item; `GET /v1/billing/entitlement` returns
that string. `exp` is set per §5.4, and the GET re-signs whenever the stored statement is at or near
expiry — so the stored copy is a cache, not the authority, and a cancellation can never be
outlived by a statement signed before it.

Desktop side: cache the statement next to the profile copy, verify offline on every capability
check, and treat expired-or-unverifiable as **no capability** — which per sync AD-14 is the Frozen
state and leaves the local app fully working. Last-known status may be *displayed* but never
*authorizes*. Key rotation needs `key_id` from day one; a statement signed by an unknown key is
simply invalid.

### 5.4 The offline window is nearly free, because every paid capability needs the network (D10)

D10 asks for an offline window under 7 days plus revalidation on start and sign-in. That is
achievable with room to spare, and the reason is worth recording because it also removes a tension
in the original recommendation.

**Dunning and the offline window are two different numbers, and only one of them is ours.**

- *Entitlement survival during a failed payment* is **Stripe's**, configured in the Dashboard
  (smart retries, and whether the subscription cancels after the final retry). The webhook simply
  writes whatever Stripe says the subscription status is. No code decision, no hardcoded grace
  period — which is why a short offline window cannot lock out a customer whose retry was going to
  succeed. The server keeps granting; only the *cache lifetime on the device* is short.
- *The offline window* is ours, and it can be short because **every capability that exists today
  requires connectivity to use.** Sync cannot run without a network. Hosted AI cannot run without a
  network. A device that cannot reach the entitlement endpoint also cannot exercise the capability
  the statement would have granted, so a long window buys nothing and only widens the window in
  which a cancelled subscriber keeps a paid feature — exactly what D10 rules out.

Proposed: **`exp` = min(`current_period_end`, now + 24 h)**, revalidated on app start, on sign-in,
and on the existing `hosted_state` cache TTL. 24 hours is comfortably inside D10's bound and is
transparent in practice, because a user doing the paid thing is online anyway.

The 7-day figure only becomes relevant if a *locally-run* premium capability ever ships — the case
AD-17 was written for. At that point the window becomes per-capability (`max_offline` in the
statement) rather than global, so this choice does not have to be revisited for the whole system.

## 6. The operator requirements: discount codes and price changes

This is the part the owner asked for explicitly, and it is an architecture constraint, not a feature.

**Price changes without a deploy.** Code must never contain an amount or a `price_id`. Reference
Stripe Prices by **`lookup_key`** (`classic_monthly_cad`, `advance_annual_cad`). To change a price,
the operator creates a new Price at the new amount with `transfer_lookup_key: true`; the old Price
keeps serving existing subscribers at their grandfathered rate and new checkouts pick up the new
amount. No deploy, no config edit, no migration. Tier identity comes from Stripe **Product
`metadata.nixus_tier`**, so the webhook derives the tier from Dashboard metadata rather than from a
mapping table in code.

**Discount codes without a deploy.** Set `allow_promotion_codes: true` on every Checkout Session;
the operator then creates coupons and customer-facing promotion codes in the Dashboard. For campaign
links, accept an optional `promo` on `POST /checkout` and pass `discounts: [{promotion_code}]`
instead — the two are mutually exclusive per session, so the endpoint picks one mode based on
whether a code was supplied. Validate the code server-side and fail closed with a specific error
rather than silently dropping it.

**Displayed prices.** `GET /v1/billing/plans` returns the public catalog (tier, lookup_key, amount,
currency, interval) read from Stripe and cached. The static marketing site ships baked copy as a
fallback and hydrates over it; the account app renders it server-side. A price change is then
visible everywhere within the cache TTL with no rebuild.

**What still needs a deploy:** a new *capability* (the tier→capability table is compile-time by
design, in both TS and Rust), and a new tier that grants capabilities no existing tier has. Adding a
price, changing an amount, adding an annual interval, and any discount are all Dashboard-only.

## 7. Blast radius

**New:**
`apps/api-billing/` (stack `nixus-billing`: `template.yaml`, `functions/api.ts`, `handlers/{checkout,portal,entitlement,plans,webhook}.ts`, `lib/{table,stripe,entitlement,signing,errors,logging}.ts`),
`packages/shared/src/types/billing.ts` (tier enum, capability enum, plan catalog, statement claims, closed error union),
`infra/bootstrap/billing-oidc-deploy.yaml`,
`.github/workflows/billing-ci.yml`,
account app routes `/pricing`, `/billing`, `/checkout/complete` (+ `/fr/*`).

**Changed:**
`apps/desktop/src-tauri/src/entitlements.rs` (boolean → capability table + statement verification),
a new statement cache module and its `cloud_link.rs` allowlist entry,
`apps/desktop/src-tauri/src/ai/hosted_bedrock.rs` (`classify_status` stops branching on a `premium`
bool; `HostedEligibility::NotPremium` becomes capability-derived — §4.2.1),
`apps/desktop/src-tauri/src/ai/hosted_state.rs` (entitlement source),
`apps/desktop/src-tauri/src/ai/home_surface.rs` (`authorize`'s `premium_required` message — §4.2.1),
`apps/api-bedrock/src/lib/table.ts` + `quota.ts` (retire `premium`, per-tier limit),
`packages/shared/src/types/cloud-ai.ts` (`premium: boolean` → tier + capabilities, additively;
`premium_required` keeps its name, narrows its meaning),
`apps/desktop/src/locales/{en,fr}.json` (every surface rendering `premium_required`, plus an upgrade
route for free and Classic),
Cognito resource server (+ scope `nixus-api/billing`) and `COGNITO_SCOPES`,
`apps/web` locales (EN/FR pricing + FAQ + Terms),
`README.md` ("There is no payments or billing system in Nixus yet"),
`docs/runbooks/hosted-ai-rollout.md` §3.2 (the manual `put-item` grant is replaced by an admin path),
`27-4-...-licensing-independence-amendment.md` (its greps).

**Not changed:** `sync/**` — by construction, per sync AD-14. That invariant pays off here.
`CloudAiOperation` also stays closed at four operations; the Home composer keeps travelling under
`chat` (§4.2).

## 8. Release gates (following the AD-15 pattern)

- Webhook rejects a bad or absent Stripe signature, and a replayed `event_id` is a no-op.
- Out-of-order delivery converges: an older event never downgrades a newer entitlement (watermark test).
- A tampered, expired, wrong-`sub`, or wrong-`key_id` signed statement grants **nothing**, on both sides of the TS↔Rust contract.
- Tier→capability parity test between `billing.ts` and `entitlements.rs`.
- A Classic entitlement is refused by hosted AI; an Advance entitlement is accepted; neither is refused by sync.
- A Classic subscriber denied an AI surface is never told they need "premium" (§4.2.1), and a BYO-credentials user on any tier — including free — still reaches every AI surface.
- Cross-account test: A's token cannot read B's entitlement or open B's portal session.
- IAM isolation both ways: the profile role has nothing on the billing table, the billing role nothing on the profile table, the bedrock role read-only on `ENTITLEMENT`.
- No Stripe secret, webhook secret, card data, `stripe_customer_id` or promotion code in any log, error body, template or env var (AD-12 extension; secrets in SSM `SecureString`, read at cold start).
- Cancellation, refund (including a Stripe-initiated one), payment failure and dunning each produce the correct terminal entitlement.
- Legal gate (AD-16 pattern): Terms must state that **Stripe is the seller of record**, with its refund and dispute path, before the first live charge. Privacy Policy must state that Nixus stores no card data. README and locale copy must stop saying billing does not exist.

## 9. Decision status

**No open questions. Every fork is resolved (B1–B11, D1–D12); this document is ready to feed
`ARCHITECTURE-SPINE.md`.**

### Resolved

- Fee: no LemonSqueezy account, so **3.5%**, no migration programme (§5.0.1).
- Free tier: **shown and signed in**, derived from an absent record, still signed (D2).
- Tier model: **capabilities are the only gate; `tier` is a display and operations label** (§4.1, D4).
- Tier N+1: **perks-only, pure Dashboard change, zero code** (D12).
- Classic/Advance feature list: **as drawn** — household net worth reserved ahead of its code (D5),
  custom dashboards already shipping via `ai/home_surface.rs` and already gated by `hosted_ai` with
  a BYO bypass, needing no new capability and no new AI operation (§4.2).
- Annual pricing: **not at launch** (D6).
- Adaptive Pricing: **accepted, copy reworded** — CAD list price, local currency at checkout, tax
  included (D7).
- Lapse behaviour: **downgrade at period end, nothing ever deleted, relink on re-subscribe**
  (D8, D9), **divergent frozen devices accepted without a merge** (D11).
- Offline window: **24 h, revalidated on app start and sign-in**; dunning grace is Stripe's
  Dashboard setting, not ours (D10, §5.4).
- `HostedAiTable.premium`: **retired**, quota counters stay (D1).

### Carried into the spine as required work, not as questions

1. **`premium_required` lies to a paying Classic subscriber** (§4.2.1). `HostedEligibility::NotPremium`
   and `home_surface::authorize`'s copy both reason in tiers, which is the one thing §4.1 forbids.
   Fixing the meaning and the EN/FR copy is in scope, because the tier split is what breaks it.
2. **Verify that DynamoDB has no sort-key IAM condition** (§5.1) before committing to a separate
   billing table — that claim is the whole basis of fork B1.
3. **Supersession notes in ten planning documents** (§1), including the greps in
   `27-4-auth-e2e-coverage-and-licensing-independence-amendment.md`, which must be rewritten
   *before* the first billing commit rather than after.




