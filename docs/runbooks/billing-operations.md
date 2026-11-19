# Runbook — Nixus Cloud billing (`nixus-billing`) operations

Owner: Nixus operator (single-operator service)
Stack: `nixus-billing` · account `760573627796` · region `us-east-1` · Stripe mode **test**

This stack is **deployed and verified end to end in test mode**: a real sandbox
payment converged a real entitlement, the signed statement verified against the
public key embedded in the desktop binary, a replayed webhook event was a no-op,
a stale event did not downgrade, and a `livemode` mismatch was refused. This
runbook documents a working system, not a plan.

---

## 0. What this stack is and what it owns

| Owns | Does not own |
|---|---|
| The `ENTITLEMENT`, `BILLING_CUSTOMER` and `EVENT#<id>` records in its own table | The Cognito user pool, its `nixus-api` resource server, or the `api.nixusapp.com` domain itself |
| The KMS key that signs the entitlement statement | The Stripe catalog's Dashboard-only settings (Customer Portal, Managed Payments, dunning) |
| Six routes under `/v1/billing`: `POST /checkout`, `POST /portal`, `GET /entitlement`, `POST /admin/override`, `POST /webhook`, `GET /plans` | The desktop's local verification of a statement, or `nixus-bedrock-api`'s own quota table |

**The `ENTITLEMENT` record is the sole entitlement authority, and it has exactly
two writers: the Stripe webhook handler and the admin override.** No console
write, no third route and no other stack ever changes it. Every consumer — a
device verifying a statement offline, or a server reading the record directly —
answers "is this account entitled" from this one place.

---

## 1. Stripe Customer Portal configuration — OWNER ACTION, Dashboard only

**Status: UNDONE.** This blocks nothing technically today — checkout, webhooks,
and the admin override all work without it — but it is required before a
customer can self-manage their subscription.

Dashboard path: **Settings → Billing → Customer portal.**

Enable exactly three things:

1. **Cancel subscription.**
2. **Payment-method update.**
3. **Plan switching**, limited to the two tiers this catalog publishes:
   `classic` ⟷ `advance`.

Then set the **dunning / smart-retry schedule** on the same Billing settings
page. This is the **only** grace period in the system — Nixus hard-codes none.
A past-due subscription keeps whatever access Stripe reports as live; when
Stripe calls the subscription `canceled`, the entitlement follows at the next
convergence.

> **AD-16 requires verifying, in the SANDBOX, that switching between `classic`
> and `advance` recalculates tax correctly under Managed Payments.** Stripe's
> own documentation never affirmatively confirms this for a plan-switch flow.
> Portal **session creation** is already confirmed working against the sandbox
> (`POST /portal` returns a usable URL) — the only open question is narrowly
> whether the tax line on a switch is recalculated, not whether the portal
> itself works. Do not claim this verified without running an actual plan
> switch in the sandbox and reading the resulting invoice's tax line.

---

## 2. Changing a price with no deploy (AD-6)

A Stripe Price's amount is immutable once created. Changing an advertised price
is **always** a new Price, moved onto the existing `lookup_key` with
`transfer_lookup_key: true`:

```bash
set -euo pipefail
: "${STRIPE_SECRET_KEY:?set STRIPE_SECRET_KEY to a sandbox key, sk_test_ or rk_test_}"
: "${LOOKUP_KEY:?set LOOKUP_KEY to the Price lookup_key being repriced, e.g. classic_monthly_cad}"
: "${NEW_UNIT_AMOUNT_CENTS:?set NEW_UNIT_AMOUNT_CENTS to the new integer minor-unit amount}"
: "${PRODUCT_ID:?set PRODUCT_ID to the Stripe Product this Price belongs to}"

curl -sS https://api.stripe.com/v1/prices \
  -u "${STRIPE_SECRET_KEY}:" \
  -d "product=${PRODUCT_ID}" \
  -d "currency=cad" \
  -d "unit_amount=${NEW_UNIT_AMOUNT_CENTS}" \
  -d "recurring[interval]=month" \
  -d "lookup_key=${LOOKUP_KEY}" \
  -d "transfer_lookup_key=true"
```

