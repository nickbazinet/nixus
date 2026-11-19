---
title: 'Adversarial Review — Nixus Cloud Billing & Entitlements spine'
type: review
lens: adversary
target: '../ARCHITECTURE-SPINE.md'
altitude: feature
date: 2026-11-18
verdict: 'REVISE — 12 divergence holes (4 critical, 8 high). The spine is internally coherent as prose but underdetermined as a build substrate: 12 pairs of fully AD-compliant units build incompatibly.'
sources:
  - '../ARCHITECTURE-SPINE.md'
  - '../INVESTIGATION.md'
  - '../../architecture-cloud-profile-billing-2026-11-17/ARCHITECTURE-SPINE.md'
  - '../../architecture-multi-device-sync-2026-10-13/ARCHITECTURE-SPINE.md'
  - 'infra/sync/template.yaml'
  - 'infra/sync/verify-template.py'
  - 'apps/api-bedrock/src/lib/table.ts'
  - 'apps/api-bedrock/src/lib/quota.ts'
  - 'apps/api-account/src/lib/table.ts'
  - 'apps/desktop/src-tauri/src/entitlements.rs'
  - 'apps/desktop/src-tauri/src/ai/hosted_bedrock.rs'
  - 'apps/desktop/src-tauri/src/ai/home_surface.rs'
  - 'apps/desktop/src-tauri/src/ai/hosted_state.rs'
---

# Adversarial Review — Billing & Entitlements spine

## Method

The spine was attacked as a **build substrate**, not as prose. For each seam I constructed a
**pair of units one level down** (epic/story scope) where **each unit obeys every AD to the
letter** — no unit cheats, no unit invents a requirement outside scope — and the two still
build incompatibly. A hole is only reported when the AD text itself *permits* both members of
the pair. Every claim quotes the permitting AD text verbatim.

Stylistic and wording issues are out of scope and are not reported.

## Verdict

**REVISE.** 12 holes: **4 critical**, **8 high**.

The spine's invariants are well-chosen and the one-writer / capabilities-not-tiers / converge-
don't-delta decisions are sound. The failures are all of one kind: **an AD names an outcome
without naming the component, the ordering, or the owner that produces it.** Four of them
(H1, H2, H8, H12) can be built two ways where one way silently loses money or user data.

| # | Hole | Severity |
|---|---|---|
| H1 | AD-10's server-side sync gate names a component the spine never defines; both buildable seams break an uninherited parent AD | **Critical** |
| H2 | AD-2's two writers have no precedence rule; a converging webhook silently erases an admin grant | **Critical** |
| H8 | AD-11's "relink on re-entitlement" has no owning component; one compliant build raises a destructive prompt on ordinary sign-in | **Critical** |
| H12 | `POST /checkout` is "per attempt" with no idempotency; two concurrent sessions yield two live subscriptions and one entitlement slot | **Critical** |
| H3 | `EVENT#` marker vs `ENTITLEMENT` write ordering unspecified; one ordering loses events permanently | High |
| H4 | AD-5 write vs AD-9 sign ordering contradicts the spine's own sequence diagram; a statement-less `ENTITLEMENT` is an undefined readable state | High |
| H5 | `exp = min(current_period_end, now + 24h)` is undefined for FREE (no `current_period_end`) and the revalidation trigger is unowned | High |
| H6 | AD-6 permits a Product with absent/malformed capability metadata; the resulting entitlement is undefined | High |
| H7 | Canonical server-side read path not pinned: `ENTITLEMENT` attributes vs the stored statement are two representations with different staleness | High |
| H9 | AD-12 narrows `premium_required`'s meaning but pins neither the HTTP status nor the `SignedOut` arm; AD-13 licenses the old mapping | High |
| H10 | `GET /plans` TTL is unowned across up to four cache layers; advertised vs charged price drift is unbounded | High |
| H11 | Per-tier `monthly_request_limit` has two possible homes and no owner; AD-2 deletes its current home and a live `ConditionCheck` fails closed | High |

---

## H1 — AD-10's server-side sync gate names a component the spine never defines [CRITICAL]

### The permitting AD text

> **AD-10:** "**Sync gating moves server-side** in addition to its local check: **the credential
> path that issues scoped sync access requires `multi_device_sync`.** This closes profile AD-17's
> recorded exception, after which no capability anywhere is client-gated only."

> **AD-10:** "The tier→capability projection lives in `entitlements.rs` and **nothing in `sync/**`
> changes** (sync AD-14)."

### What the credential path actually is

`infra/sync/template.yaml` is a **compute-free** stack. The credential path is
`Cognito::IdentityPool` → `GetId` / `GetCredentialsForIdentity` → `SyncAuthenticatedRole`,
with `AllowClassicFlow: false`, `ServerSideTokenCheck: true`, and an
`IdentityPoolRoleAttachment` carrying `Roles: {authenticated: ...}` and **no `RoleMappings`**.
The template's own comment states the constraint:

> "the stack is compute-free (AD-17), so **there is nothing in the request path to enforce
> anything**, and a control that pretended to would be a control nobody could trust."

The two parent ADs that govern it:

> **sync AD-17:** "`infra/sync/template.yaml` (stack `nixus-sync`) defines the bucket …, the
> identity pool, and the authenticated role **only**."

> **sync AD-7 — Prevents:** "One account reading another's data; long-lived AWS credentials on a
> device; **a request path through a server**; …"

And `infra/sync/verify-template.py:259-260` makes the absence of a role mapping a **CI
assertion**:

> `"RoleMappings" not in attachment, "role attachment must declare no RoleMappings (they widen reachable roles)"`

### The incompatible pair

**Unit A — "Story: gate sync credentials in the identity pool."** Adds a second
`SyncEntitledRole`, a token-based `RoleMappings` entry on the `IdentityPoolRoleAttachment` keyed
on a Cognito claim, and a billing-side writer that sets that claim when `multi_device_sync` is
granted. Obeys AD-10 (the credential path now requires the capability), AD-2 (does not write the
`ENTITLEMENT` record), AD-10's "nothing in `sync/**` changes" (only infra and the billing stack
change), sync AD-17 (adds no compute).

**Unit B — "Story: gate sync credentials behind a billing-owned broker."** Adds
`POST /v1/billing/sync-credentials` to the billing Lambda: verify the Cognito token, read the
`ENTITLEMENT`, and on `multi_device_sync` call `sts:AssumeRole` on the sync role and return
scoped credentials. The desktop's credential provider calls it instead of Cognito. Obeys AD-10
literally, AD-7 (no new Stripe key holder), AD-2 (reads, never writes), AD-10's `sync/**` clause
(the change is in the new billing client module), and — critically — **AD-3 permits the new
route without an amendment**:

> **AD-3:** "**Authorized routes** use a Cognito user-pool authorizer requiring scope
> `nixus-api/billing`: `POST /checkout`, `POST /portal`, `GET /entitlement`." … "**Adding a route
> to the unauthenticated set** is an amendment to this AD, not a code change."

Only the *unauthenticated* set is declared closed. The authorized set is not.

### The concrete divergence

1. **A creates a second entitlement representation.** The capability now lives in a Cognito
   token claim as well as in the `ENTITLEMENT` item, directly against AD-2's "The `ENTITLEMENT`
   record … is the sole authority. Every consumer reads it, directly or through a statement
   derived from it." A token claim is neither. It also has its own refresh lifetime (token TTL),
   so a downgraded user keeps sync credentials until their ID token expires — a window the spine
   never bounds.
