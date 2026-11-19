---
name: 'Security & Compliance Review — Billing Spine'
type: architecture-review
lens: 'entitlement bypass · webhook & secret handling'
target: 'ARCHITECTURE-SPINE.md (architecture-billing-2026-11-18)'
reviewed: '2026-11-18'
scope_in: 'statement forgery/replay · key handling · webhook route · cross-account authz · secrets · PCI scope'
scope_out: 'tax, legal, privacy law, data retention (owned by another reviewer)'
---

# Security & Compliance Review — Entitlement Bypass, Webhook & Secrets

**Verdict: CHANGES REQUIRED — the paradigm is sound (converge-on-Stripe, webhook-sole-writer, capability-only gates, hosted commerce), but two offline bypasses defeat AD-9's stated guarantee, one authorization invariant is tested in AD-16 yet stated in no AD, and one AD-15 control cannot be implemented as written.**

Every finding below cites spine line numbers or names a specific absence. Absences were
confirmed by grep against `ARCHITECTURE-SPINE.md`: `clock` 0 hits, `nonce` 0, `timing`/`constant-time` 0,
`raw body` 0, `jti` 0, `concurren` 0, `livemode` 0, `keychain`/`DPAPI` 0.

---

## CRITICAL

### C1 — AD-9's `exp` is enforced by an attacker-controlled wall clock

- **AD:** AD-9 (lines 207–212); binding parent invariant profile AD-17.
- **Spine text:** "`exp` = `min(current_period_end, now + 24 h)`. A cancellation can never be
  outlived by a statement signed before it." (line 209) and "Verification is offline, local
  and fails closed." (line 211)
- **Attack:** Subscribe for one period. Capture the statement from the on-disk cache. Cancel
  (or let the card lapse). Set the OS clock back inside the captured `exp` window and stay
  offline. Verification is a signature check plus an `exp` comparison against local time, so the
  statement verifies indefinitely. Repeat forever; no network contact is ever required. On
  macOS and Windows the subscriber is the machine's admin, so this needs no exploit — just
  Date & Time settings. The 24-hour bound, which is the entire mechanism limiting the offline
  window, is a value the attacker chooses.
- **Why it matters beyond the obvious:** the spine does not merely omit a mitigation, it
  **states a guarantee it cannot deliver**. Line 209's "can never be outlived" is false as
  written, and that sentence is what downstream stories will treat as settled.
- **Suggested AD change:** two edits to AD-9.
  1. Add an anti-rollback clause: the desktop persists a monotonic high-water mark —
     `max(seen statement `iat`, last observed server time)` — alongside the cache. Verification
     refuses any statement whose `iat` precedes the high-water mark beyond a stated skew, and
     refuses to grant at all when local time reads earlier than the high-water mark. State the
     skew (e.g. 5 min) as a number in the AD.
  2. Add an explicit **threat model** paragraph: a local administrator who tampers with both
     the cache and the high-water mark can extend their own offline window, and this is
     *accepted* — the statement defends against unsigned-flag flipping, statement sharing
     between accounts, and silent post-cancellation drift, not against the device owner. Say
     so, so that AD-9 stops over-promising and so a later story does not build expensive
     hardening against a threat the spine has decided to accept.
- **Note:** AD-16's statement tests (lines 301–303) test tampered/expired/wrong-`sub`/unknown-`key_id`.
  None of them tests clock rollback. Add it as a gate or explicitly record it as accepted.

### C2 — A retired `key_id` stays valid forever in every already-installed binary

- **AD:** AD-9 (line 207), AD-15 (line 276 "The KMS key has rotation-compatible `key_id` handling").
- **Spine text:** "`key_id` is present from the first release so rotation needs no format change"
  (line 207); "a statement that is … signed by an unknown `key_id` grants **nothing**" (line 211).