**Existing subscribers keep their current Price at their grandfathered rate.**
`transfer_lookup_key: true` moves the `lookup_key` onto the new Price
atomically; it does not touch any subscription already billing against the old
one. Only a *new* checkout picks up the new amount.

The catalog TTL — the template's `CatalogCacheTtlSeconds` default, **300
seconds** — is the exact advertised-versus-charged drift window: for up to that
long after a price change, `GET /plans` can still answer with the old amount
while a new checkout, which reads Stripe directly rather than the cache, already
charges the new one. No layer above this TTL may add a second cache; CloudFront
and every client derive their own bound from `cache_ttl_seconds` in the
response body.

**Measured:** a price change propagated to `GET /plans` in **270 seconds**
against this 300-second TTL, with no deploy required.

Verify the new amount is live:

```bash
set -euo pipefail
curl -sS https://api.nixusapp.com/v1/billing/plans | \
  python3 -c '
import json, sys
data = json.load(sys.stdin)
for plan in data["plans"]:
    print(plan["lookup_key"], plan["unit_amount_cents"], plan["currency"])
'
```

---

## 3. Adding a tier with no deploy

A **new tier that reuses existing capabilities** — say, an annual variant of
`classic` — is Stripe Dashboard-only:

1. Create a Product with metadata `nixus_tier`, `nixus_capabilities` (from the
   existing, already-granted set), and optionally `nixus_monthly_request_limit`
   and `nixus_display_order`.
2. Create a Price on that Product with a `lookup_key` following the
   `<tier>_<interval>_<currency>` convention (e.g. `classic_yearly_cad`).
3. Add that `lookup_key` to the `CatalogLookupKeys` stack parameter — a
   parameter change, deployed once, with no code change.

**A brand-new CAPABILITY is a release, in both `packages/shared/src/types/billing.ts`
(`BILLING_CAPABILITIES`) and the desktop's `entitlements.rs` mirror.** The union
is closed at compile time on purpose: a gate that tests a union member is
exhaustive, where a lookup against a runtime list can silently miss a
capability nobody meant to grant. That closedness is what makes "add a tier"
free and "add a capability" a deliberate, reviewed release — do not shortcut it
by inventing a capability name in Stripe metadata that the union does not
already contain. A name the union does not recognise is dropped and logged;
it never reaches an entitlement.

---

## 4. Discount codes

Coupons and promotion codes are created in the **Dashboard**, not by this
service. Two rules govern how they reach checkout:

- **`allow_promotion_codes` and a direct `discounts` parameter on a Checkout
  Session are mutually exclusive.** `POST /checkout` passes the caller's
  `promotion_code`, when supplied, as a `discounts` entry — it never sets
  `allow_promotion_codes: true` on the same session, which Stripe would refuse.
- **An invalid or expired code returns `promotion_invalid`.** The submitted
  code is never echoed back in the error body (AD-8, AD-14): a client that
  wants to show the user what they typed has to keep its own copy of the input
  field.

---

## 5. The admin override (AD-2)

**This REPLACES the manual `put-item` grant.** There is no path left by which
an operator writes an `ENTITLEMENT` item directly — `hosted-ai-rollout.md` §3.2
describes that mechanism for a different table and a different stack, and the
admin route below supersedes it for billing entitlements. Do not `put-item`
against `BillingTable` under any circumstance: AD-2 requires exactly two
writers of the entitlement record, and a console write is an undocumented,
unconditioned third one.

`POST /v1/billing/admin/override` requires:

- A valid Cognito access token carrying `nixus-api/billing`.
- The token's `cognito:groups` claim containing `nixus-billing-admin`. Without
  it the route answers `unauthorized`, identically to a missing scope.