2. **B inserts "a request path through a server" into sync credentials** — the exact thing sync
   AD-7's Prevents clause exists to stop — and makes the sync data path depend on the billing
   stack's availability, which sync AD-17 was written to avoid ("Prevents: Coupling sync to the
   hosted-AI stack's lifecycle").
3. **Neither unit is deployable by the AD-15 role.** AD-15 scopes the OIDC deploy role to "API
   Gateway, the mapping, Lambda, DynamoDB, KMS, SSM and logs." A needs Cognito identity-pool
   mutation; B needs `iam:*` on a new role plus `sts:AssumeRole`. Two implementers will extend
   the action list in two different directions, and AD-15's "exact action list scoped to this
   stack" becomes unverifiable.
4. **Unit A trips existing CI.** `verify-template.py` fails the build on the `RoleMappings` it
   adds. An implementer will either weaken that assertion (silently widening reachable roles for
   the whole sync stack) or abandon AD-10.

### The aggravating gap

The spine's **Inherited Invariants** table imports exactly one AD from the sync spine —
`sync AD-14`. **Neither `sync AD-7` nor `sync AD-17` is listed**, so no declared departure is
recorded. Contrast AD-4, which handles the same situation correctly:

> **AD-4:** "**Declared departure** from profile AD-4's reservation … Reason of record: DynamoDB
> exposes no IAM condition key for a sort key…"

An implementer reading only the billing spine cannot know AD-10 breaks two parent invariants.

Further: AD-16's release-gate list has **no gate asserting the server-side sync gate exists**.
AD-10's strongest claim — "after which no capability anywhere is client-gated only" — is
unverified, so the spine can ship believing profile AD-17's exception is closed while it is not.

### New/tightened AD

**Amend AD-10** to name the component and record the departures:

- State explicitly that the sync credential path has **no server-side seam today** (the stack is
  compute-free per sync AD-17 and the enhanced flow is AWS-managed), and that closing profile
  AD-17's exception therefore **requires a named new component**.
- Pin that component: a **sync-credential broker** owned by `nixus-billing`
  (`POST /v1/billing/sync-credentials`), which reads the `ENTITLEMENT` (never a token claim),
  requires `multi_device_sync`, and vends ≤1 h STS credentials scoped to
  `acct/${sub-derived-prefix}/*`. Forbid the `RoleMappings`/claim approach by name so Unit A is
  not buildable.
- Record **declared departures** from `sync AD-7` ("a request path through a server" is now
  accepted for credential *issuance* only, never for object transfer) and from `sync AD-17`
  (the compute lives in `nixus-billing`, not in `nixus-sync`, so `nixus-sync` stays compute-free
  and `verify-template.py` stays unweakened).
- **Close the AD-3 asymmetry:** declare the authorized route set closed too, so adding
  `sync-credentials` is an amendment rather than a code change.
- **Extend AD-15's action list** explicitly with the IAM/STS actions the broker needs.
- **Add an AD-16 gate:** a token whose entitlement lacks `multi_device_sync` is refused sync
  credentials server-side, proven by test; and a CI guard that `infra/sync/template.yaml` still
  declares no `RoleMappings`.

---

## H2 — AD-2's two writers have no precedence rule [CRITICAL]

### The permitting AD text

> **AD-2:** "Its only writers are **the Stripe webhook handler** and **an audited admin
> override**. No other route, stack, surface or human path writes it."

> **AD-5:** "On any relevant event the handler **re-fetches the subscription from the Stripe API**
> and derives the entitlement from that current truth. The event payload is a trigger, never the
> data source."

> **AD-5:** "A derived write is conditional on `event_watermark` advancing, so a late older event
> can never overwrite a newer state."

> **AD-4:** "Writes follow profile AD-4: conditional on `version`,
> `ReturnValuesOnConditionCheckFailure: ALL_OLD`, a failed condition is `version_conflict` and
> never an overwrite."

> **AD-2:** "The manual premium runbook … is replaced by the admin override, which writes
> `source = admin` and is logged."

The admin override is a legitimate writer. It has **no `event_watermark`** — an admin grant is
not a Stripe event. No AD states what happens when the two writers disagree.

### The incompatible pair

**Unit A — "Story: audited admin override grants a tier."** Reads the item, writes
`tier`/`capabilities[]`/`status`, sets `source = admin`, leaves `event_watermark` untouched,
conditional on `version` per AD-4, logged per AD-2 and AD-14. Fully compliant. The implementer
assumes an admin grant is **sticky** — that is the entire purpose of a manual grant, and the
INVESTIGATION's cutover depends on it ("the existing manually-granted premium users were granted
*hosted AI*. On cutover they map to **Advance**").

**Unit B — "Story: webhook converges the entitlement."** On a relevant event, re-fetches the
subscription and writes the derived entitlement, conditional on `event_watermark` advancing
(AD-5) and on `version` (AD-4), setting `source = stripe`. Fully compliant. The implementer
assumes **Stripe is always current truth** — AD-5 says so twice.

### The concrete divergence

An admin grants Advance to a user at `version 7` (`source = admin`, watermark unchanged at W5).
That user then subscribes to Classic, or any ordinary `customer.subscription.updated` arrives at
W9. Unit B **must** converge — AD-5 gives it no choice and no exemption for `source = admin` —
so it writes `tier = classic`, `source = stripe`, watermark W9, and the admin grant is **silently
erased**. Nothing is logged about the loss, because AD-14's loggable list is "resulting tier and
capability names", not "the grant this overwrote".

The symmetric failure is equally compliant: an implementer who reads AD-2's two-writer
formulation as "an admin override is an authority peer" adds `source <> :admin` to the webhook's
`ConditionExpression`. Now a real Stripe cancellation **cannot downgrade** an admin-granted
account, and a comped user keeps paid capabilities forever with no expiry — and AD-5's
convergence guarantee is quietly dead for that subset.

Both readings satisfy every AD. They produce opposite terminal states for identical inputs.

A third divergence rides along: AD-4 requires conditioning on `version`, AD-5 requires
conditioning on `event_watermark`. The spine never says these are **one** `ConditionExpression`.
Three compliant variants exist — `version` only, `event_watermark` only, both ANDed — and only
the third is safe. An `event_watermark`-only webhook write will clobber a concurrent admin write
(no lost-update protection); a `version`-only webhook write loses AD-5's out-of-order protection,
which AD-16 gates ("An older event never downgrades a newer entitlement (watermark test)") — so
that variant fails CI, but the `event_watermark`-only variant **passes** every AD-16 gate while
being unsafe.

### New/tightened AD

**Amend AD-2** with an explicit precedence and reconciliation rule:

- An admin override writes `source = admin` **plus** a mandatory `admin_override_expires_at` and
  `admin_override_reason`. An override with no expiry is not writable.
- **Stripe convergence always wins on `status` and `current_period_end`.** Capabilities are the
  **union** of the Stripe-derived set and a live (unexpired) admin grant, and the webhook must
  preserve the admin fields rather than drop them.
- The webhook's write is a **single `ConditionExpression`** requiring both `version = :v` **and**
  `event_watermark < :w`. State this as the only compliant form.
- Overwriting or expiring a live admin grant emits a dedicated CloudWatch audit line naming the
  prior tier, the prior capability set and the reason (AD-14 already permits tier and capability
  names).
- **Add AD-16 gates:** (a) a webhook event arriving against a live admin override preserves the
  override's capabilities and advances `status`; (b) an expired override is dropped on the next
  convergence; (c) a `version`-only and an `event_watermark`-only webhook write both fail CI.

---

## H3 — `EVENT#` marker vs `ENTITLEMENT` write ordering unspecified [HIGH]

### The permitting AD text

> **AD-5:** "A known `EVENT#<id>` is **acknowledged as a no-op**."

