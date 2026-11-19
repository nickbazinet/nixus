---
title: 'Rubric Review — Billing & Entitlements Architecture Spine'
reviews: '../ARCHITECTURE-SPINE.md'
date: 2026-11-18
reviewer: good-spine checklist
verdict: PASS-WITH-FIXES
---

# Rubric Review — ARCHITECTURE-SPINE.md (Nixus Cloud Billing & Entitlements)

**Verdict: PASS-WITH-FIXES** — the paradigm, stack topology and storage decisions hold and
ratify the shipped code, but three critical items must land before epics/stories are cut: AD-10's
server-side sync gate is unenforceable as written at the exact point the spine claims to close
profile AD-17's exception; the cutover/migration/rollback sub-dimension is wholly silent and, as
specified, breaks every existing hand-granted premium user; and AD-2 and AD-9 contradict each other
on who may write the `ENTITLEMENT` item.

Scope of judgement: the spine as a build substrate for the level below. Terseness is not a finding.
INVESTIGATION.md was read only to establish what was already decided.

---

## Checklist roll-up

| Checklist item | Result |
| --- | --- |
| Fixes the real divergence points for epics/stories | **Partial** — F4, F8, F9, F10, F11 are live divergence points |
| Every Rule enforceable and prevents its stated "Prevents" | **Fail** — F1 (unenforceable), F3 (self-contradictory), F13 (undefined case) |
| Nothing under Deferred could let two units diverge | **Partial** — F10 (admin override) |
| Ratifies rather than contradicts the codebase | **Partial** — AD-3/AD-4/AD-12 ratify cleanly; F2, F7, F8 contradict shipped code |
| Covers CAP-1..CAP-8, no orphans | **Partial** — no orphan CAP or AD, but CAP-7's discount half has no rule (F9) |
| No new AD weakens an inherited invariant | **Fail** — F5 (sync AD-14), F1 (sync AD-7), both undeclared |
| Every owned dimension decided/deferred/open | **Fail** — cutover, migration, rollback (F2, F6, F7) and per-tier quota (F8) silent |
| Migration plan for manually-granted premium users | **Absent** (F2) |
| Rollback story | **Absent** (F7) |
| Cutover ordering of the three stacks | **Absent** (F6) |

Verification note: the spine contains zero occurrences of `migrat`, `cutover`, `rollback` or
`backfill`.

### Items that pass, recorded so the review is complete

- **Codebase ratification.** AD-3's "Regional REST API + `AWS::ApiGatewayV2::ApiMapping` + literal
  stage name" matches `apps/api-account/template.yaml:105,209-220` (`StageName: v1`,
  `ApiMappingKey: v1/profile`, `Stage: v1`). AD-4's "key composition lives in one module" matches
  `apps/api-account/src/lib/table.ts:11-17,40-60`, including the UUID-shape-before-key rule
  (`isUuidShaped`, `userPartitionKey`) and `ReturnValuesOnConditionCheckFailure: ALL_OLD`
  (`table.ts:174`). AD-12's BYO-precedence rule matches the documented contract of
  `ai/home_surface.rs:58-61`, and "`CloudAiOperation` stays closed at four operations" matches
  `packages/shared/src/types/cloud-ai.ts:10-14` and `home_surface.rs:325-327`.
- **Capability coverage.** CAP-1..CAP-8 each appear in `binds`, in the capabilities line and in the
  Capability → Architecture Map. All sixteen ADs are referenced by at least one map row. No orphan
  AD and no uncovered CAP.
- **AD-4's declared departure is sound.** The reason of record (no DynamoDB IAM condition key for a
  sort key) is correct — fine-grained access control offers `dynamodb:LeadingKeys` on the partition
  key only — and the existing isolation in `api-account/src/lib/table.ts:11-17` is indeed by module
  construction, as its own comment states. The departure strengthens rather than weakens profile
  AD-4. See F16 for the only loose end it leaves.
- **AD-5's convergence rules** (signature before parse, `EVENT#` dedupe, re-fetch from Stripe,
  watermark-conditional write, closed relevant-event set, 2xx after durable record) are individually
  enforceable and each maps to a stated "Prevents".

---

## Findings

### CRITICAL

#### F1 — AD-10: the server-side sync gate is not enforceable as written, and it is the rule that closes profile AD-17