- A mandatory `admin_expires_at` (epoch seconds) and `reason` in the body. An
  override is never open-ended: `ADMIN_OVERRIDE_MAX_DURATION_SECONDS` (90 days)
  bounds how far `admin_expires_at` may sit in the future, and the request is
  refused with `validation`/`out_of_range` beyond that.

**The override outranks a converging webhook.** While it is live, the Stripe
webhook handler keeps recording Stripe-derived state in its own attributes but
does not touch `tier` or `capabilities[]`; the override's values stand until it
expires or is revoked. There is therefore one answer to "is this account
entitled" at every instant, never two writers racing.

Worked example, every identifier read from a shell variable set from the
deployed stack or an operator-supplied value — never a literal pasted into this
document, following the discipline of `hosted-ai-rollout.md` §3.2:

```bash
set -euo pipefail
: "${BILLING_API_ENDPOINT:?set BILLING_API_ENDPOINT, e.g. read from the stack output ApiEndpoint}"
: "${ADMIN_ACCESS_TOKEN:?set ADMIN_ACCESS_TOKEN to a token carrying nixus-api/billing and the nixus-billing-admin group claim}"
: "${TARGET_SUB:?set TARGET_SUB to the Cognito sub being granted}"
: "${OVERRIDE_TIER:?set OVERRIDE_TIER to the tier code to grant, e.g. advance}"
: "${OVERRIDE_REASON:?set OVERRIDE_REASON to a short audit note}"

EXPIRES_AT="$(( $(date -u +%s) + 7 * 24 * 60 * 60 ))"

curl -sS -X POST "${BILLING_API_ENDPOINT}/admin/override" \
  -H "Authorization: Bearer ${ADMIN_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c '
import json, os
print(json.dumps({
    "sub": os.environ["TARGET_SUB"],
    "tier": os.environ["OVERRIDE_TIER"],
    "capabilities": ["hosted_ai", "household_net_worth", "multi_device_sync"],
    "monthly_request_limit": 1000,
    "admin_expires_at": int(os.environ["EXPIRES_AT"]),
    "reason": os.environ["OVERRIDE_REASON"],
    "expected_version": None,
}))
')"
```

No account id, pool id, or `sub` is written literally anywhere in this
document or command — every value above is a shell variable the operator
supplies at run time, or is read back from the deployed stack's own outputs.

---

## 6. Alarm response

Six CloudWatch alarms exist against log group `/aws/lambda/nixus-billing-api`
(14-day retention): `nixus-billing-api-5xx`, `nixus-billing-function-errors`,
`nixus-billing-function-throttles`, `nixus-billing-webhook-failures`,
`nixus-billing-catalog-metadata-malformed`, and
`nixus-billing-duplicate-subscription`. A monthly budget of **$10** alerts at
80% and 100%; the budget only notifies, it never stops traffic.

### API 5XX / Lambda Errors / Lambda Throttles

Standard triage: check the function log group for an unhandled exception
(5XX/Errors), or check whether `BillingFunctionReservedConcurrency` (10) is
exhausted by a burst against the two unauthenticated routes (Throttles). Unlike
`nixus-bedrock-api`, this function **does** carry a reservation, so a Throttles
alarm here means this stack's own bounded share is exhausted, not the
account-wide shared pool.

### `CatalogMetadataMalformed`

**Means:** a Stripe Product's `nixus_tier` or `nixus_capabilities` metadata is
absent, empty, or unparseable.

**What actually happened:** the subscription converged anyway, recorded as
paid, but **no capability was granted**. A paying customer is right now granted
nothing for their money. This is urgent — treat it like a billing outage for
that customer, not a background data-quality issue.

**What to check:** the Stripe Dashboard, the Product behind the affected
Price. Read `nixus_tier` and `nixus_capabilities` back exactly as stored.