- **Attack:** `key_id` is *forward*-compatible only. A binary embeds exactly one public key
  (line 207, singular "the public key is embedded in the desktop binary"). When the signing key
  is rotated — in particular when it is rotated *because it leaked* — the newly shipped binary
  rejects the old `key_id`, but **every previously installed binary still embeds and trusts the
  retired key**. An attacker holding the retired private key mints unlimited valid statements
  for any `sub`, with any `capabilities[]`, with any `exp`, for every device that has not
  updated. There is no revocation path: "Proactive entitlement push" is explicitly Deferred
  (line 436), there is no minimum-version floor anywhere in the spine, and verification is
  offline by design so the server cannot reach the device to say "stop trusting that key."
- **Compounding:** the same single Lambda holds `kms:Sign`, the Stripe secret key and sole write
  access to the entitlement table (AD-7 line 186, AD-4 line 155). One compromise of
  `functions/api.ts` yields sign-anything, and C2 makes that compromise permanent for the
  installed base.
- **Suggested AD change:** AD-9 gains a key-lifecycle clause:
  - The binary embeds a **set** of trusted public keys, each with a `key_id` and a
    `not_after`, not a single key. Rotation ships the new key in release *N* and drops the old
    one in release *N+2*, so overlap is bounded and expressed in the binary.
  - State that the KMS key material is non-exportable and that key *compromise* therefore means
    IAM compromise; scope the Lambda execution role to `kms:Sign` on one key ARN (see M3).
  - Add a server-side **minimum client version** on the authorized `GET /entitlement` response,
    so an online stale binary is told to update even though an offline one cannot be reached.
  - Record the residual honestly: an offline, never-updated binary cannot be revoked. That is
    the cost of offline verification and it should be a written acceptance, not a surprise.

---

## HIGH

### H1 — No AD pins Stripe object lookups to the authenticated `sub`; AD-16 tests an invariant that is never stated

- **AD:** AD-3 (line 140), AD-7 (line 187), AD-8 (lines 197–200). Absence confirmed: grep for
  `customer` returns no pinning language anywhere in AD-7 or AD-8.
- **Spine text:** AD-3 line 140 forbids exactly one thing — "A body- or path-supplied `sub` is
  never honoured." AD-16 line 292 then *tests* "A's token can neither read B's entitlement nor
  open B's portal or checkout session."
- **Attack:** AD-3's prohibition names only `sub`. An implementer reading the spine literally
  can accept a `customer_id`, `subscription_id`, `price_id` or `session_id` in the `POST /portal`
  or `POST /checkout` body and still satisfy every stated rule. `POST /portal` with
  `{"customer_id": "<victim's cus_…>"}` returns a Stripe-hosted Customer Portal URL for the
  victim: card brand and last4, billing address, full invoice history, payment-method
  replacement, and cancellation. That is complete billing-account takeover, reachable with any
  valid Nixus token, and the portal URL works in any browser once minted.
- **Why this is a spine defect and not a code defect:** the release gate exists (AD-16) but the
  invariant it checks does not. A spine's job is the invariant; a test without a rule is a test
  someone deletes when it fails.