> **AD-5:** "The handler **always returns 2xx once the event is durably recorded**, so Stripe
> never retries work already done."

> **AD-4:** "`sk = EVENT#<stripe_event_id>` — dedupe marker with a TTL covering Stripe's retry
> horizon."

"Durably recorded" is not defined as "the entitlement is written" or "the marker is written".
Both readings are available, and AD-5 gives the dedupe rule absolute force.

### The incompatible pair

**Unit A — "Story: webhook idempotency marker."** Writes `EVENT#<id>` conditional on
`attribute_not_exists` **first** (that is "durably recorded"), then converges and writes the
`ENTITLEMENT`. Obeys AD-5 (dedupe, 2xx-once-recorded), AD-4 (marker with TTL, conditional
writes).

**Unit B — "Story: webhook convergence write."** Writes the marker and the `ENTITLEMENT` in one
`TransactWriteItems` — marker conditional on `attribute_not_exists`, entitlement conditional on
`version` and `event_watermark`. Also obeys AD-5 and AD-4.

### The concrete divergence

In Unit A, any failure **between** the two writes loses the event permanently:

- The entitlement write returns `version_conflict` (AD-4) because an admin override or a
  concurrent event bumped `version`. The handler now faces an unresolvable choice. Return 2xx and
  the event is gone. Return 5xx and Stripe retries — but the retry hits the already-written
  `EVENT#<id>` and AD-5 **mandates** "acknowledged as a no-op". **Either path drops the event.**
- Same outcome for a DynamoDB throttle, a KMS signing failure (see H4), or a Lambda timeout after
  the marker lands.

The lost event is typically a `customer.subscription.deleted` or
`invoice.payment_failed` — so a cancelled subscriber **keeps paid capabilities** until some other
event happens to arrive. AD-5's own Prevents clause names this: "a missed event leaving
entitlement permanently stale." AD-15's "dedicated **webhook-failure alarm**" does not fire,
because Unit A returned 2xx.

Unit B has none of this, and the two units cannot coexist: if both stories ship (marker story and
convergence story in one epic), the marker is written twice — once conditionally outside the
transaction and once inside it — and the in-transaction condition `attribute_not_exists` now
**always fails**, so every event becomes a no-op and the entitlement is never written at all.

### New/tightened AD

**Amend AD-5** to pin atomicity:

- Define "durably recorded" as: **the `EVENT#<id>` marker and the derived `ENTITLEMENT` (and
  `BILLING_CUSTOMER`) are written in a single `TransactWriteItems`.** No other ordering is
  compliant.
- A failed transaction returns **5xx** and writes **no marker**, so Stripe's retry is a genuine
  retry rather than a deduped no-op.
- `version_conflict` on a webhook write is a **retryable** condition: re-read, re-derive, retry a
  bounded number of times within the invocation, then 5xx. It is never surfaced as a client error
  and never swallowed as 2xx.
- Every 5xx return increments the AD-15 webhook-failure alarm metric.
- **Add an AD-16 gate:** an induced `version_conflict` mid-event results in the event being
  applied (after retry) or Stripe retrying successfully — never in a 2xx with no entitlement
  change.

---

## H4 — AD-5's write vs AD-9's signing: ordering contradicts the spine's own diagram [HIGH]

### The permitting AD text

> **AD-9:** "**Signed on write, not on read.** The webhook **signs once per entitlement change and
> stores the statement in the `ENTITLEMENT` item**; `GET /entitlement` returns the stored string
> and **re-signs when it is at or near expiry**."

> **AD-4:** "`sk = ENTITLEMENT` — … **the cached signed statement and its `exp`** …"

But the spine's own sequence diagram (line 395) specifies the opposite order:

> `B->>T: write ENTITLEMENT + BILLING_CUSTOMER, sign statement`

Write, **then** sign. AD-9 says sign, then store. The spine contains both orderings and marks
neither as normative.

### The incompatible pair

**Unit A — "Story: converge and persist the entitlement."** Implements the sequence diagram: one
conditional `PutItem` of `tier`/`capabilities[]`/`status`/`current_period_end`/`event_watermark`/
`version`, then `kms:Sign`, then a second conditional write attaching `statement` and
`statement_exp`. Obeys AD-5, AD-4 and AD-9's "stores the statement in the `ENTITLEMENT` item".

**Unit B — "Story: sign on entitlement change" (`lib/signing.ts`).** Implements AD-9's phrasing:
`kms:Sign` first, then one conditional `PutItem` carrying the derived fields **and** the statement
together. Also obeys AD-5, AD-4 and AD-9.

### The concrete divergence

**Unit A admits a statement-less `ENTITLEMENT` as a durably committed state.** A `kms:Sign`
throttle, a disabled key, or an IAM gap between the two writes leaves `tier = advance`,
`capabilities = [...]`, `version` bumped, `event_watermark` advanced — and **no statement and no
`exp`**. Three things then go wrong, each individually compliant:

1. **It is unrecoverable by retry.** The watermark advanced and (per H3) the marker may be
   durable, so AD-5 makes Stripe's retry a no-op. Nothing re-signs except a lazy
   `GET /entitlement`.