**What to do:** fix the metadata in the **Dashboard** — this is never a code
or deploy fix. Once corrected, the next webhook convergence (or a manual
`stripe-sandbox-setup.ts --apply` reconciliation, for the launch catalog
specifically) re-derives the grant correctly. If the affected customer needs
their access restored immediately rather than waiting for the next event, use
the admin override (§5) as a time-boxed bridge while the Dashboard fix lands.

### `WebhookFailure`

**Means:** a Stripe webhook event failed to converge into an entitlement
change.

**What actually happened:** Stripe is retrying with backoff; the entitlement
for the affected account may be stale until a retry succeeds.

**What to check:** the function log group around the failure window for the
event id and the reason the transaction was rejected (a version conflict, a
DynamoDB error, a signing failure).

**What to do:** if Stripe's retries are expected to eventually succeed, let
them. If the underlying cause will not self-resolve (a code defect, a
persistent DynamoDB condition failure), fix the defect and let the next Stripe
retry converge — do not hand-write the entitlement.

### `DuplicateSubscription`

**Means:** one `sub` holds more than one **live** Stripe subscription
simultaneously.

**What actually happened:** this is a **defect**, not a state the entitlement
model is designed to carry. The authority never silently picks one of the two
subscriptions — it grants the **union** of their capabilities, so the customer
loses nothing while it is unresolved, but they are very likely being charged
twice.

**What to do:** reconcile by hand — see §7.

---

## 7. Duplicate-subscription reconciliation (AD-18)

**Finding it:** the `DuplicateSubscription` alarm names no account by itself —
check the function log group around the alarm's timestamp for the `sub` the
emitting request was processing. Then, in the Stripe Dashboard, open that
customer and list their subscriptions; more than one in `active` or `trialing`
status confirms the defect.

**While it is unresolved:** the architecture never silently picks one
subscription over the other. The entitlement grants the **union** of both
subscriptions' capabilities. The customer is not under-served, but they may be
over-charged.

**Resolving it:** in the Stripe Dashboard, cancel the subscription the customer
did **not** intend to keep — normally the older or lower-tier one, confirmed
with the customer if there is any ambiguity. Canceling it fires a
`customer.subscription.deleted` webhook, which converges the entitlement down
to the remaining subscription's capabilities. Do not edit the `ENTITLEMENT`
record directly to "fix" this; let the webhook convergence do it, or use the
admin override (§5) only as a temporary bridge if the customer needs an
immediate correction pending the Dashboard cancellation.

---

## 8. The entitlement backfill (AD-17)

`apps/api-billing/scripts/backfill-entitlements.ts` migrates every existing
`HostedAiTable` `USER#<sub>/CONFIG` item with `premium = true` into an
`ENTITLEMENT` record in the billing table.

- **Dry-run by default.** The script reads and reports; it writes nothing
  unless invoked with its explicit apply flag, mirroring the
  `stripe-sandbox-setup.ts` dry-run/`--apply` convention.
- **Idempotent and re-runnable.** Running it twice against the same source data
  produces the same result; it does not double-grant or duplicate work.
- **Hand-granted premium users map to Advance**, not Classic. Per the
  architecture's own investigation, what those users were granted was hosted
  AI — and `advance` is the only tier that includes the `hosted_ai`
  capability — so the backfill writes `tier: "advance"` with the Advance
  capability set and `source: "admin"`.
- **A record whose `source` is already `stripe` is never overwritten.** The
  backfill is create-only — its write is conditional on the record not already
  existing — so an account that has since subscribed through Stripe keeps its
  Stripe-derived state untouched, and a re-run is a true no-op rather than a
  version bump.

**This must run BEFORE `premium` is retired** in `nixus-bedrock-api`'s
`quota.ts`. The fixed deploy order is: `nixus-billing` deployed with no
traffic → backfill run → `nixus-bedrock-api` cut over to read the billing
authority → desktop release → `premium` attribute and its `ConditionCheck`
retired. Skipping the backfill before the read cutover would mean no bedrock
request that depended on it had an equivalent `ENTITLEMENT` record to fall back
on.