- **Suggested AD change:** add to AD-7 (it already owns "only the billing Lambda holds Stripe
  credentials", which is the right home): *"Every Stripe object reference is derived server-side
  from the authenticated `sub` by reading `USER#<sub> / BILLING_CUSTOMER`. No request field on
  any route may name a Stripe customer, subscription, price id, invoice or session id; such a
  field is a `validation` rejection, not an ignored extra. The only request-supplied billing
  values on the whole API are `plan_lookup_key` and an optional promotion code, both validated
  against the catalog (AD-6)."* Then AD-16 line 292 becomes a gate on a stated rule.

### H2 — AD-15's test-mode guarantee cannot be implemented as written, and the natural implementation leaks the secret

- **AD:** AD-15 (line 278), AD-7 (line 186).
- **Spine text:** "**Stripe test mode is the default for every non-production path.** A test-mode
  key can never reach the production stack, and CI asserts it."
- **Why it is unbuildable:** the key lives in SSM `SecureString` and is read at cold start
  (line 186). CI has no sanctioned way to assert a property of that *value* without decrypting
  and reading the secret inside a CI job — which creates exactly the exfiltration path AD-14
  exists to prevent (one `set -x`, one failed assertion that echoes the compared value, and the
  live key is in a GitHub Actions log). So the stated control either does not get built, or gets
  built as a new vulnerability. Separately, `livemode` appears **zero** times in the spine, so
  the cheap runtime check is absent.
- **Attack enabled by the inverse mixup (the realistic direction):** a *live* key in a non-prod
  stack, or a prod stack pointed at the test-mode webhook endpoint. In the latter case the
  production webhook trusts the **test-mode signing secret**, and anyone can create a free
  Stripe test account, trigger test-mode events signed with a secret they now effectively
  control the issuance path for, and drive production entitlement writes. Converge-on-Stripe
  (AD-5 line 164) limits this — the re-fetch uses the production key and would fail — but the
  handler still records `EVENT#` markers and burns writes, and the failure mode is undefined.
- **Suggested AD change:** move the control from CI to runtime, in AD-7:
  *"At cold start the Lambda asserts the loaded Stripe key's mode prefix matches the stage
  (`sk_live_` in production, `sk_test_` elsewhere) and refuses to serve any route if it does
  not — the assertion compares a prefix and never logs the value. Every webhook event is
  rejected unless `event.livemode` matches the stage. The live and test endpoints have separate
  signing secrets in separate SSM parameters."* Then AD-15 line 278 cites that invariant instead
  of claiming a CI assertion.

### H3 — The unauthenticated webhook can deny the authorized routes and reach beyond this stack

- **AD:** AD-3 (line 139), AD-15 (line 277), Deferred (line 440). Absence confirmed:
  `concurren` 0 hits — no reserved concurrency anywhere.
- **Spine text:** "a stage throttle, and a $10/month budget with 80%/100% alerts" (line 277);
  "**WAF on the webhook route.** The stage throttle is API-wide." (line 440)
- **Attack:** `POST /v1/billing/webhook` has no authorizer by design. An attacker with no secret
  cannot forge an entitlement — AD-5 line 162 correctly rejects before any DynamoDB read, which
  is the right ordering — but each request still costs an API Gateway request plus a Lambda
  invocation, and cold starts add two SSM `GetParameter` calls. Three consequences the spine
  does not address:
  1. **The throttle is the DoS.** A stage-wide throttle means saturating the unauthenticated
     webhook route also throttles `POST /checkout`, `POST /portal` and `GET /entitlement`. An
     unauthenticated stranger can stop paying customers from subscribing or from refreshing a
     statement — and per AD-9 a statement that cannot be refreshed eventually expires and grants
     nothing, so this degrades into *entitlement denial for paying users*.
  2. **Blast radius crosses stacks.** With no reserved concurrency on the billing function, the
     webhook path can consume the account's regional Lambda concurrency, which is shared with
     `nixus-bedrock-api` and the profile stack. A billing-route flood becomes a hosted-AI and
     profile outage.
  3. **A budget is not a control.** AWS Budgets at 80%/100% *notify*; they do not stop spend.
     For a solo developer the $10/month line reads as a cap and is not one.
- **Suggested AD change:** AD-15 gains explicit controls, and AD-3 names them as a condition of
  the unauthenticated set: per-route throttles on `POST /webhook` and `GET /plans` (not just a
  stage throttle), **reserved concurrency** on the billing function sized to Stripe's actual
  delivery rate, a maximum request body size on `/webhook`, and one sentence stating that the
  budget is an alert and the throttles plus reserved concurrency are the enforcement. Revisit
  line 440: the deferral reasons "Stripe signature verification is the actual gate," which is
  true for *authenticity* and irrelevant for *cost and availability*.

### H4 — AD-9 never says where the `sub` compared against the statement comes from

- **AD:** AD-9 (line 211).
- **Spine text:** "A statement that is expired, tampered, **bound to another `sub`** … grants
  nothing."
- **Attack:** `sub`-binding is only as strong as the local answer to "what is my `sub`?",
  offline. If that value is read from the same tamperable local store as the statement — a
  cached profile row, a plaintext settings key, a cached ID token treated as data — then an
  attacker sets local `sub` to the victim's and drops in the victim's captured statement. Both
  halves of the comparison are attacker-controlled and the check passes. Note AD-9's companion
  file in the structural seed is an unqualified `<statement cache>  # on-disk cached statement`
  (line 363), with no stated location, permissions or integrity binding.
- **Suggested AD change:** AD-9 states that the comparison `sub` is taken from a
  signature-verified Cognito ID token held in the OS credential store, never from a cached
  profile field or a settings value, and that the statement cache is keyed by that `sub` so a
  substituted statement for a different `sub` is not even loaded. Pair with L1.

### H5 — Free-account statements are signed on every read; AD-9 lines 208 and 210 contradict

- **AD:** AD-9 (lines 208, 210).
- **Spine text:** "**Signed on write, not on read.** The webhook signs once per entitlement
  change and stores the statement" (line 208) versus "**A free account still receives a signed
  statement** with an empty capability list, derived from an absent `ENTITLEMENT` record **with
  no write**" (line 210).
- **Attack / cost:** free accounts have no `ENTITLEMENT` item, therefore no cache slot,
  therefore every `GET /v1/billing/entitlement` from a free account is a fresh `kms:Sign`. Free
  accounts are the majority population and the route is authenticated but — per H3 — not
  per-user throttled. Any single free user can loop the endpoint and drive unbounded KMS
  signing plus API Gateway and Lambda cost against the $10 budget, using nothing but their own
  valid token. The design goal of line 210 (letting a client distinguish *verified free* from
  *could not reach the server*) is right; the mechanism makes the free path the most expensive
  one.
- **Suggested AD change:** make the free statement cheap and shared-shape: sign free statements
  with a **coarse `exp` bucket** (e.g. top of the next hour) so identical bytes are reused, and
  cache them in the Lambda container keyed by `sub` + bucket. Resolve the line 208 / 210
  contradiction explicitly by stating "signed on write for entitled accounts; signed on read,
  bucketed and memoized, for accounts with no `ENTITLEMENT` item." Add a minimum re-sign
  interval for the entitled near-expiry path too (see L4).

---

## MEDIUM

### M1 — AD-5's "before its body is parsed" does not survive API Gateway REST without a raw-body rule

- **AD:** AD-5 (line 162), Stack table (line 339, "Regional REST API").
- **Attack / failure:** Stripe signature verification requires the exact raw request bytes. A
  REST API with Lambda proxy integration may deliver the body base64-encoded
  (`isBase64Encoded`), and any body mapping template rewrites it. The spine says nothing about
  raw-body preservation (grep: `raw body` 0 hits outside AD-14's logging prohibition). Outcome
  is either total webhook failure (an availability incident the webhook-failure alarm catches
  but cannot explain) or — worse — an implementer "fixes" it by `JSON.parse` then
  `JSON.stringify` before verifying, which silently breaks the HMAC and invites dropping
  verification to ship.
- **Suggested AD change:** AD-5 states that `/webhook` uses Lambda proxy integration with no
  mapping template, that the handler verifies the raw `Buffer` (decoding `isBase64Encoded`
  first), and that the verified `Stripe.Event` object returned by the SDK is the only parsed
  form the handler may read.

### M2 — No timing-safe clause, no signature tolerance, and `EVENT#` TTL expiry re-opens replay

- **AD:** AD-5 (lines 162–163), AD-4 (line 152). Absences: `timing`/`constant-time` 0, `nonce` 0.
- **Attack:** (a) A hand-rolled HMAC comparison with `===` is a timing oracle on the signature;
  the spine never mandates the SDK path. (b) Stripe's signature carries a timestamp and the
  SDK enforces a default 300s tolerance — the spine never states a tolerance, so an
  implementation that ignores it accepts an arbitrarily old captured body forever. (c) The
  `EVENT#<id>` dedupe marker has "a TTL covering Stripe's retry horizon" (line 152, ~3 days);
  after it expires a captured valid body replays successfully. Entitlement stays *correct*
  (AD-5 re-fetches from Stripe), so this is not an entitlement bypass — it is a free
  authenticated-grade amplifier into the Stripe API and DynamoDB, which compounds H3.
- **Suggested AD change:** AD-5 mandates `stripe.webhooks.constructEvent` (never a hand-rolled
  compare), names the tolerance explicitly, and states that the signature timestamp tolerance —
  not the `EVENT#` TTL — is the replay bound, so the two mechanisms are not confused.

### M3 — The Lambda *execution* role's KMS grant is unstated; AD-16's IAM gate covers DynamoDB only

- **AD:** AD-15 (line 274), AD-4 (line 155), AD-16 (line 293).
- **Spine text:** line 274 scopes the **GitHub OIDC deploy** role ("an exact action list …
  covering API Gateway, the mapping, Lambda, DynamoDB, KMS, SSM and logs"). Line 155 enumerates
  DynamoDB isolation in three directions. AD-16 line 293 asserts "IAM isolation in all three
  directions (AD-4)" — DynamoDB only. Nothing states the runtime role's KMS permissions.
- **Attack:** an over-broad execution role (`kms:*` on the key, or key-policy write) turns any
  code-execution or malicious-dependency event in the single `functions/api.ts` into
  sign-arbitrary-statements, and possibly `ScheduleKeyDeletion` (a denial of all entitlement).
  The same role also holds the Stripe secret key and sole table write.
- **Suggested AD change:** AD-15 states the execution role is `kms:Sign` only, on one key ARN,
  with a condition pinning `SigningAlgorithm` — no `Decrypt`, no `GetPublicKey` at runtime (the
  public key is embedded, not fetched), no key-policy or lifecycle actions. Extend AD-16's IAM
  gate to assert the KMS and SSM grants, not just DynamoDB.

### M4 — Inbound `plan_lookup_key` and `promo` are never stated to be validated

- **AD:** AD-6 (lines 175–179), AD-8, sequence diagram line 388
  (`POST /checkout {plan_lookup_key, promo?}`).
- **Attack:** AD-6 line 177 validates capability names arriving *from Stripe*, which is the
  right instinct pointed in the wrong direction — nothing validates the two values arriving
  from the *client*. An unvalidated `promo` passed through to the Checkout Session as a coupon
  or discount id lets a user enumerate or name a 100%-off coupon that exists in the account but
  was never meant for self-service; an unvalidated `plan_lookup_key` lets a user check out
  against an internal, test or retired Price.
- **Suggested AD change:** AD-6 adds that `plan_lookup_key` must match an entry in the same
  cached public catalog `GET /plans` serves, and that a promotion code is passed only as a
  customer-facing **promotion code** resolved by Stripe (never a raw coupon or discount id), with
  `promotion_invalid` — already in AD-13's closed error union (line 252) — as the rejection.

### M5 — AD-14 forbids logging values but specifies no redaction mechanism

- **AD:** AD-14 (lines 264–265).
- **Attack:** "Never logged" (line 264) is a list of values, and a value-level prohibition is not
  implementable by review. The realistic leak is indirect: a caught Stripe SDK error logged
  whole (`logger.error(err)`) can carry the request headers — including `Authorization: Bearer
  sk_live_…` — plus customer identifiers; an unhandled rejection can print a body. The
  structural seed has `lib/logging.ts` (line 358) but no stated contract.
- **Suggested AD change:** AD-14 states that `lib/logging.ts` is the only log path, that it
  accepts a closed set of named fields (the line 265 "loggable" list) and never a free-form
  object, and that error objects from the Stripe SDK or AWS SDK are reduced to `type` + `code` +
  `request_id` before logging. That makes AD-14 testable instead of aspirational.

### M6 — The SAQ-A premise is not written down, so the one change that would break it is not forbidden

- **AD:** AD-8 (lines 195–196), AD-14 (line 263).
- **Assessment — does the architecture guarantee SAQ-A-level scope as written?** Substantially
  yes, and for the right reasons: Stripe is merchant of record under Managed Payments (line 335),
  commerce UI is **always** Stripe-hosted (line 195), the desktop opens it in the **system
  browser and never the webview** (line 196), the web surface does a full 303 redirect (line 196),
  no card field is rendered anywhere (line 195), and no PAN/CVV/raw payment method can reach a
  Nixus system (line 263). Full-redirect-to-a-hosted-page with no iframe is the SAQ-A shape.
  Two gaps keep it from being a *guarantee*:
  1. AD-14 states the **conclusion** ("Prevents: PCI scope") without the **premise**. Nothing
     records *why* scope is minimal — MoR + full redirect + no embedded payment context — so a
     later AD can invalidate it without appearing to contradict anything.
  2. **What would break it:** Stripe Elements, the Payment Element, **embedded Checkout**, or
     iframing a Stripe-hosted page. None is forbidden. "Nixus renders no card field" (line 195)
     does not literally forbid *embedding Stripe's own* field, and embedded Checkout is exactly
     the change a future "checkout feels like leaving the app" UX story would propose. Moving
     the payment context into a Nixus-origin page changes the eligibility argument and pulls
     the Tauri webview and the account app into scope.
- **Suggested AD change:** AD-8 adds one sentence: *"Stripe Elements, the Payment Element,
  embedded Checkout, and iframing any Stripe-hosted payment page are forbidden on every
  surface; the payment context is always a full navigation to a Stripe-hosted origin.
  Introducing any of them is an amendment to this AD and a PCI scope re-assessment."*
  AD-14 records the premise alongside the claim.

### M7 — Stripe Customer creation is not stated to be idempotent per `sub`

- **AD:** AD-4 (line 153), AD-8 (line 197).
- **Attack / failure:** AD-8 creates "a Checkout Session … per attempt" and AD-4 resolves webhooks
  via "a GSI on `stripe_customer_id`". Nothing states the Stripe Customer is created **exactly
  once per `sub`** and stored idempotently. Repeated checkout attempts are the classic path to
  duplicate Customers for one `sub`; the reverse — two `sub`s resolving to one Customer — makes
  the GSI lookup ambiguous and the webhook writes the entitlement to an arbitrary account. If
  Customer creation is ever keyed on a user-supplied email, that collision becomes attacker-
  reachable.
- **Suggested AD change:** AD-4 or AD-8 states that `BILLING_CUSTOMER` is created on first
  checkout under a conditional put (`attribute_not_exists`), that an existing
  `stripe_customer_id` is always reused, that the Stripe Customer carries `metadata.sub`, and
  that the GSI is asserted unique — a webhook resolving to more than one `sub` is a logged
  failure, never a write.

### M8 — `GET /plans` is a second unauthenticated Stripe amplifier with an unspecified cache

- **AD:** AD-3 (line 139), AD-6 (line 179).
- **Attack:** `GET /plans` is unauthenticated and "read from Stripe and cached" (line 179) — no
  TTL, no cache tier (API Gateway cache? container memory? DynamoDB?), no stampede control, no
  negative caching. Container-local memory with no lock means a burst of concurrent cold starts
  fans out one Stripe API call per container; a sustained flood keeps evicting. This is the same
  cost primitive as H3 on a route whose whole purpose is to be cheap and public.
- **Suggested AD change:** AD-6 names the cache tier and TTL, requires single-flight refresh and
  negative caching on a Stripe error, and states the route serves the last good catalog rather
  than failing when Stripe is unreachable.

---

## LOW

- **L1 — Statement cache has no stated integrity or permission requirement.** AD-9 / structural
  seed line 363 (`<statement cache>  # on-disk cached statement`). No location, no `0600`, no
  OS keychain or DPAPI binding, no per-device binding. This is the file C1 and H4 both tamper
  with. *Change:* AD-9 states the cache path, that it is user-only readable, and that it is not
  the integrity boundary — the signature is — so no one invests in protecting it beyond that.
- **L2 — "The webhook signing secret" is singular** (AD-7 line 186, AD-14 line 264). Live and
  test endpoints have different secrets; the singular phrasing invites one SSM parameter and
  the H2 mixup. *Change:* pluralize and key the parameter by stage.
- **L3 — `key_id` format unspecified** (AD-9 line 207). If it is the raw KMS key ARN it ships the
  AWS account id inside a client-visible token and into logs. *Change:* state that `key_id` is a
  short opaque identifier mapped server-side to a KMS key ARN.
- **L4 — No minimum re-sign interval on `GET /entitlement`** (AD-9 line 208, "re-signs when it is
  at or near expiry"). An authenticated user polling near expiry drives `kms:Sign` plus a
  conditional DynamoDB write per call. *Change:* state a re-sign floor (e.g. no more than once
  per 15 min per `sub`) and serve the cached statement otherwise.
- **L5 — SSM read grant not scoped** (AD-7 line 186). *Change:* AD-15 states
  `ssm:GetParameter` plus `kms:Decrypt` on the SSM key, limited to the two exact parameter ARNs.

---

## What the spine already gets right (do not regress these)

- **AD-5 line 164 — converge on Stripe, never trust the payload.** This is the single most
  valuable control in the document: even full compromise of the webhook signing secret does not
  let an attacker fabricate an entitlement, only trigger a re-fetch. It converts a secret leak
  from a bypass into a cost problem. Keep it absolute.
- **AD-5 line 162 — reject before any DynamoDB read.** Correct ordering; it is what keeps H3
  to invocation cost rather than read cost.
- **AD-5 line 165 — `event_watermark`-conditional writes.** Closes out-of-order downgrade.
- **AD-2 line 128 — webhook and audited admin override are the only writers.** This is what
  makes the desktop's `/checkout/complete` return path non-authoritative, which is the right
  answer for an out-of-process system-browser checkout.
- **AD-3 line 140 — `sub` from verified claims only, UUID-shaped before key composition**, and
  line 141 making the unauthenticated set an amendment rather than a code change.
- **AD-8 line 199 — server-side allow-list for `success_url` / `cancel_url`.** Closes open
  redirect on the one route that would otherwise echo a URL.
- **AD-6 line 177 — validate capability names arriving from Stripe metadata against the
  compile-time union.** Correctly treats the operator-editable Dashboard as untrusted input.
- **AD-10 line 221 — sync gating moves server-side**, closing profile AD-17's recorded exception.
  With C1 and C2 fixed, profile AD-17 is genuinely satisfied; without them, AD-9's offline
  verification is weaker than AD-17's wording implies.

## Open questions for the author

1. Is extended offline use by the device owner an accepted risk (C1)? If yes, say so in AD-9 and
   stop at the high-water mark. If no, this spine needs an online-heartbeat requirement, which
   contradicts the 24-hour offline window.
2. What is the intended response to signing-key compromise (C2)? The answer determines whether
   the embedded key becomes a key *set* now or stays singular.
3. Does the auto-update mechanism already give a usable minimum-version floor? If so, C2's
   third bullet is cheap; if not, it is the expensive part.