**Where:** AD-10, bullet 3. Also the Inherited Invariants row for profile AD-17 ("**this spine
closes its stated exception**") and AD-10's own *Prevents* ("profile AD-17's exception persisting").

**What is wrong.** The rule reads: *"the credential path that issues scoped sync access requires
`multi_device_sync`."* There is no server in that path. Per sync AD-7, the device presents its
user-pool ID token directly to a **Cognito identity pool in the enhanced flow** (`GetId`,
`GetCredentialsForIdentity`), and `apps/desktop/src-tauri/src/sync/auth.rs:1-46` confirms it: that
file is the only one in the crate naming `aws_sdk_cognitoidentity`, both calls are **unsigned**, and
the client is built with no credentials provider at all. An identity pool cannot read a DynamoDB
`ENTITLEMENT` item, so nothing at that point can "require" a capability. Worse, sync AD-7's
*Prevents* list explicitly includes *"a request path through a server"* — so inserting one is a
departure from an inherited invariant, and no departure is declared.

The consequence is not cosmetic: AD-10 is the rule that discharges the spine's claim to close
profile AD-17's recorded exception, and AD-16 contains **no gate** that proves an unentitled account
is refused sync server-side. (AD-16's tier-model gate only asserts a *Classic* entitlement is
*accepted* by sync.) As written, an epic can satisfy every AD and still ship sync with a
client-side-only gate — exactly what profile AD-17 forbids.

**Suggested fix.** Name the enforcing component and declare the departure. Two viable shapes, pick
one in the spine:
1. A **pre-token-generation Lambda** adds a capability claim to the ID token and the identity pool
   uses **role mapping** on that claim to select an authenticated role — no request path through a
   server, so sync AD-7 survives intact; the statement and the claim both derive from the one
   authority. State the claim name and that an absent claim maps to the unauthenticated/denied role.
2. A **credential-vending route** in `nixus-billing` (or the sync stack) that checks
   `multi_device_sync` and calls `GetCredentialsForIdentity` server-side — then add an explicit
   **declared departure from sync AD-7** ("no request path through a server"), and update
   `sync/auth.rs`'s boundary tests, which currently assert the device holds that call.

Either way, add an AD-16 gate: *an account whose entitlement does not grant `multi_device_sync`
cannot obtain sync credentials, proven against the deployed pool.*

#### F2 — No migration of the existing manually-granted premium users; as specified, the cutover 403s all of them

**Where:** AD-2, bullet 3 and bullet 4. Nothing in AD-15 or AD-16.

**What is wrong.** AD-2 retires `HostedAiTable`'s `premium` attribute and replaces the manual
runbook with the admin override. The spine never says what happens to the accounts that attribute
currently entitles. Shipped code makes this a hard outage, not a soft gap:

- `apps/api-bedrock/src/lib/table.ts:101-108` — `parseUserConfig` returns `undefined` unless
  `item.premium === true` **and** `monthly_request_limit` is a positive integer. A malformed or
  partial item is fail-closed "not entitled".
- `apps/api-bedrock/src/lib/quota.ts:138-156` — `reserveQuotaUnit`'s `TransactWriteCommand` carries
  a hard `ConditionCheck` on `USER#<sub>/CONFIG`:
  `#premium = :premium AND #monthly_request_limit = :monthly_request_limit` with `:premium = true`.
  Removing the attribute fails the transaction for every premium user.
- `docs/runbooks/hosted-ai-rollout.md` §3.2 and gate 11b describe these items as created **by hand**
  (`premium: true`, `monthly_request_limit: 200`), and §3.1/gate 11 record that `GLOBAL#CONFIG` was
  enabled for the first premium beta account on 2026-08-26. So real accounts exist.

INVESTIGATION §4 decided the answer — *"the existing manually-granted premium users were granted
hosted AI. On cutover they map to **Advance**, not Classic"* — and the spine drops it entirely.

**Suggested fix.** Add a bullet to AD-15 (delivery envelope) and a matching AD-16 gate:
*Before the bedrock stack reads the new authority, a one-time backfill writes an `ENTITLEMENT` item
(`tier = advance`, the Advance capability list, `status` live, `source = admin`, no
`current_period_end`) for every `USER#<sub>/CONFIG` holding `premium: true`; the backfill is
idempotent, asserts count parity between the two tables, and is a release gate. `premium` is removed
from `CONFIG` only after that assertion passes.*

#### F3 — AD-2 and AD-9 contradict each other on who may write the `ENTITLEMENT` item

**Where:** AD-2 bullet 2 vs AD-9 bullets 2 and 3.

**What is wrong.** AD-2: *"Its only writers are **the Stripe webhook handler** and **an audited
admin override**. No other route, stack, surface or human path writes it."* AD-9: *"`GET
/entitlement` returns the stored string and **re-signs** when it is at or near expiry."* Combined
with AD-9's `exp = min(current_period_end, now + 24 h)`, the stored statement goes stale within 24
hours of every write, so the re-sign path is the normal path, not the exception.

The spine never says whether the re-signed statement is **written back**. Both readings break
something:
- If the GET writes it back, a `GET` route is a writer of the `ENTITLEMENT` item — AD-2's one-writer
  invariant is false, the "no other route writes it" clause is violated, and the write races the
  webhook's `version`-conditional write (AD-4), producing `version_conflict` on a read-shaped route
  whose contract has no `expected_version`.
- If it does not write back, the `ENTITLEMENT` item's cached-statement attribute and its `exp` are
  written once and thereafter ignored, and every `GET /entitlement` past the first 24 hours pays a
  KMS sign — which removes the entire stated benefit of "signed on write, not on read".

Separately, *"at or near expiry"* carries **no threshold**, so two stories will choose two different
refresh windows.

**Suggested fix.** Decide and state it. Recommended: *the webhook is the only writer of the stored
statement; `GET /entitlement` returns the stored statement when its remaining lifetime exceeds
`REFRESH_SKEW`, and otherwise signs a fresh statement in memory and returns it **without writing**.*
Pin `REFRESH_SKEW` to a number. If the cache is then judged not to pay for itself, drop the
cached-statement attribute from AD-4's `ENTITLEMENT` shape rather than leaving a field no path
refreshes.

---

### HIGH

#### F4 — Three stated homes for the tier → capability projection

**Where:** AD-6 bullet 2, AD-10 bullet 4, Structural Seed, and AD-1 bullet 3.

**What is wrong.** The spine says the projection lives in three different places:
- AD-6: *"The per-tier capability list comes from Stripe Product metadata."*
- AD-10: *"The tier→capability projection lives in `entitlements.rs`."*
- Structural Seed: `entitlements.rs  # capability table + statement verification`.

AD-1 then says *"`capabilities[]` is the only field a gate reads"* and the statement carries
`capabilities[]` as the grant — which implies the desktop holds **no** tier→capability table at all.
AD-10's and the seed's wording is inherited from sync AD-14, where `entitlements.rs` genuinely did
hold the projection (`PREMIUM_CLOUD_CAPABILITIES` at
`apps/desktop/src-tauri/src/entitlements.rs:41`). Under this spine it cannot: Stripe metadata
decides the list, `lib/entitlement.ts` derives it, and the desktop only verifies and tests
membership. A desktop story reading AD-10 literally will rebuild the tier table it is supposed to
delete — and then AD-1's "no code may branch on `tier`" guard fails on its own architecture.

**Suggested fix.** State one home and restate the others as consequences: *the tier→capability
projection exists only as Stripe Product metadata, validated against the AD-1 union and derived in
`apps/api-billing/src/lib/entitlement.ts`. `entitlements.rs` holds the capability union, statement
verification and a membership test, and no tier table —
`AccountCapabilities::from_cloud_entitlement(bool)` and `PREMIUM_CLOUD_CAPABILITIES` are both
removed. Nothing in `sync/**` changes (sync AD-14).*

#### F5 — AD-11 reverses sync AD-14's resume behaviour without declaring a departure

**Where:** AD-11 bullets 4 and 5, against the Inherited Invariants row citing sync AD-14.

**What is wrong.** Sync AD-14's rule ends: *"Restoring from the frozen cloud copy on demand is not
offered in v1 (support-assisted only); **regaining the flag resumes sync**."* AD-11 says the
opposite on both counts: *"Regaining `multi_device_sync` after a freeze is a **relink, not a
resume**"*, re-entering the link decision — *"load the cloud copy, keeping a dated local backup, or
publish local over the cloud copy"* — which is precisely the restore-on-demand path sync AD-14
withheld from v1.

The reasoning behind the change is sound (INVESTIGATION §4.3 / D9: after a freeze there is no common
recent ancestor, so an incremental resume is unsound). The defect is procedural and load-bearing for
this spine's own convention: the Inherited Invariants table cites sync AD-14 as *binding* AD-11 and
declares only **one** departure, AD-4's. A reader of the table is told AD-11 conforms to an
invariant it reverses.

**Suggested fix.** Add a second declared-departure annotation on the sync AD-14 row, matching the
AD-4 style: *"**declared departure:** regaining `multi_device_sync` after a freeze is a relink, not
a resume, and the frozen cloud copy becomes loadable through the existing link decision. Reason of
record: a frozen device and the cloud copy have no common recent ancestor, so an incremental resume
is unsound (D9)."*

#### F6 — Cutover ordering of the three stacks and the cross-stack table reference are undecided

**Where:** AD-3 bullet 1, AD-4 last bullet, AD-15. AD-16 only has the post-deploy smoke check.

**What is wrong.** The spine creates a two-way dependency between `nixus-billing` and
`nixus-bedrock-api` and resolves neither direction:
- `nixus-billing` attaches to `api.nixusapp.com`, a domain **owned by `nixus-bedrock-api`** (profile
  AD-15, restated in AD-3), referenced by name with **no CloudFormation export**.
- `nixus-bedrock-api`'s role must become **read-only on the billing table** (AD-4) and its Lambda
  must read the entitlement (AD-10 bullet 1) — which requires the billing **table name** and an
  IAM grant that the billing stack creates.

Nothing states how the bedrock stack learns the table name (SSM parameter? template parameter?
convention?), which stack deploys first, or how the grant and the consumer are sequenced so neither
deploy fails. The profile spine faced the lighter version of this and answered it explicitly
("`nixus-account` deploys after `nixus-bedrock-api`"); this spine does not. AD-16's only ordering
assertion is *"after deploy, `GET /v1/ai/status` and `GET /v1/profile` still reach their existing
stacks"* — a smoke test, not an order.

**Suggested fix.** Add an AD-15 bullet stating the order and the name-passing mechanism, e.g.:
*(1) `nixus-billing` deploys (table, KMS key, mapping; mapping added last); (2) the billing table
name and KMS key id are published as SSM parameters under a fixed prefix, which is how
`nixus-bedrock-api` reads them — never a CloudFormation export; (3) the F2 backfill runs and its
parity assertion passes; (4) `nixus-bedrock-api` deploys with the read-only grant and the new
entitlement source behind a parameter; (5) `premium` is removed from `CONFIG` and the parameter is
retired.* Mirror it as an AD-16 gate.

#### F7 — No rollback story anywhere in the spine

**Where:** AD-15 and AD-16. Zero occurrences of `rollback` in the document.

**What is wrong.** AD-15 covers data *durability* (PITR, `Retain` policies) but nothing about
reverting a bad cutover. Specifically unanswered: how the bedrock Lambda's entitlement source is
switched back if the new authority misbehaves; how `HostedAiTable.premium` is restored once retired;
what happens to **live Stripe subscriptions** if the billing stack is rolled back (Stripe keeps
charging and keeps delivering webhooks to an endpoint that may no longer exist); and how a missed
webhook window is reconciled afterwards. AD-5's convergence design makes reconciliation cheap —
re-fetch from Stripe — but no AD says a reconcile path exists or who runs it. AD-15's *Prevents*
claims to prevent "losing entitlement data on a deploy"; `Retain` + PITR prevents loss of *stored*
data, not divergence from Stripe during an outage.

**Suggested fix.** Two bullets in AD-15: *(a) the bedrock entitlement source is selected by a stack
parameter until the cutover is proven, so reverting is a parameter change and not a redeploy of
retired code; (b) a reconcile path exists and is runbook-invoked: for each
`BILLING_CUSTOMER`/`stripe_customer_id`, re-fetch the subscription from Stripe and re-derive the
entitlement through the same AD-5 derivation, idempotent and watermark-respecting. It is the stated
recovery for any missed-webhook or rollback window.* Add an AD-16 gate that the reconcile path
converges a deliberately stale entitlement.

#### F8 — Per-tier hosted-AI quota (fork B10) is a whole dimension left silent, and it breaks shipped code

**Where:** AD-2 bullet 3; the CAP-5 map row ("entitlement read, quota"); AD-12's "out of quota"
distinction. No AD decides it.

**What is wrong.** AD-2 retires `premium` from `USER#<sub>/CONFIG` and says the table *"keeps quota
counters (`USAGE#<period>`, `GLOBAL`) only"* — which deletes the home of `monthly_request_limit`,
the **per-user** limit that shipped code requires in that same `CONFIG` item:
`parseUserConfig` (`api-bedrock/src/lib/table.ts:101-108`) requires it alongside `premium`, and
`reserveQuotaUnit` (`quota.ts:138-156,170-180`) both condition-checks it and uses it as the
reservation ceiling. The spine never says where the limit now comes from.

This is a fork the investigation resolved — B10, *"Per-tier, read from the entitlement — otherwise
Advance has no lever to be worth $10 more"* — yet it appears in no `D`-item, is absent from
INVESTIGATION §9's resolved list despite §9's claim that every fork is resolved, and appears in no
AD. Three plausible homes (the `ENTITLEMENT` item, Stripe Product metadata alongside the capability
list, or a surviving per-user `CONFIG` attribute) means three stories, three answers.

**Suggested fix.** One bullet in AD-2 or AD-6: *the per-tier `monthly_request_limit` is carried on
Stripe Product metadata, validated like a capability name, derived onto the `ENTITLEMENT` item, and
read from there by the hosted-AI Lambda. `USER#<sub>/CONFIG` retains neither `premium` nor
`monthly_request_limit`; the AD-2 quota transaction's `ConditionCheck` on that item is replaced by
the entitlement read plus the unchanged `GLOBAL#CONFIG` check.* Add an AD-16 gate that a Classic and
an Advance entitlement yield different ceilings.

#### F9 — CAP-7's discount half is governed by no rule

**Where:** CAP-7 ("discount and price operability"), mapped to AD-6 and AD-16.

**What is wrong.** AD-6's Rule is entirely about prices, `lookup_key`, `metadata.nixus_tier`,
capability validation and `GET /plans` — not one clause addresses promotion codes. Discounts appear
only as: an error code in AD-13 (`promotion_invalid`), a logging ban in AD-14, a release gate in
AD-16 (*"a promotion code created in the Dashboard applies at checkout with no deploy"*), and a bare
`promo?` field in the checkout sequence diagram. A release gate is a test, not an invariant, and the
scope line promises *"operator-driven pricing **and discount codes**"*.

INVESTIGATION §6 decided the mechanics and they are not obvious: `allow_promotion_codes: true` for
the self-serve case versus `discounts: [{promotion_code}]` for a campaign link, **mutually exclusive
per Checkout Session**, so the endpoint picks a mode on whether a code was supplied; validate
server-side and fail closed with a specific error rather than silently dropping the code. Without
that in a Rule, a checkout story will pick one mode, and the "fail closed" half — the part
`promotion_invalid` exists for — will simply not be built.

**Suggested fix.** Add a bullet to AD-6 (or AD-8): *a Checkout Session sets
`allow_promotion_codes: true` when no code is supplied, and `discounts: [{promotion_code}]` when one
is; the two are mutually exclusive per session, so the handler selects exactly one mode. A supplied
code is resolved server-side before the session is created, and an unknown, expired or inapplicable
code fails closed with `promotion_invalid` — never silently dropped, and never echoed into the error
body (AD-14).*

#### F10 — The admin override has no named mechanism, and as described it recreates the manual grant AD-2 retires

**Where:** AD-2 bullets 2 and 4, AD-14 last bullet, and the *Deferred* entry "Admin surface".

**What is wrong.** AD-2 makes *"an audited admin override"* one of exactly two legal writers and
forbids *"any other route, stack, surface or **human path**"*. *Deferred* then says: *"The AD-2
override is a **runbook-invoked path, not a UI**."* A path that is neither a route nor a UI, invoked
from a runbook, is an operator running `aws dynamodb put-item` — which is both the thing AD-2 says
it replaces (*"the manual premium runbook … is replaced by the admin override"*) and a violation of
AD-4's *"key composition lives in one module and nowhere else"*. AD-14's claim that it *"is audited
server-side in CloudWatch"* is also not achievable by a direct DynamoDB write: there is no server in
that path to log.

This is also the Deferred item that can let two units diverge — one epic builds a Lambda handler,
another writes a runbook with a CLI command — so it fails the "nothing under Deferred could let two
units diverge" check.

**Suggested fix.** Name it in AD-2: *the override is a separate handler in `nixus-billing`, not
reachable through the REST API, invoked by the owner via `lambda:Invoke` from an assumed deploy
role. It composes keys through `lib/table.ts`, sets `source = admin`, advances `version`
conditionally, signs a statement like the webhook, and emits one structured CloudWatch audit line
(`sub`, actor, resulting tier and capabilities — never more, per AD-14). No human writes the table
directly, and the `put-item` runbook step is deleted, not re-scoped.*

#### F11 — The `/v1/ai/status` wire contract change is unstated, so the hosted-AI consumer has two possible implementations

**Where:** AD-2 bullet 3, AD-12 bullet 2. AD-13 governs `billing.ts` only.

**What is wrong.** AD-2 says *"`GET /v1/ai/status` sources entitlement from the authority"* and
AD-12 says *"`classify_status` no longer reads a `premium` boolean"*. The boolean
`classify_status` reads is a **wire field**: `CloudAiStatusResponse.premium`
(`packages/shared/src/types/cloud-ai.ts:67-73`), deserialized by a closed struct —
`WireStatus { premium: bool, monthly_request_limit: i64, … }`
(`ai/hosted_bedrock.rs:152-158,505-515`) — and consumed at `hosted_bedrock.rs:406`,
`classify_status`, `premium_entitlement` and the cached `HostedAiStatus`.

The spine never says how that contract changes. Two incompatible implementations satisfy it equally:
(a) `/v1/ai/status` gains `capabilities[]` (an additive `cloud-ai.ts` change, which no AD authorises
— AD-13's additive-evolution rule is scoped to `billing.ts`), or (b) the desktop stops using
`/v1/ai/status` for entitlement and derives `hosted_ai` from the AD-9 statement, leaving the status
route for quota only. These differ in which module owns hosted-AI eligibility, whether
`hosted_state.rs`'s per-subject cache still holds an entitlement answer, and whether the free/offline
distinction D2 exists for hosted AI at all. INVESTIGATION §7 lists `cloud-ai.ts` as changed; the
spine does not.

**Suggested fix.** One bullet in AD-13 or AD-12: *`cloud-ai.ts` evolves additively under the same
rule as `billing.ts`: `CloudAiStatusResponse` gains `tier` and `capabilities[]` and retains
`premium` as a deprecated mirror for one release, OR (preferred) hosted-AI eligibility on the
desktop derives from the AD-9 statement's `capabilities[]` and `/v1/ai/status` narrows to quota
(`monthly_request_limit`, `charged_count`, `period`).* Pick one and name the modules that change
(`hosted_bedrock.rs::WireStatus`/`classify_status`, `hosted_state.rs`).

---

### MEDIUM

#### F12 — `GET /plans` is a cross-origin browser call and the spine configures neither CORS nor a cache tier

**Where:** AD-3 bullet 3 ("cacheable"), AD-6 last bullet ("read from Stripe and cached"), and the
paradigm diagram's `MKT -- "GET /plans (public)" --> BAPI`.

**What is wrong.** The static marketing site is `nixusapp.com`; the API is `api.nixusapp.com`. A
browser fetch from the former to the latter is cross-origin, and no AD states the allowed origins,
the preflight handling, or that API Gateway `GatewayResponses` (AD-13) must also carry CORS headers
on rejections — a known failure mode where an error body is unreadable by the page. Separately,
"cached" names no tier: Lambda memory, API Gateway stage cache, or CloudFront are three different
costs and three different TTLs, and the TTL is what makes AD-16's gate — *"changing a price in
Stripe test mode changes the advertised and charged price with no deploy"* — measurable rather than
aspirational.

**Suggested fix.** Add to AD-6: *`GET /plans` is cached at one named tier with an explicit TTL, and
serves `Access-Control-Allow-Origin` for the closed set `https://nixusapp.com`,
`https://account.nixusapp.com` — on success and on every `GatewayResponse`. The marketing site
hydrates over baked fallback copy, so a cache miss or a CORS failure degrades to stale copy rather
than an empty pricing table.*

#### F13 — AD-9's `exp` formula is undefined for the free case it explicitly creates

**Where:** AD-9 bullets 3 and 4.

**What is wrong.** Bullet 3 fixes `exp = min(current_period_end, now + 24 h)`. Bullet 4 says a free
account receives a signed statement *"derived from an absent `ENTITLEMENT` record with no write"* —
so there is no `current_period_end`, and `min()` has one operand. An implementer may read the
absent value as `0`/epoch and emit a statement that is expired on arrival, which breaks exactly the
distinction bullet 4 exists to create (*verified free* vs *could not reach the server*).

**Suggested fix.** *`exp` is `now + 24 h` when no `current_period_end` exists (free, and any
entitlement without a period), and `min(current_period_end, now + 24 h)` otherwise.*

#### F14 — AD-15 mandates Stripe test mode for non-production paths but provisions nowhere for it to run

**Where:** AD-15 bullets 1 and 6; AD-16's Operability gates.

**What is wrong.** *"Stack `nixus-billing` … **one production environment**"* and *"**Stripe test
mode is the default for every non-production path.** A test-mode key can never reach the production
stack, and CI asserts it."* With no non-production stack, a test-mode webhook has no endpoint to
deliver to, and AD-16's operability gates (*"changing a price in Stripe test mode changes the
advertised and charged price"*, *"a promotion code created in the Dashboard applies at checkout"*)
have nowhere to execute. The two rules are individually reasonable and jointly unsatisfiable as
stated.

**Suggested fix.** State where test mode runs: *test-mode verification runs locally against the
Stripe CLI's `listen --forward-to`, with the test-mode signing secret supplied by the developer and
never stored in the stack; the AD-16 operability gates are executed in that harness and their output
recorded. No test-mode traffic reaches the production stack, which is what CI asserts.* (Or
provision a second stack and drop "one production environment" — the costlier option.)

#### F15 — The documentation-supersession prerequisite is dropped, and one of those documents will fail CI on the first billing commit

**Where:** AD-16's "Legal and disclosure" bullet covers `README.md` and `apps/web` locales. Nothing
covers the rest.

**What is wrong.** INVESTIGATION §1 and §9 item 3 identify one document as *load-bearing, not
cosmetic*: `_bmad-output/implementation-artifacts/27-4-auth-e2e-coverage-and-licensing-independence-amendment.md`.
Its AC 19 and task list require a literal search of `apps/desktop/src-tauri/src` and
`apps/desktop/src` for `entitlement|licen[cs]e|keygen|lemonsqueezy|NotEntitled|isPro|FeatureGate|Paywall|subscription|tier`
returning *"only hits are unrelated"*, and the investigation states it *"must be rewritten **before,
not after**, the first billing commit."* Billing adds `tier`, `subscription` and `entitlement` to
both trees by design. Nine other planning documents still name Keygen/LemonSqueezy as the
entitlement provider. The spine's AD-16 gates the public copy and omits all of this.

**Suggested fix.** Add to AD-16: *before the first billing commit, the `27-4` amendment's
independence greps are retargeted at module names rather than the words `entitlement`, `tier` and
`subscription`, and the supersession notes land in the documents INVESTIGATION §1 lists —
`architecture-entitlements-licensing.md` foremost. This blocks the first commit, not the release.*

---

### LOW

#### F16 — Profile AD-4's sort-key reservation is now dead and the spine does not retire it

**Where:** AD-4's declared departure.

**What is wrong.** The departure moves `ENTITLEMENT`/`BILLING_CUSTOMER` to a separate table but does
not say the profile-side reservation is released. Profile AD-4 still reads *"sort keys `ENTITLEMENT`
and `BILLING_CUSTOMER` are **reserved for the billing spine**"*, the profile spine's Consistency
Conventions still list them, and `apps/api-account/src/lib/table.ts:11-17` still documents them as
*"reserved for the billing spine and … unreachable from this module by construction."* A future
reader has a live invitation to put billing data in the profile table.

**Suggested fix.** One sentence in AD-4: *the profile table's reservation of these sort keys is
released; the profile spine's AD-4 and the comment in `api-account/src/lib/table.ts` record the
departure and state that no billing sort key exists in that table.*

#### F17 — `version_conflict` is in the closed error union but no billing route can return it

**Where:** AD-13 bullet 1.

**What is wrong.** The union includes `version_conflict`, and AD-4 ties it to a failed `version`
condition. But none of AD-3's three authorized routes (`POST /checkout`, `POST /portal`,
`GET /entitlement`) accepts a client-supplied `expected_version`, and the writers (webhook, admin
override) are not client-facing. So either the code is unreachable — a closed union carrying a dead
member, which the profile spine's contract tests would flag — or an unlisted client write route
exists, which contradicts AD-2.

**Suggested fix.** Drop `version_conflict` from the client-facing union (keeping it as an internal
outcome of AD-4's conditional write), or name the route that surfaces it.

#### F18 — AD-1's no-tier-comparison guard may trip on the i18n rule in the same document

**Where:** AD-1 bullet 1, AD-16's guard (*"no file outside the capability-projection module compares
a `tier` value"*), and the Consistency Conventions i18n row.

**What is wrong.** The i18n row requires *"tier display names and capability labels resolve from
locale files keyed by the codes in `billing.ts`"* — a lookup keyed by `tier`, plus whatever orders
the pricing page's columns. A naive implementation of the AD-16 guard flags both, and the pricing
surface is the one place AD-1 explicitly permits `tier` to be used.

**Suggested fix.** Scope the guard: *it forbids equality comparisons and match arms on a `tier`
value in gate-bearing code, and explicitly exempts locale-key resolution and pricing-surface display
ordering, which consume `tier` as an opaque key and never as a condition.*

---

## Summary of required fixes

| Id | Severity | AD / section | One-line fix |
| --- | --- | --- | --- |
| F1 | critical | AD-10, inherited profile AD-17 / sync AD-7 | Name the component that enforces `multi_device_sync` on the sync credential path; declare the sync AD-7 departure; add a release gate |
| F2 | critical | AD-2, AD-15, AD-16 | Backfill `ENTITLEMENT` (`advance`, `source = admin`) for every `premium: true` CONFIG before the bedrock cutover; gate on count parity |
| F3 | critical | AD-2 vs AD-9 | State that only the webhook writes the stored statement; the GET signs in memory; pin the re-sign threshold |
| F4 | high | AD-6 / AD-10 / Structural Seed | One home for the tier→capability projection (Stripe metadata → `lib/entitlement.ts`); `entitlements.rs` holds no tier table |
| F5 | high | AD-11 vs sync AD-14 | Add the declared-departure annotation for relink-not-resume |
| F6 | high | AD-3, AD-4, AD-15 | State the three-stack deploy order and how the bedrock stack learns the billing table name |
| F7 | high | AD-15 | Add a parameterised entitlement source and a Stripe reconcile path as the rollback story |
| F8 | high | AD-2 / AD-6 | Decide where per-tier `monthly_request_limit` lives and how the quota `ConditionCheck` is rewritten |
| F9 | high | AD-6 / AD-8 (CAP-7) | Add the promotion-code rule: mode selection, mutual exclusivity, server-side validation, fail closed |
| F10 | high | AD-2, Deferred | Name the admin override as a non-API Lambda invoked by assumed role; delete the `put-item` step |
| F11 | high | AD-12 / AD-13 | State how `cloud-ai.ts` and `/v1/ai/status` change, and which module owns hosted-AI eligibility |
| F12 | medium | AD-3, AD-6 | Name the `GET /plans` cache tier + TTL and the closed CORS origin set, including `GatewayResponses` |
| F13 | medium | AD-9 | Define `exp` when `current_period_end` is absent |
| F14 | medium | AD-15, AD-16 | State where Stripe test mode actually runs |
| F15 | medium | AD-16 | Make the `27-4` grep rewrite and the supersession notes a precondition of the first billing commit |
| F16 | low | AD-4 | Release the profile table's sort-key reservation explicitly |
| F17 | low | AD-13 | Drop `version_conflict` or name the route that returns it |
| F18 | low | AD-1, AD-16 | Scope the tier-comparison guard to exempt locale keys and display ordering |