---

## 9. Signing-key rotation (AD-9)

The entitlement statement is signed by a KMS asymmetric key
(`ECC_NIST_P256`, `SIGN_VERIFY`). The desktop verifies offline against a
**trusted-key set** embedded in the binary, each entry carrying its `key_id`
and a `not_after` instant.

**Rotation is three ordered releases, and the order cannot be compressed:**

1. **Add the new key to the desktop's trusted set.** The binary now recognises
   the new `key_id`, but the server is still signing with the old one.
2. **Switch the server to sign with the new key.** Only safe once every
   supported client has received release 1 — a statement signed by a key an
   installed binary does not know **grants nothing**, so signing with it
   before clients know about it would lock those clients out of their own
   entitlement.
3. **Stop trusting the old key.** Remove the old `key_id` from the desktop's
   trusted set, or let its `not_after` lapse naturally.

**The `not_after` on each trusted entry, together with the server-side
`MinimumClientVersion` floor, is the revocation path for a leaked signing
key.** `not_after` bounds how long an already-installed binary keeps trusting
a given key regardless of server behaviour; `MinimumClientVersion` refuses to
serve a statement at all to a client build old enough to lack the
rotation — forcing an upgrade rather than leaving a compromised key valid
forever in binaries nothing can push an update to.

**Reading the public key**, once, to embed in a new desktop release:

```bash
set -euo pipefail
: "${STATEMENT_SIGNING_KEY_ID:?set STATEMENT_SIGNING_KEY_ID, e.g. read from the stack output StatementSigningKeyId}"

aws kms get-public-key \
  --key-id "${STATEMENT_SIGNING_KEY_ID}" \
  --region us-east-1 \
  --query 'PublicKey' --output text | base64 -d | xxd | head
# Expect a 91-byte SPKI DER structure for a P-256 EC public key.
```

**The billing Lambda's own grant is sign-only.** It holds `kms:Sign` and
nothing else against this key — not `kms:Verify` (verification is offline, on
the device, against the embedded public key) and not `kms:GetPublicKey` (the
public half is exported once, by an operator, and embedded in the binary; a
runtime read from the Lambda would be a second source of truth for the trusted
key).

---

## 10. Secrets

Two SSM Parameter Store SecureString paths, both read by the Lambda at **cold
start only** — neither ever becomes an environment variable, a template value,
or a log line:

- `/nixus-billing/stripe-secret-key`
- `/nixus-billing/stripe-webhook-secret`

**Startup mode assertion.** The Lambda refuses to start if the loaded secret
key's own mode prefix (`sk_test_`/`sk_live_`) disagrees with the stack's
`StripeMode` parameter. A test-mode key cannot run against a stack configured
for live, and vice versa.

**No CI step may print or compare key material.** CI asserts the
*configuration* — that `StripeMode` is set correctly, that the parameter names
are wired — never the secret value itself.

**Rotating the Stripe secret key:**

1. Create a new secret key (or roll it) in the Stripe Dashboard.
2. Write it to SSM:

   ```bash
   set -euo pipefail
   : "${NEW_STRIPE_SECRET_KEY:?set NEW_STRIPE_SECRET_KEY, never echoed}"

   aws ssm put-parameter \
     --name /nixus-billing/stripe-secret-key \
     --type SecureString \
     --value "${NEW_STRIPE_SECRET_KEY}" \
     --region us-east-1 \
     --overwrite
   ```

3. The new value is read on the **next cold start**. Force one by publishing a
   no-op Lambda update, or wait for natural recycling if the rotation is not
   time-critical.
4. Revoke the old key in the Stripe Dashboard only after confirming the new one
   is live (a successful `GET /plans` or `POST /checkout` call).