2. **No AD defines reading it.** AD-9 covers "at or near expiry" and covers "an **absent**
   `ENTITLEMENT` record" (the free case). It says nothing about **a present record with an absent
   statement**. Three compliant `GET /entitlement` behaviours exist: treat absent as "at or near
   expiry" and re-sign; return the entitlement with `statement: null`; return `unavailable`. The
   second breaks any AD-13 client that requires a statement to gate (AD-10: "Device-run
   capabilities gate on the AD-9 statement"), so a **paying** subscriber's sync freezes. The third
   makes a paying subscriber look unreachable.
3. **The direct-read consumer sees a valid paid entitlement** (AD-4: "the bedrock role is
   read-only"; AD-10: "the hosted-AI Lambda reads the entitlement itself"), while the statement-
   reading desktop sees nothing. One account, two answers — the precise failure AD-2 exists to
   prevent ("Two answers to 'is this account entitled'"). See also H7.

The reverse ordering has a milder twin: in Unit B a successful `kms:Sign` followed by a failed
`PutItem` yields a **validly signed statement for a tier that was never committed**. AD-9 has no
rule forbidding its return, and a handler on a best-effort path could hand it to the caller,
granting capabilities the authority never recorded.

### New/tightened AD

**Amend AD-9** to make the write atomic and the state space closed:

- **Sign, then commit once.** The statement and the entitlement fields it describes are written in
  **one** item write, inside the H3 transaction. A `kms:Sign` failure means **no commit**: return
  5xx, write no `EVENT#` marker, do not advance `event_watermark`.
- Declare `statement == null` (or `statement_exp == null`) on a **present** `ENTITLEMENT` an
  **invalid persisted state**. Delete the normative sequence-diagram line that implies two writes,
  or correct it to a single transaction.
- `GET /entitlement` re-signs when the stored statement is absent **or** at/near expiry — state
  "absent" explicitly.
- A signed statement whose commit did not succeed is **never returned** to any caller.
- **Add AD-16 gates:** an induced `kms:Sign` failure leaves the entitlement unchanged and fires
  the webhook-failure alarm; and no code path returns an `ENTITLEMENT` with a null statement.

---

## H5 — `exp = min(current_period_end, now + 24h)` is undefined for FREE; the revalidation trigger is unowned [HIGH]

### The permitting AD text

> **AD-9:** "**`exp` = `min(current_period_end, now + 24 h)`.** A cancellation can never be
> outlived by a statement signed before it."

> **AD-9:** "**A free account still receives a signed statement** with an empty capability list,
> **derived from an absent `ENTITLEMENT` record with no write.** This is what lets a client
> distinguish *verified free* from *could not reach the server*."

> **AD-4:** `sk = ENTITLEMENT` holds "… `current_period_end` …" — so for a free account, with no
> record at all, **`current_period_end` does not exist.**

> **Conventions:** "`current_period_end` and statement `exp` as **epoch seconds**"; "absent =
> `null`, never `\"\"`".

`min(null, now + 86400)` is undefined by the spine and **`0` in JavaScript**
(`Math.min(null, X) === 0`).

### Incompatible pair 5a — the FREE statement's `exp`

**Unit A — "Story: issue a signed statement for a free account."** Implements AD-9's free clause:
no record → `tier = free`, `capabilities = []`, and since there is no period bound, `exp = now +
24h`. Obeys AD-9.

**Unit B — "Story: statement `exp` policy" (`lib/signing.ts` — the Structural Seed assigns it
"KMS sign + exp policy").** Implements the formula literally in the one place that owns it, with
`current_period_end` typed per the conventions as epoch seconds, absent = `null`. Obeys AD-9.

**Divergence:** Unit B emits `exp = 0` — **every free statement is born expired.** AD-9 then
applies: "A statement that is expired … grants **nothing**", and "Verification is offline, local
and fails closed." Capability-wise that is harmless (free grants nothing anyway), which is exactly
why it will not be noticed — but it **destroys the stated reason the free statement exists**: an
expired statement is indistinguishable from no statement, so the desktop can no longer tell
*verified free* from *could not reach the server*, and D2's upgrade-invitation-vs-transient
distinction collapses.

AD-16's gate does not catch it: "A free account receives a **verifiable** statement with no
capabilities." A signature check alone satisfies "verifiable"; the gate never asserts
*unexpired*.

### Incompatible pair 5b — the revalidation trigger

> **AD-9:** "Revalidation happens on **app start**, on **sign-in**, and on **the existing
> hosted-status cache TTL**."

That third trigger is a constant in another spine's module:
`apps/desktop/src-tauri/src/ai/hosted_state.rs:16` — `const CACHE_TTL: Duration = Duration::from_secs(300)` (5 minutes) — and AD-2 is **simultaneously rewiring** the thing that populates it ("`GET /v1/ai/status` sources entitlement from the authority").

**Unit C — "Story: statement cache and revalidation triggers."** Binds the statement refresh to
AD-9's three triggers literally, including the 300 s hosted-status TTL. Obeys AD-9.

**Unit D — "Story: desktop capability gate."** Verifies the cached statement locally before each
operation and fails closed (AD-9, AD-10), with no proactive refresh — the spine's **Deferred**
section explicitly blesses this: "**Proactive entitlement push.** Consumers poll or revalidate on
start and sign-in. A push or an invalidation channel is unnecessary at this scale." Obeys AD-9,
AD-10, AD-11.

**Divergences:**

1. **Unit D freezes a paying, online subscriber.** A device left running past 24 h with no restart
   and no sign-in has an expired statement. AD-9: expired "grants nothing". AD-11: absent
   capability → Frozen. sync AD-14: "checked before **every** network operation". So sync stops
   dead while the user is online and paid, with no recovery path short of an app restart. No AD
   says "an expired statement on an online device triggers a refresh rather than a freeze".
2. **Unit C is chatty against a budget the spine fixes.** A 300 s refresh is ~288
   `GET /entitlement` calls per device per day, against AD-15's "**$10/month budget** with
   80%/100% alerts" and an API-wide "**stage throttle**" — and it makes the statement's own 24 h
   `exp` meaningless, defeating B4's "one KMS call per entitlement change instead of per request"
   rationale once re-signing near expiry is factored in.
3. **The refresh cadence (300 s) and the artifact's lifetime (24 h) are owned by different
   spines**, so neither implementer can reason about the pair.

### New/tightened AD

**Amend AD-9:**

- State the FREE case arithmetic explicitly: **an absent `current_period_end` is "no period
  bound", not zero** — `exp = now + 24 h`. Forbid treating `null`/absent as a numeric operand.
- Require `exp > iat` as a **signing precondition**: `lib/signing.ts` refuses to sign a statement
  whose `exp` is not strictly in the future.
- Replace "the existing hosted-status cache TTL" with a trigger the billing spine owns: the
  desktop refreshes at **`exp` minus a stated margin whenever the device is online**, plus app
  start and sign-in. State a maximum revalidation interval (e.g. 1 h) strictly below `exp`, and
  state that an **expired statement on an online device is a refresh trigger, not a freeze**;
  Frozen is entered only when refresh fails.
- **Add AD-16 gates:** a free account's statement is verifiable **and unexpired**, asserted on
  both the TS and Rust sides; and a device online continuously past `exp` retains its capabilities
  without an app restart.

---

## H6 — AD-6 permits a Product with absent or malformed capability metadata [HIGH]

### The permitting AD text

> **AD-6:** "Tier identity comes from Stripe **Product `metadata.nixus_tier`**. The per-tier
> capability list comes from Stripe Product metadata."

> **AD-6:** "Every capability name arriving from Stripe metadata is **validated against the AD-1
> compile-time union**. An **unknown name** is dropped and logged at warning level; it never
> reaches an entitlement."

> **AD-6:** "A new tier reusing existing capabilities is a Product plus a Price plus metadata,
> **with no deploy**." — i.e. operators create Products by hand in the Dashboard.

> **AD-1:** "A capability **may be granted before any code consumes it.**"

AD-6 defines only the **per-name** drop rule. It defines nothing for: absent capability metadata
entirely; a key typo so every name is dropped; absent `metadata.nixus_tier`. And AD-1 makes a
sparse capability list **legitimate**, so "empty" is indistinguishable from "misconfigured".

### The incompatible pair

**Unit A — "Story: derive an entitlement from a Stripe subscription" (`lib/entitlement.ts`).**
Applies the AD-6 drop rule per name; an empty result is an empty `capabilities[]`; writes
`status = active`, `tier = <metadata.nixus_tier>`. Obeys AD-6 and AD-1.

**Unit B — "Story: catalog validation."** Reads AD-6's "**it never reaches an entitlement**" plus
AD-5's "An unrecognised event type is acknowledged and logged, never an error" and treats a
Product with zero valid capability names as a misconfiguration: refuses to write the entitlement,
logs, returns 2xx. Also obeys AD-6 and AD-5.

### The concrete divergence

An operator adds the new tier AD-6 promises costs no deploy, and mistypes the metadata key
(`nixus_capabilties`). The subscriber pays.

- **Unit A** writes a **paid entitlement granting nothing.** AD-12 then correctly renders "your
  plan does not include this capability" with an upgrade CTA — telling a customer who just paid
  $19.99 to upgrade. The state is silently self-consistent; nothing alarms (AD-6's drop is
  "warning level", and with a mistyped **key** there are no names to warn about at all).
- **Unit B** leaves the subscriber **free** while Stripe charges them. If the `EVENT#` marker is
  already durable (H3), the event is deduped forever and the only repair is a manual admin
  override — the very path AD-2 was written to retire.

Two mutually exclusive terminal entitlements for one Stripe state, both AD-compliant.

Second divergence: **absent `metadata.nixus_tier`.** `tier` becomes `null` or `""`, violating the
conventions ("`tier` an opaque lowercase string"; "absent = `null`, never `\"\"`") — but AD-13
says a client "may display but never compare" `tier`, so the account app and pricing surface
render a **blank plan name with no error**, and AD-16's tier-model gates all exercise named tiers.

Third: `GET /plans` has no corresponding validation ("`GET /plans` returns the public catalog …
read from Stripe and cached"), so an unsellable, capability-less Product is **advertised** on
`/pricing` and purchasable before anyone notices.

### New/tightened AD

**Amend AD-6** with a defined invalid-catalog terminal:

- Name the metadata keys normatively (`nixus_tier`, `nixus_capabilities`) in the Consistency
  Conventions so a typo is a known failure rather than an unknown shape.
- A Product reaching the webhook with **absent `nixus_tier`**, or with **zero valid capability
  names after validation**, is a **hard failure**: do not write the `ENTITLEMENT`, do not advance
  `event_watermark`, write **no** `EVENT#` marker, return 5xx, and fire the AD-15 webhook-failure
  alarm. Distinguish this from AD-1's legitimate sparse list by requiring the metadata key to be
  **present and non-empty** — presence, not content, is the validity test.
- `GET /plans` **omits** any Product failing the same validation, so an unsellable plan is never
  advertised, and reports the omission as a warning metric.
- **Add AD-16 operability gates:** a Product with a mistyped capability key is refused at webhook
  time and absent from `/plans`; a Product with no `nixus_tier` is refused at both.

---

## H7 — The canonical server-side read path is not pinned [HIGH]

### The permitting AD text

> **AD-2:** "The `ENTITLEMENT` record in the billing table is the sole authority. Every consumer
> reads it, **directly or through a statement derived from it**."

> **AD-10:** "**Cloud-run capabilities gate on the server.** The hosted-AI Lambda **reads the
> entitlement itself** and refuses an unentitled request."

> **AD-4:** "IAM: … **the bedrock role is read-only and only on this table**."

> **AD-9:** "The stored statement is a **cache, never the authority**."

AD-2 blesses **both** representations for any consumer. AD-9 demotes the statement but AD-4
stores it on the same item the bedrock role can read.

### The incompatible pair

**Unit A — "Story: hosted AI gates on the entitlement item."** The bedrock Lambda `GetItem`s
`USER#<sub>/ENTITLEMENT` with `ConsistentRead: true` — matching the existing convention in
`apps/api-bedrock/src/lib/table.ts` ("Eventually consistent reads would let a just-refunded or
just-reserved unit go missing") — and reads `capabilities[]` directly. Obeys AD-10 and AD-4.

**Unit B — "Story: hosted AI gates on the signed statement."** The bedrock Lambda reads the
**stored statement** from the same item and verifies it, because AD-2 explicitly permits "through
a statement derived from it", AD-9 already makes the statement the gating artifact for the other
consumer, and reusing one verifier across TS and Rust is the obvious DRY move under AD-13's
parity-test regime. The statement is `sub`-bound, so it also re-proves the caller. Obeys AD-2,
AD-9, AD-10, AD-13.

### The concrete divergence

**Two consumers derive capabilities from two representations of one item, with different staleness
and opposite failure modes.**

- **Unit B grants after cancellation.** AD-9's re-sign trigger is **lazy and on the wrong route**:
  "`GET /entitlement` returns the stored string and **re-signs when it is at or near expiry**."
  Nothing requires the webhook to re-sign when `capabilities[]` changes, and the bedrock Lambda
  never calls `GET /entitlement`. So after a cancellation converges, the stored statement can
  still carry `hosted_ai` for **up to 24 h**, and Unit B honours it. AD-9's claim — "A cancellation
  can never be outlived by a statement signed before it" — holds for the `exp` **bound** but not
  for the **stored cache**, which is exactly the artifact Unit B reads.
- **Unit B refuses a paying subscriber.** Conversely, any case where the stored statement is
  absent or stale (H4) refuses hosted AI to a committed paid entitlement that Unit A would accept.
- **The states diverge by read mode too.** Unit A with `ConsistentRead: true` and Unit B reading a
  statement cached up to 24 h disagree for the whole window; `GET /v1/ai/status` (AD-2: "sources
  entitlement from the authority") can report a third answer depending on which it uses.

**Secondary, citable:** AD-4 grants bedrock read-only "**and only on this table**" — table-wide.
The spine's own AD-4 rationale proves this cannot be narrowed: "DynamoDB exposes **no IAM
condition key for a sort key**, so sort-key isolation is achievable only by code construction."
So the bedrock role can also read every `BILLING_CUSTOMER` item — holding `stripe_customer_id` and
`stripe_subscription_id`, which AD-14 forbids logging — and every `EVENT#` item. INVESTIGATION §8
assumed the narrower grant ("the bedrock role read-only on `ENTITLEMENT`"); AD-4 widened it
without noting that AD-16's gate ("IAM isolation in all three directions (AD-4), asserted by CI")
therefore cannot assert what the investigation intended.

### New/tightened AD

**Amend AD-2 and AD-10** to pin one canonical read path per consumer class:

- **Server-side consumers read the `ENTITLEMENT` attributes with `ConsistentRead: true`.** Deriving
  capabilities from the **stored statement** is **forbidden** for any server-side consumer. Remove
  AD-2's "directly or through a statement derived from it" ambiguity by scoping the statement path
  to **device-run** gating only (AD-10 already draws that line; AD-2 must stop contradicting it).
- Require the webhook to **re-sign (or null) the stored statement in the same write that changes
  `capabilities[]`, `tier` or `status`** — tying the cache's lifetime to the authority's, not to
  `exp` alone.
- **Tighten AD-4's IAM note:** state that the bedrock role's read is table-wide **by DynamoDB
  limitation**, that `BILLING_CUSTOMER` and `EVENT#` are therefore reachable by it, and that the
  isolation is enforced **by code construction in one module** (as AD-4 already requires for key
  composition) plus an `AD-14`-scoped CI guard that no `api-bedrock` code path reads a non-
  `ENTITLEMENT` sort key. Correct AD-16's gate wording to match what CI can actually assert.
- **Add AD-16 gates:** a cancelled entitlement is refused by hosted AI **immediately**, not after
  `exp`; and a CI guard that no server-side consumer verifies a statement.

---

## H8 — AD-11's "relink on re-entitlement" has no owning component [CRITICAL]

### The permitting AD text

> **AD-11:** "**Regaining `multi_device_sync` after a freeze is a relink, not a resume.** It
> re-enters the sync spine's existing link decision (load the cloud copy, keeping a dated local
> backup, or publish local over the cloud copy). **No new UX and no new merge path.**"

> **AD-10:** "The tier→capability projection lives in `entitlements.rs` and **nothing in `sync/**`
> changes** (sync AD-14)."

The inherited text says the opposite of AD-11:

> **sync AD-14** (inherited verbatim in the Inherited Invariants table): "… **regaining the flag
> resumes sync.**"

AD-11 reverses an inherited invariant with **no declared departure** — contrast AD-4, which
declares one. And no AD names which component detects the frozen→entitled **edge**.

### The incompatible pair

**Unit A — "Story: relink on re-entitlement, detected in `entitlements.rs`."** `entitlements.rs`
compares the newly verified statement's `capabilities[]` against the previously cached set and
emits a re-entitled signal; the UI raises the existing link decision. Obeys AD-10 ("the
projection lives in `entitlements.rs`"), AD-11, and leaves `sync/**` untouched.

**Unit B — "Story: relink on re-entitlement, detected from sync state."** The sync manager already
owns `sync_state` (sync AD-15: "the manager writes `sync_state`"), the `frozen` status (sync
AD-16's state list includes `frozen`) and the link decision itself (sync AD-9). So the transition
is detected where the state lives: manager sees `Frozen` **and** capability now present →
re-enters the link decision. Obeys AD-11 ("re-enters the sync spine's **existing** link
decision"), sync AD-14's "resumes sync", sync AD-15 and sync AD-16.

### The concrete divergence

1. **Unit B is forbidden by AD-10** ("nothing in `sync/**` changes") — yet it is the only place
   that actually knows a freeze happened. **Unit A is compliant and wrong**; Unit B is correct and
   non-compliant. Neither implementer can be both.
2. **Unit A's edge detection rests on an unspecified artifact.** The Structural Seed names
   `<statement cache>` — "on-disk cached statement" — with **no specified contents, retention, or
   clearing rule**. Detecting a *transition* requires persisting the **previous** capability set,
   which nothing authorises. Worse, two existing rules clear it: the Consistency Conventions say
   "billing query keys share a `billing` prefix and are **removed on identity change**", and
   `hosted_bedrock.rs` already calls `hosted_state::clear()` on identity change. If the cache is
   cleared, **every sign-in looks like a first link**, so Unit A raises the link decision on an
   ordinary sign-in of a continuously-entitled device.
3. **That prompt is destructive.** One of its two branches is "publish local over the cloud copy"
   (AD-11). A user who picks wrong on a spurious prompt overwrites the cloud copy of their other
   computers' data. AD-11's Prevents clause claims the opposite ("a billing event deleting user
   data"), but AD-11 only forbids billing-**triggered deletes**, not a billing-triggered **prompt**
   whose branch deletes.
4. **If both stories ship**, there are **two triggers for one link decision** against one dataset
   — raised twice, or raced, with two different answers possible.

### New/tightened AD

**Amend AD-11** to name the owner, the edge and the departure:

- **Declare the departure from `sync AD-14`'s "regaining the flag resumes sync"** explicitly, with
  the reason of record already in INVESTIGATION §4.3 (no common recent ancestor → an incremental
  resume is unsound). Add `sync AD-14`'s resume clause to the Inherited Invariants table as
  superseded.
- **Pin the owner:** `entitlements.rs` is the **sole** emitter of a `capability_regained` signal.
  `sync/**` consumes the signal; it never detects the edge. This keeps AD-10 intact.
- **Specify the statement cache as the edge's substrate:** it persists
  `last_verified_capabilities` **per `sub`**, is **not** cleared when the same `sub` signs in
  again (only on `sub` change or explicit sign-out), and is covered by the AD-13 contract.
- **A missing previous value is `unknown`, never `regained`.** An `unknown`→entitled transition
  must **not** raise the link decision; only a recorded `frozen`→`entitled` edge may. Fail closed
  toward *not prompting*, because the prompt's branch is destructive.
- **Add AD-16 gates:** signing in on a continuously-entitled device raises **no** link decision;
  a genuine frozen→entitled transition raises **exactly one**; and a guard that no file under
  `sync/**` reads a capability set directly.

---

## H9 — AD-12 narrows `premium_required`'s meaning without pinning its carrier [HIGH]

### The permitting AD text

> **AD-12:** "`premium_required` **keeps its wire name** (profile AD-13 additive-only evolution)
> and **narrows in meaning** to 'your plan does not include this capability'."

> **AD-13:** "A capability name a client does not recognise is ignored; an unknown error code maps
> to `unavailable`. **Evolution is additive only**, so a new tier needs no client release."

> **AD-13:** error union includes **both** `unauthorized` and `premium_required`.

AD-12 changes a **meaning** while AD-13 guarantees clients need **no release**. The existing code
already overloads the code three ways:

- `home_surface.rs:64` — `HostedEligibility::SignedOut | HostedEligibility::NotPremium` → both map
  to `"premium_required"`.
- `hosted_bedrock.rs:607` — `403 => "premium_required"`, where 403 is also what an API Gateway
  Cognito authorizer returns on a **scope** failure — and AD-3 adds a brand-new required scope
  (`nixus-api/billing`), which AD-16 explicitly gates on ("billing routes reject a token lacking
  `nixus-api/billing`").

### The incompatible pair

**Unit C — "Story: ship the narrowed server semantics."** Server-side only. Emits
`premium_required` solely for "the entitlement does not grant `<capability>`". No client release
is required, because AD-13 guarantees additive-only evolution and `premium_required` is not a new
code. Obeys AD-12 and AD-13.

**Unit D — "Story: desktop renders the narrowed refusal."** Keeps
`code_for_status(403) => "premium_required"` and the `SignedOut | NotPremium` arm untouched — both
still produce a code in the AD-13 union and still use the kept wire name (AD-12) — and adds the
AD-12 upgrade routing: "routes free and lower-tier accounts to an **upgrade** rather than reading
as an error." Obeys AD-12 and AD-13.

### The concrete divergence

With C and D both deployed and both compliant:

1. **A paying subscriber is asked to buy the plan they already own.** Any 403 that is really an
   **authorization** failure — an expired token, or a token minted before `nixus-api/billing`
   joined `COGNITO_SCOPES` (the realistic state of every client built before this change, and
   precisely the condition AD-16's scope test creates) — renders as "your plan does not include
   this capability" **with an upgrade CTA pointing at Checkout**. An Advance subscriber is routed
   to pay again. AD-12's Prevents clause names this failure ("Telling a paying subscriber they
   need premium") and AD-12's own rule does not prevent it, because it never pins the **status
   code** that carries the narrowed meaning.
2. **The `SignedOut` arm keeps the old lie.** A signed-out user still receives
   `premium_required`, so "one error code meaning two different facts" — AD-12's second Prevents
   item — survives AD-12 verbatim, since AD-12 only redefines the *meaning* and AD-13's
   additive-only rule actively licenses leaving the mapping in place.
3. **AD-16's gate does not catch either.** It asserts "A Classic subscriber denied an AI surface is
   **never** told they need premium" — a *copy* assertion about the capability-denial path. It says
   nothing about a scope failure or a signed-out user rendering as an upgrade prompt.

Two clients — one built before C, one after — both obey AD-13 and **disagree about what
`premium_required` means**, which is the exact outcome AD-13's additive-only rule was supposed to
make impossible.

### New/tightened AD

**Amend AD-12 and AD-13** to pin the carrier, not just the meaning:

- **Pin the status→code mapping normatively:** `401` and any authorizer/scope failure →
  `unauthorized` (or `reauthentication_required`); **`403` is reserved exclusively for capability
  denial.** State that AD-13's `GatewayResponses` must emit `unauthorized` for
  `ACCESS_DENIED`/`UNAUTHORIZED`/`AUTHORIZER_FAILURE` — AD-13 currently requires the *envelope*
  but never says **which code per rejection class**.
- **Require `premium_required` to carry the capability name** (e.g. `capability: "hosted_ai"`) as
  an additive field. A refusal with no capability name is not a capability denial and must not
  render an upgrade CTA. This makes the narrowing *detectable by an old client* rather than purely
  semantic.
- **Split the `SignedOut` arm** out of `premium_required` into `unauthorized`/
  `reauthentication_required` as a required change, not an optional one.
- **Add AD-16 gates:** a token lacking `nixus-api/billing` renders as re-authentication and
  **never** as an upgrade prompt; a signed-out user is never shown an upgrade prompt; and a
  `premium_required` with no `capability` field fails the contract test on both the TS and Rust
  sides.

---

## H10 — `GET /plans` TTL is unowned; price drift is unbounded [HIGH]

### The permitting AD text

> **AD-3:** "`GET /plans` (public catalog, no user data, **cacheable**)."

> **AD-6:** "`GET /plans` returns the public catalog (tier, lookup_key, amount, currency,
> interval, display order) **read from Stripe and cached**."

> **AD-6 — Prevents:** "… **a drift between the advertised price and the charged price** …"

> **AD-6:** "Prices are referenced **only by `lookup_key`** … A price change is a new Price with
> `transfer_lookup_key: true`."

> **AD-16:** "Pricing copy states a CAD list price, shown in the visitor's currency at checkout,
> **tax included**."

Two ADs say "cached"/"cacheable" and **neither names a cache layer, a TTL, or an owner.** At least
four layers are available and the spine blesses stacking them: the Lambda's warm container (AD-7's
"read at cold start" idiom), an API Gateway stage cache (AD-15 configures a "stage throttle" on
the same stage), a CDN (INVESTIGATION §5.2: "CloudFront-cached"), the browser via `Cache-Control`,
and `apps/web`'s **baked static copy** (AD-6/B6: the marketing site "ships baked copy as a
fallback and hydrates over it").

### The incompatible pair

**Unit A — "Story: `GET /plans` returns the Stripe catalog, cached."** Caches the Stripe read in
module scope for the container lifetime and sets `Cache-Control: public, max-age=3600`. Obeys
AD-3 ("cacheable") and AD-6 ("cached"), carries no user data and no `price_id`.

**Unit B — "Story: the pricing page hydrates live prices over baked copy."** `apps/web` ships
baked CAD amounts (required by AD-16's legal gate) and hydrates from `/plans`; the static bundle is
CDN-cached on its own independent schedule. Obeys AD-6 and AD-16.

### The concrete divergence

An operator performs the AD-6 price change the spine promises costs no deploy.
`POST /checkout` resolves the `lookup_key` **live** — AD-6 states no caching rule for checkout, and
AD-8 creates a session "server-side per attempt" — so the **charged** price changes **instantly**.
Meanwhile:

- `/plans` serves the old amount for up to `max-age` × (stacked layers). With a Lambda container
  cache **and** a 1 h `Cache-Control` **and** a CDN, the effective staleness is the **sum**, not the
  maximum, and no AD bounds it.
- `apps/web`'s baked fallback serves the old amount **indefinitely** whenever the hydrate fails
  (offline, throttled by AD-15's stage throttle, or CORS-blocked), with no staleness signal.

So the advertised price and the charged price disagree for an **unbounded** window — the precise
drift AD-6's Prevents clause names as the thing it prevents. Given AD-16's legal gate pins the
advertised CAD list price as a **tax-included commitment**, a visitor can be shown $9.99 and
charged $12.99 on the next screen, with the mismatch invisible to Nixus. Neither unit is wrong;
there is simply no owner.

A second divergence: nothing says `/plans` and `POST /checkout` must resolve from the **same**
snapshot, so even with a bounded TTL the two can disagree within one user session.

### New/tightened AD

**Amend AD-6** to pin one cache layer and bound the drift:

- **One cache, one TTL, stated numerically.** `GET /plans` is the **only** caching layer for the
  catalog: a short response cache (e.g. `Cache-Control: public, max-age=300,
  stale-while-revalidate=60`). **Forbid stacking** an API Gateway stage cache or a CDN cache on
  `/plans`, and forbid a container-lifetime cache longer than the stated TTL.
- **Bind checkout to the advertised amount.** `POST /checkout` returns the **resolved** amount and
  currency alongside the `url`; the surface must compare it to what it displayed and re-render
  rather than redirect on a mismatch. This makes the drift detectable at the only moment it
  matters.
- **The baked fallback may never render as a live price.** `apps/web` either labels it
  explicitly as indicative or renders a loading state until `/plans` answers. State this in AD-16's
  legal gate, since the tax-included CAD claim is a legal commitment.
- **Add AD-16 gates:** the drift window is bounded and asserted (a price change in test mode is
  reflected in `/plans` within the stated TTL); and a checkout whose resolved amount differs from
  the advertised amount is refused by the surface rather than redirected.

---

## H11 — Per-tier `monthly_request_limit` has two homes and no owner [HIGH]

### The permitting AD text

> **AD-2:** "`HostedAiTable`'s `premium` attribute is **retired**. That table keeps quota counters
> (`USAGE#<period>`, `GLOBAL`) **only**, and `GET /v1/ai/status` sources entitlement from the
> authority."

> **AD-4:** `sk = ENTITLEMENT` — "`tier`, `capabilities[]`, `status`, `current_period_end`,
> `source` …, the cached signed statement and its `exp`, `event_watermark`, server-owned
> `version`, `created_at`, `updated_at`." — **no `monthly_request_limit`.**

> **AD-1:** "A gate may test only a **capability**." — so the *limit* cannot be a capability.

> **AD-6:** governs `lookup_key`, `metadata.nixus_tier` and capability names **only** — it never
> authorises a numeric field in Stripe metadata.

INVESTIGATION **B10** recommended "Per-tier, **read from the entitlement**" but was never promoted
to a `D`-decision and **never landed in any AD**. So the spine deletes the field's current home and
names no new one.

### The code reality AD-2 collides with

- `apps/api-bedrock/src/lib/table.ts:56-58` — `UserConfig { premium: boolean; monthly_request_limit: number }`, living on `USER#<sub>/CONFIG` — a sort key **AD-2 does not list as surviving**.
- `table.ts:105` — `if (item.premium !== true) return undefined;`
- `quota.ts:144-157` — a `TransactWriteItems` **ConditionCheck** on that item:
  `"#premium = :premium AND #monthly_request_limit = :monthly_request_limit"` with `":premium": true`.

Retiring `premium` makes that `ConditionCheck` **unsatisfiable** and `parseUserConfig` return
`undefined` — whose documented meaning is "not entitled" ("A malformed record is
indistinguishable from an absent one on the enforcement path: both mean 'not entitled'"). So
**every hosted-AI request fails closed** the moment AD-2 lands, for every user including Advance
subscribers.

### The incompatible pair

**Unit A — "Story: retire `HostedAiTable.premium`."** Deletes `premium` from `UserConfig`, keeps
`USER#<sub>/CONFIG` as the home of `monthly_request_limit`, sources capabilities from the billing
table, and narrows the `ConditionCheck` to `monthly_request_limit` alone. Defensible: AD-2 says the
table "keeps quota counters", and a per-user limit is quota configuration.

**Unit B — "Story: per-tier hosted-AI quota from the entitlement."** Reads AD-2's "`USAGE#<period>`,
`GLOBAL`) **only**" literally — which **deletes** `USER#<sub>/CONFIG` — and AD-1's "a tier is a
label", concluding the limit must derive from the entitlement. Adds `monthly_request_limit` to the
`ENTITLEMENT` item and drops the per-user config row and its `ConditionCheck` entirely.

### The concrete divergence

1. **Two owners of one field.** If both ship, the limit exists in two tables with **no precedence
   rule**. Unit A's `ConditionCheck` guards a value Unit B no longer updates, so a tier change
   silently fails to change the enforced limit — or, worse, the ConditionCheck passes against the
   stale `HostedAiTable` value while the reservation is **sized** from the entitlement's new value,
   letting a downgraded user keep Advance's quota for the remainder of the period. `quota.ts`'s
   `config_changed` outcome (the mechanism that exists to catch exactly this) becomes
   non-functional, because it checks the wrong table.
2. **Unit B has no legal write path for the number.** The `ENTITLEMENT` item's only writers are the
   webhook and the admin override (AD-2). The webhook derives everything from Stripe (AD-5), and
   AD-6 authorises **only** `nixus_tier` and capability names in metadata — a numeric limit is
   neither, and AD-1 forbids making it a capability. So changing a quota becomes either an
   unauthorised Stripe metadata field or an admin-override-only operation.
3. **Unit A re-creates the defect the spine exists to kill.** A per-user, operator-seeded row
   remains the real entitlement lever — the same hand-written `put-item` shape AD-2 and D1 retire
   ("Keeping it recreates the two-sources-of-truth defect this spine exists to fix").
4. **The break is certain, not hypothetical, and ungated.** AD-16's list contains no hosted-AI
   quota regression test. Its only adjacent gate is "After deploy, `GET /v1/ai/status` and
   `GET /v1/profile` still reach their existing stacks" — a **routing** assertion that passes while
   every hosted-AI request is being refused.

### New/tightened AD

**Amend AD-2** (and add the field to AD-4's enumeration **or** forbid it there explicitly) to pin
one owner. Recommended owner: **neither table — derive it in code.**

- The per-tier limit is a **compile-time table in `api-bedrock`**, keyed off `capabilities[]`/
  `tier`, mirroring AD-1's closed-union discipline. No operator and no Stripe field owns a number,
  so a quota change costs one release — the same price AD-1 already sets for a new capability.
- State that **`HostedAiTable` keeps `USAGE#<period>` and `GLOBAL` only**, and that
  `USER#<sub>/CONFIG` is **removed** — making Unit A non-compliant and ending the two-homes
  ambiguity.
- Specify the replacement concurrency guard: `quota.ts`'s per-user `ConditionCheck` is replaced by
  a `ConditionCheck` on the `GLOBAL` item plus the **derived** limit, preserving the existing
  `config_changed` semantics.
- Name the migration ordering explicitly: the `:premium = true` ConditionCheck and
  `parseUserConfig`'s `premium` test must be removed **in the same release** that retires the
  attribute, never after.
- **Add AD-16 gates:** a Classic→Advance transition changes the **enforced** limit; a downgrade
  changes it at period end; an Advance subscriber is not refused hosted AI after `premium` is
  retired (the regression test the current gate list lacks).

---

## H12 — `POST /checkout` is "per attempt" with no idempotency [CRITICAL]

### The permitting AD text

> **AD-8:** "A Checkout Session is created **server-side per attempt** and carries
> `client_reference_id` plus `subscription_data.metadata` identifying the `sub`, so the linkage
> survives on the `Subscription` and appears on every later event."

> **AD-4:** "`sk = BILLING_CUSTOMER` — `stripe_customer_id`, **`stripe_subscription_id`**,
> `price_lookup_key`." — **singular.**

> **AD-5:** "the handler **re-fetches the subscription** from the Stripe API and derives the
> entitlement from that current truth."

> **AD-3:** `POST /checkout` is an ordinary authorized route. **No idempotency, no conditional
> write, no per-user rate limit** is stated; AD-15 provides only an API-wide "stage throttle".

> **AD-11:** "Upgrades and downgrades go through the portal or a server-initiated subscription
> update." — governs *changes*, not duplicate *creations*.

"**Per attempt**" positively **licenses** unlimited concurrent sessions, and Stripe does not prevent
one Customer from holding two active Subscriptions to the same or different Prices.

### The incompatible pair

**Unit A — "Story: `POST /checkout` creates a session per attempt."** Implements AD-8 literally: a
fresh Checkout Session on every call, with `client_reference_id` and metadata. No dedupe, no check
for an existing live subscription, no conditional write to `BILLING_CUSTOMER`. Obeys AD-8, AD-3,
AD-7.

**Unit B — "Story: the webhook converges on the subscription."** On each
`checkout.session.completed` / `customer.subscription.created`, re-fetches **the subscription named
by that event** and writes `BILLING_CUSTOMER.stripe_subscription_id` plus the derived
`ENTITLEMENT`. Obeys AD-5, AD-4, AD-2.

### The concrete divergence

A user double-clicks **Upgrade**, or opens the flow on the desktop (system browser, AD-8) and again
in the account app (303, AD-8), and completes **both**. Two live subscriptions, two distinct
`EVENT#` ids — so AD-5's dedupe does **not** fire, and both events are "relevant" and
watermark-advancing.

- **The single `stripe_subscription_id` slot holds the last writer.** The other subscription is
  **live, billing the customer every month, and invisible to Nixus** — absent from
  `GET /entitlement`, absent from the account app, present only in the Stripe Dashboard and the
  Customer Portal.
- **The entitlement is decided by arrival order, not by what the user paid.** Buys Classic then
  Advance, Advance lands second → entitled Advance, charged for both. Advance lands **first** →
  entitled **Classic**, charged for both. Both are AD-5-compliant convergence.
- **Every subsequent event compounds it.** A `customer.subscription.updated` on the *shadow*
  subscription converges the entitlement onto **its** tier, so cancelling the visible subscription
  can leave the user entitled via the invisible one — or a cancellation of the shadow can downgrade
  a user who is still paying for the visible one.

Nothing in the spine forbids any of this: AD-11's lifecycle state machine has no two-subscription
state, AD-16's gate list has no duplicate-subscription test, and **Deferred** does not mention it.
The exposure is direct double-charging plus the refund/dispute volume that INVESTIGATION §3.1 flags
as the thing that can get Managed Payments **revoked** ("Stripe can revoke Managed Payments on
dispute-rate performance").

### New/tightened AD

**Amend AD-8 and AD-3** to make checkout idempotent and single-subscription:

- **`POST /checkout` reads `BILLING_CUSTOMER` first and refuses when a live subscription exists**,
  routing the caller to the Customer Portal per AD-8's own upgrade/downgrade rule. Add
  `subscription_exists` to AD-13's closed error union (additive, so no client release is forced).
- **Serialise concurrent attempts:** write a short-TTL `CHECKOUT_PENDING` marker conditional on
  `attribute_not_exists`; a second concurrent attempt for the same `sub` is refused rather than
  served. Replace AD-8's "per attempt" with "**per attempt, at most one in flight per `sub`**".
- **Pass a Stripe `Idempotency-Key`** derived from `sub` + `lookup_key` + the pending marker, so a
  retried call cannot mint a second session.
- **Make a second distinct `stripe_subscription_id` a hard alarm, not an overwrite.** AD-4's
  `BILLING_CUSTOMER` write is conditional such that replacing a **different** live
  `stripe_subscription_id` fails, fires the AD-15 webhook-failure alarm, and records both ids
  server-side (AD-14 permits this in CloudWatch, not in a response).
- **Add AD-16 gates:** two concurrent `POST /checkout` calls for one `sub` yield **at most one**
  live subscription; a `POST /checkout` for a `sub` with a live subscription is refused and routed
  to the portal; and a synthetic second subscription raises the alarm instead of silently
  converging.

---

## What the spine gets right

Recorded so the revision does not regress it:

- **AD-1's capability/tier split** is the correct seam and is backed by a real CI guard ("A guard
  asserting that no file outside the capability-projection module compares a `tier` value").
- **AD-5's convergence-over-deltas** choice removes whole classes of ordering bugs; the holes above
  are about *what else* touches the record, not about convergence itself.
- **AD-4's declared departure** from profile AD-4 is exactly the right ritual — and is the model
  the AD-10 (H1) and AD-11 (H8) departures should have followed.
- **AD-7's single-key-holder** rule and **AD-8's Stripe-hosted-only** rule close the PCI and
  credential-sprawl surfaces cleanly; no pair divergence was constructible against either.
- **AD-14's loggable allow-list** (rather than a deny-list) is the robust formulation.

## Severity key

- **Critical** — two compliant builds produce silent money loss, silent user-data loss, or two
  live authorities for one entity, with no release gate catching it.
- **High** — two compliant builds produce divergent observable behaviour, a certain production
  break, or an unbounded window on a stated invariant.