**Rotating the webhook signing secret** follows the same SSM write against
`/nixus-billing/stripe-webhook-secret`, but the new secret must be obtained
from Stripe's webhook endpoint settings (or from `stripe-sandbox-setup.ts`
creating a fresh endpoint) **first** — Stripe shows a signing secret only once,
at creation, and never discloses it again.

---

## 11. Going to live mode

**Live mode is NOT enabled.** This stack is deployed and verified end to end
against Stripe test mode only. The ordered checklist before it can be:

1. AD-16's legal and disclosure gate must already be true: Terms name Stripe
   as seller of record; the Privacy Policy names Stripe as payment processor
   and states Nixus stores no card data; `README.md` and `apps/web` no longer
   say Nixus has no billing system; pricing copy states tax-included CAD
   pricing.
2. Managed Payments enabled on the live Stripe account, with the business
   location configured.
3. The Customer Portal configured per §1, **and** the switch-plan tax
   recalculation verified in the sandbox — not assumed from the test-mode
   portal session working.
4. The entitlement backfill (§8) run against production data.
5. `nixus-bedrock-api`'s read cutover to the billing authority deployed (AD-17
   deploy order).
6. Live Products and Prices created in Stripe, mirroring the sandbox catalog
   (`classic_monthly_cad`, `advance_monthly_cad`) with the same metadata
   contract.
7. A live-mode webhook endpoint created in Stripe, and its signing secret
   stored to `/nixus-billing/stripe-webhook-secret` (§10) — this **replaces**
   the test-mode secret; the two modes do not coexist on one stack.
8. `StripeMode` stack parameter flipped from `test` to `live`, redeployed.

**A `livemode` mismatch is refused per event, unconditionally.** Every incoming
webhook event carries Stripe's own `livemode` boolean; the handler rejects any
event whose `livemode` disagrees with the stack's configured `StripeMode`. A
test-mode event can never mutate a live entitlement, and a live event can never
mutate a test entitlement — this holds regardless of what secret is loaded or
what mistake produced the mismatched event.

---

## 12. If something goes wrong

- **The admin override was issued in error.** Issue a corrective override with
  `expected_version` set to the version just written, naming the correct tier
  and capabilities (or an empty capability list to revoke outright), and a
  `reason` documenting the correction. There is no delete path for an
  entitlement record — AD-11 deletes nothing on a billing event — so a
  correction is always a new, versioned write.

- **A webhook converged the wrong state.** Do not hand-edit the `ENTITLEMENT`
  record. Confirm what Stripe's own subscription object currently says, and
  either let the next legitimate event correct it, or bridge with a time-boxed
  admin override (§5) while investigating.

- **A deploy needs to be rolled back.** Revert the offending commit and let
  the pipeline redeploy, or deploy the previous template revision. **The
  billing table and the KMS signing key are both `DeletionPolicy: Retain` /
  `UpdateReplacePolicy: Retain`, with PITR on the table.** A rollback, or even
  a full stack deletion, cannot remove either: CloudFormation will not delete
  a `Retain`-protected resource, and the execution role is not granted
  `dynamodb:DeleteTable`. Entitlement history and the signing key therefore
  survive any pipeline action.

- **What is NOT reversible:** a Stripe charge already captured (refund through
  Stripe, not through Nixus — Nixus stores no payment data to reverse); a
  webhook event already converged and superseded by a later one (the watermark
  only moves forward; there is no "replay an older state" operation); a KMS
  key once scheduled for deletion outside this stack's control (the stack
  itself never does this — `Retain` plus no `kms:ScheduleKeyDeletion` grant
  means only an out-of-band account action could, and this runbook does not
  describe one).

---

## 13. Known pitfalls

**Stripe's `expand` depth limit, and the LIST-endpoint trap.** Stripe rejects
an `expand` path deeper than **four** levels. A LIST endpoint additionally
prefixes every expand path with `data.`, consuming one of those four levels —
so a path that is legal on a `retrieve` call becomes one level too deep on the
equivalent `list` call. **Symptom an operator would observe:** a catalog read
or a subscription lookup that worked in a quick manual test against
`retrieve` fails in production with a Stripe API error about expansion depth,
specifically on the code path that calls `.list(...)` with the same expand
array. This already cost a production `503` once; `getCatalog`'s
`expand: ["data.product"]` is the one level deep this service actually needs
and must not be extended without re-counting from `data.`.

**Missing CORS on `GET /plans`.** The marketing site (`apps/web`) is a
different origin than `api.nixusapp.com`. Without
`Access-Control-Allow-Origin` on the `/plans` response, a browser fetch from
the marketing site's pricing page fails silently in the browser console, and
the page **falls back to its baked-in prices forever** — there is no visible
error state in the product, only stale numbers that never update again until
someone notices and fixes the header. **Symptom an operator would observe:** a
price change made per §2, confirmed live via `curl`, that never appears on the
public pricing page no matter how long is waited.

---

## 14. Closing table

| Name | Kind | Where it lives | Status |
|---|---|---|---|
| `/nixus-billing/stripe-secret-key` | SSM SecureString | AWS Systems Manager Parameter Store, `us-east-1` | **set**, test mode |
| `/nixus-billing/stripe-webhook-secret` | SSM SecureString | AWS Systems Manager Parameter Store, `us-east-1` | **set**, test mode |
| `CognitoUserPoolArn` / `CognitoUserPoolId` | stack parameter | `template.yaml`, existing pool `us-east-1_7gfGQ0emg` | set |
| `ApiDomainName` | stack parameter | `template.yaml`, default `api.nixusapp.com` | set |
| `AlertEmail` | stack parameter | `template.yaml` | set, confirmed subscriber |
| `StripeMode` | stack parameter | `template.yaml`, `test` \| `live` | **test** |
| `CatalogCacheTtlSeconds` | stack parameter | `template.yaml`, default 300 | **300** (echoed as `CatalogCacheTtlSecondsEcho`) |
| `CatalogLookupKeys` | stack parameter | `template.yaml`, default `classic_monthly_cad,advance_monthly_cad` | set (echoed as `CatalogLookupKeysEcho`) |
| `AccountAppOrigin` | stack parameter | `template.yaml`, default `https://account.nixusapp.com` | set (echoed as `AccountAppOriginEcho`) |
| `MinimumClientVersion` | stack parameter | `template.yaml`, default `0.0.0` | set, refuses nothing yet |
| `BillingFunctionReservedConcurrency` | stack parameter | `template.yaml`, default 10 | set |
| `BillingTableName` | stack output | `nixus-billing-billing` | deployed |
| `BillingTableCustomerIndexName` | stack output | `stripe-customer-index` | deployed |
| `StatementSigningKeyId` | stack output | `59db75bf-801f-4ac9-bc30-33e354582db8` | deployed, `Retain` |
| `ApiEndpoint` | stack output | `https://api.nixusapp.com/v1/billing` | deployed |
| `FunctionName` | stack output | `nixus-billing-api` | deployed |
| `nixus-api/billing` | Cognito scope | user pool `us-east-1_7gfGQ0emg`, resource server `nixus-api` | set |
| `nixus-billing-admin` | Cognito group claim | user pool `us-east-1_7gfGQ0emg` | required for `/admin/override` |
| `WebhookFailure`, `CatalogMetadataMalformed`, `DuplicateSubscription` | custom CloudWatch metrics | namespace `Nixus/Billing` | emitting |
| `/aws/lambda/nixus-billing-api` | log group | CloudFormation-managed, 14-day retention | deployed |
| `nixus-billing-monthly` budget | AWS Budget | $10/month, 80%/100% alerts | configured |
</content>
