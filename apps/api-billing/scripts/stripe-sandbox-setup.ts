/**
 * Epic D — idempotent Stripe sandbox setup for Nixus Cloud billing.
 *
 * Creates, and on a re-run converges, the Stripe objects the billing stack reads:
 *
 *   - one Product per tier, carrying the metadata the authority derives from
 *     (`nixus_tier`, `nixus_capabilities`, `nixus_monthly_request_limit`, `nixus_display_order`)
 *   - one monthly and one yearly CAD Price per tier, addressed only by `lookup_key`
 *   - one test promotion code, so AD-16's "a discount applies with no deploy" gate is provable
 *   - the webhook endpoint the authority is signed against
 *
 * Nothing here runs in the Lambda and nothing here is deployed. It is an operator tool, run by
 * hand against a SANDBOX key, and it is the only place Nixus writes to the Stripe catalog —
 * everything else reads it (billing AD-6).
 *
 * Why a script rather than Dashboard clicks: AD-6 makes Stripe Product metadata load-bearing.
 * A capability list typed by hand into a web form is a silent revocation waiting to happen, and
 * AD-6's malformed case is an alarm, not a crash. This file is reviewable, diffable and re-runnable.
 *
 * Run (Node 24+ strips the types natively):
 *
 *   STRIPE_SECRET_KEY=sk_test_... \
 *   NIXUS_WEBHOOK_URL=https://api.nixusapp.com/v1/billing/webhook \
 *     node --experimental-strip-types apps/api-billing/scripts/stripe-sandbox-setup.ts
 *
 *   Add --apply to write. Without it the script is a DRY RUN and calls nothing but reads.
 *
 * The script refuses to run against a live key. There is no flag to override that.
 */

import Stripe from "stripe";

// Imported by path, not through the `@nixus/shared` barrel: that barrel re-exports the React
// UI surface, which cannot load in a plain Node process running this script.
import {
  BILLING_CAPABILITIES,
  type BillingCapability,
  isPlanLookupKeyShaped,
  PLAN_TRIAL_MAX_DAYS,
} from "../../../packages/shared/src/types/billing.ts";

/** Pinned, never floating — the version `stripe@23.1.0` ships with. */
const STRIPE_API_VERSION = "2026-10-28.endive";

/**
 * Stripe's SaaS tax code. Managed Payments is merchant of record and files and remits on this
 * classification, so it is set on the Product rather than left to Stripe to infer.
 */
const SAAS_TAX_CODE = "txcd_10103001";

/**
 * The metadata keys the authority reads. These are a CONTRACT with `lib/catalog.ts`: a rename here
 * without a rename there yields a paid-but-capability-less entitlement and an alarm, which is
 * AD-6's defined malformed case working as designed — but it is still an outage for the customer.
 *
 * `trialDays` is the one key that goes on the PRICE rather than on the Product: two Prices of one
 * tier differ in it, and a Product-level key could not express that.
 */
const METADATA_KEYS = {
  tier: "nixus_tier",
  capabilities: "nixus_capabilities",
  monthlyRequestLimit: "nixus_monthly_request_limit",
  displayOrder: "nixus_display_order",
  trialDays: "nixus_trial_days",
} as const;

interface PlanSpec {
  /** Opaque tier code. Crosses the wire for display and operations; never compared in a gate. */
  readonly tier: string;
  readonly productName: string;
  readonly productDescription: string;
  readonly lookupKey: string;
  /** Integer minor units. Lives here and in Stripe — never in the Lambda (AD-6). */
  readonly unitAmountCents: number;
  readonly currency: string;
  readonly interval: Stripe.PriceCreateParams.Recurring.Interval;
  readonly capabilities: readonly BillingCapability[];
  /** `null` for a tier that grants no hosted AI, so no per-tier quota applies. */
  readonly monthlyRequestLimit: number | null;
  readonly displayOrder: number;
  /**
   * Free-trial length in days, written to PRICE metadata, or `null` for a Price sold with no
   * trial. `POST /checkout` reads it from the catalog and passes it as the Checkout Session's
   * `subscription_data.trial_period_days`, which is the ONLY trial a Checkout Session honours —
   * a trial set on the Price object itself is ignored there, and `recurring.trial_period_days`
   * is not even a creatable Price parameter.
   */
  readonly trialDays: number | null;
}

/**
 * The launch catalog (INVESTIGATION §4). Classic advertises household net worth ahead of its code,
 * which AD-1 explicitly permits: a capability may be granted before anything consumes it.
 *
 * `advance_trial` is the Advance monthly Price sold with a 7-day free trial. It is a SECOND Price
 * on the same Product, so it carries the same tier, grant and post-trial amount; only its
 * `lookup_key` and its `nixus_trial_days` differ.
 */
const PLANS: readonly PlanSpec[] = [
  {
    tier: "classic",
    productName: "Nixus Cloud Classic",
    productDescription:
      "Nixus Cloud with multi-device sync and household net worth.",
    lookupKey: "classic_monthly_cad",
    unitAmountCents: 999,
    currency: "cad",
    interval: "month",
    capabilities: ["household_net_worth", "multi_device_sync"],
    monthlyRequestLimit: null,
    displayOrder: 1,
    trialDays: null,
  },
  {
    tier: "advance",
    productName: "Nixus Cloud Advance",
    productDescription:
      "Nixus Cloud with multi-device sync, household net worth and hosted AI.",
    lookupKey: "advance_monthly_cad",
    unitAmountCents: 1999,
    currency: "cad",
    interval: "month",
    capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
    monthlyRequestLimit: 1000,
    displayOrder: 2,
    trialDays: null,
  },
  {
    tier: "classic",
    productName: "Nixus Cloud Classic",
    productDescription:
      "Nixus Cloud with multi-device sync and household net worth.",
    lookupKey: "classic_yearly_cad",
    unitAmountCents: 9999,
    currency: "cad",
    interval: "year",
    capabilities: ["household_net_worth", "multi_device_sync"],
    monthlyRequestLimit: null,
    displayOrder: 1,
    trialDays: null,
  },
  {
    tier: "advance",
    productName: "Nixus Cloud Advance",
    productDescription:
      "Nixus Cloud with multi-device sync, household net worth and hosted AI.",
    lookupKey: "advance_yearly_cad",
    unitAmountCents: 12999,
    currency: "cad",
    interval: "year",
    capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
    monthlyRequestLimit: 1000,
    displayOrder: 2,
    trialDays: null,
  },
  {
    tier: "advance",
    productName: "Nixus Cloud Advance",
    productDescription:
      "Nixus Cloud with multi-device sync, household net worth and hosted AI.",
    lookupKey: "advance_trial",
    unitAmountCents: 1999,
    currency: "cad",
    interval: "month",
    capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
    monthlyRequestLimit: 1000,
    displayOrder: 2,
    trialDays: 7,
  },
];

/** AD-16 requires a promotion code applying at checkout with no deploy. This is that proof. */
const TEST_PROMOTION = {
  couponName: "Nixus launch test — 20% off 3 months",
  percentOff: 20,
  durationInMonths: 3,
  code: "NIXUSTEST20",
} as const;

/**
 * The closed event set `handlers/webhook.ts` treats as relevant. Subscribing to exactly this set
 * keeps an unrecognised type a logged no-op rather than traffic we pay to reject.
 */
const WEBHOOK_EVENTS: readonly Stripe.WebhookEndpointCreateParams.EnabledEvent[] =
  [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
    "checkout.session.completed",
  ];

const APPLY = process.argv.includes("--apply");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Never prints a secret, only its mode prefix. */
function assertSandboxKey(key: string): void {
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    throw new Error(
      "refusing to run: this is a LIVE Stripe key. This script only ever targets a sandbox.",
    );
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new Error(
      "refusing to run: STRIPE_SECRET_KEY is not a recognised Stripe test key.",
    );
  }
}

function log(action: "would" | "did", what: string): void {
  process.stdout.write(`${action === "would" ? "[dry-run]" : "[applied] "} ${what}\n`);
}

/**
 * Validates a plan against the shared contract before a single Stripe call. A capability name this
 * does not recognise can never reach Stripe metadata, so the authority's own validation never has
 * to drop one that originated here.
 */
function assertPlanIsContractValid(plan: PlanSpec): void {
  if (!isPlanLookupKeyShaped(plan.lookupKey)) {
    throw new Error(`lookup_key is not contract-shaped: ${plan.lookupKey}`);
  }
  for (const capability of plan.capabilities) {
    if (!(BILLING_CAPABILITIES as readonly string[]).includes(capability)) {
      throw new Error(
        `capability is not in the compile-time union: ${capability}`,
      );
    }
  }
  const sorted = [...plan.capabilities].every(
    (capability, index, all) => index === 0 || all[index - 1]! < capability,
  );
  if (!sorted) {
    throw new Error(
      `capabilities must be sorted and duplicate-free: ${plan.lookupKey}`,
    );
  }
  if (!Number.isInteger(plan.unitAmountCents) || plan.unitAmountCents <= 0) {
    throw new Error(`unit amount must be positive minor units: ${plan.lookupKey}`);
  }
  if (
    plan.trialDays !== null &&
    (!Number.isInteger(plan.trialDays) ||
      plan.trialDays <= 0 ||
      plan.trialDays > PLAN_TRIAL_MAX_DAYS)
  ) {
    throw new Error(
      `trial length must be 1..${PLAN_TRIAL_MAX_DAYS} days or null: ${plan.lookupKey}`,
    );
  }
}

function metadataFor(plan: PlanSpec): Stripe.MetadataParam {
  return {
    [METADATA_KEYS.tier]: plan.tier,
    // Comma-separated, sorted. `lib/catalog.ts` splits on commas, trims, and validates every name.
    [METADATA_KEYS.capabilities]: plan.capabilities.join(","),
    [METADATA_KEYS.monthlyRequestLimit]:
      plan.monthlyRequestLimit === null ? "" : String(plan.monthlyRequestLimit),
    [METADATA_KEYS.displayOrder]: String(plan.displayOrder),
  };
}

/** PRICE metadata. An empty value deletes the key, which is the "no trial" state. */
function priceMetadataFor(plan: PlanSpec): Stripe.MetadataParam {
  return {
    [METADATA_KEYS.trialDays]:
      plan.trialDays === null ? "" : String(plan.trialDays),
  };
}

/**
 * Finds this plan's Product by its tier metadata rather than by name, so renaming a Product in the
 * Dashboard does not make this script create a duplicate. Deliberately NOT `products.search`:
 * Stripe search is not read-after-write consistent, so a re-run inside the indexing window would
 * miss what the previous run just created and mint a second Product.
 */
async function findProductByTier(
  stripe: Stripe,
  tier: string,
): Promise<Stripe.Product | undefined> {
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata[METADATA_KEYS.tier] === tier) return product;
  }
  return undefined;
}

async function convergeProduct(
  stripe: Stripe,
  plan: PlanSpec,
): Promise<string | undefined> {
  const existing = await findProductByTier(stripe, plan.tier);
  const metadata = metadataFor(plan);

  if (!existing) {
    if (!APPLY) {
      log("would", `create Product ${plan.productName} (${plan.tier})`);
      return undefined;
    }
    const created = await stripe.products.create(
      {
        name: plan.productName,
        description: plan.productDescription,
        tax_code: SAAS_TAX_CODE,
        metadata,
      },
      // Deterministic, so a retried run cannot mint a second Product for the tier.
      { idempotencyKey: `nixus-product-${plan.tier}` },
    );
    log("did", `created Product ${created.id} (${plan.tier})`);
    return created.id;
  }

  // An empty value DELETES the key in Stripe, and `lib/catalog.ts`'s `readMetadata`
  // trims and treats empty as absent — so "" and an absent key are the same state and
  // comparing them literally would report drift on every converging run.
  const drifted = Object.entries(metadata).filter(
    ([key, value]) => (existing.metadata[key] ?? "") !== value,
  );
  if (drifted.length === 0 && existing.name === plan.productName) {
    log(APPLY ? "did" : "would", `Product ${existing.id} (${plan.tier}) already correct`);
    return existing.id;
  }
  if (!APPLY) {
    log(
      "would",
      `update Product ${existing.id} (${plan.tier}): ${drifted.map(([k]) => k).join(", ") || "name"}`,
    );
    return existing.id;
  }
  await stripe.products.update(existing.id, {
    name: plan.productName,
    description: plan.productDescription,
    tax_code: SAAS_TAX_CODE,
    metadata,
  });
  log("did", `updated Product ${existing.id} (${plan.tier})`);
  return existing.id;
}

/**
 * Converges the Price. A Price's amount is immutable in Stripe, so a changed amount means a NEW
 * Price created with `transfer_lookup_key: true`: existing subscribers stay on their Price at their
 * grandfathered rate, and new checkouts pick up the new amount. That is AD-6's price-change
 * mechanism, and it is why no amount may ever appear in the Lambda.
 *
 * Metadata, unlike the amount, IS mutable — so a changed trial length is an update in place rather
 * than a superseding Price. Stripe fixes a trial when the subscription is created, so an update
 * only affects later checkouts and never shortens a trial already running.
 */
async function convergePrice(
  stripe: Stripe,
  plan: PlanSpec,
  productId: string | undefined,
): Promise<void> {
  const found = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    active: true,
    limit: 1,
  });
  const existing = found.data[0];
  const priceMetadata = priceMetadataFor(plan);

  const matches =
    existing !== undefined &&
    existing.unit_amount === plan.unitAmountCents &&
    existing.currency === plan.currency &&
    existing.recurring?.interval === plan.interval;
  // `""` and an absent key are the same state in Stripe, and the authority's
  // `readMetadata` trims and treats empty as absent — so comparing them
  // literally would report drift on every converging run.
  const metadataMatches =
    existing !== undefined &&
    Object.entries(priceMetadata).every(
      ([key, value]) => (existing.metadata[key] ?? "") === value,
    );

  if (matches && metadataMatches) {
    log(APPLY ? "did" : "would", `Price ${existing.id} (${plan.lookupKey}) already correct`);
    return;
  }

  if (matches && !metadataMatches) {
    if (!APPLY) {
      log("would", `update Price ${existing.id} (${plan.lookupKey}) metadata`);
      return;
    }
    await stripe.prices.update(existing.id, { metadata: priceMetadata });
    log("did", `updated Price ${existing.id} (${plan.lookupKey}) metadata`);
    return;
  }

  if (!APPLY || productId === undefined) {
    log(
      "would",
      existing === undefined
        ? `create Price ${plan.lookupKey} at ${plan.unitAmountCents} ${plan.currency}/${plan.interval}`
        : `supersede Price ${existing.id} with a new Price at ${plan.unitAmountCents} ${plan.currency} (transfer_lookup_key)`,
    );
    return;
  }

  const created = await stripe.prices.create({
    product: productId,
    currency: plan.currency,
    unit_amount: plan.unitAmountCents,
    recurring: { interval: plan.interval },
    lookup_key: plan.lookupKey,
    metadata: priceMetadata,
    // Moves the key off whatever Price currently holds it, atomically.
    transfer_lookup_key: true,
  });
  log("did", `created Price ${created.id} and transferred ${plan.lookupKey} onto it`);
}

async function convergePromotionCode(stripe: Stripe): Promise<void> {
  const existing = await stripe.promotionCodes.list({
    code: TEST_PROMOTION.code,
    limit: 1,
  });
  if (existing.data.length > 0) {
    log(APPLY ? "did" : "would", `promotion code ${TEST_PROMOTION.code} already exists`);
    return;
  }
  if (!APPLY) {
    log("would", `create coupon + promotion code ${TEST_PROMOTION.code}`);
    return;
  }
  const coupon = await stripe.coupons.create(
    {
      name: TEST_PROMOTION.couponName,
      percent_off: TEST_PROMOTION.percentOff,
      duration: "repeating",
      duration_in_months: TEST_PROMOTION.durationInMonths,
    },
    { idempotencyKey: `nixus-coupon-${TEST_PROMOTION.code}` },
  );
  const promotion = await stripe.promotionCodes.create(
    // API version 2026-10-28.endive replaced the flat `coupon` parameter with this
    // discriminated `promotion` object. The flat form is rejected outright.
    { promotion: { type: "coupon", coupon: coupon.id }, code: TEST_PROMOTION.code },
    { idempotencyKey: `nixus-promo-${TEST_PROMOTION.code}` },
  );
  log("did", `created promotion code ${promotion.code}`);
}

/**
 * Converges the webhook endpoint. The signing secret is returned ONLY on create — Stripe never
 * discloses it again — so this prints the one line an operator pipes into SSM, and prints nothing
 * on a converging run. The secret is written to stderr-free stdout under an explicit marker so it
 * is never mistaken for ordinary log output.
 */
async function convergeWebhookEndpoint(
  stripe: Stripe,
  url: string,
): Promise<void> {
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url !== url) continue;
    const missing = WEBHOOK_EVENTS.filter(
      (event) => !endpoint.enabled_events.includes(event),
    );
    if (missing.length === 0) {
      log(APPLY ? "did" : "would", `webhook endpoint ${endpoint.id} already correct`);
      return;
    }
    if (!APPLY) {
      log("would", `add events to ${endpoint.id}: ${missing.join(", ")}`);
      return;
    }
    await stripe.webhookEndpoints.update(endpoint.id, {
      enabled_events: [...WEBHOOK_EVENTS],
    });
    log("did", `updated webhook endpoint ${endpoint.id} event set`);
    return;
  }

  if (!APPLY) {
    log("would", `create webhook endpoint ${url} for ${WEBHOOK_EVENTS.length} events`);
    return;
  }
  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: [...WEBHOOK_EVENTS],
    description: "nixus-billing entitlement authority",
  });
  log("did", `created webhook endpoint ${created.id}`);
  process.stdout.write(
    [
      "",
      "=== WEBHOOK SIGNING SECRET — shown once, by Stripe, and never again ===",
      "Store it now, without echoing it anywhere else:",
      "",
      `  aws ssm put-parameter --profile temp --region us-east-1 --type SecureString --overwrite \\`,
      `    --name /nixus-billing/stripe-webhook-secret --value '${created.secret ?? ""}'`,
      "",
      "=======================================================================",
      "",
    ].join("\n"),
  );
}

/**
 * Turns plan switching ON for the SANDBOX portal configuration.
 *
 * `proration_behavior: "create_prorations"` because an upgrade takes effect
 * immediately (billing AD-11), and an immediate change the customer is neither
 * charged nor credited for would be a silent price change.
 *
 * MEASURED LIMITATION, 2026-11-19: `features.subscription_update.products` is
 * **silently dropped**. Stripe accepts the array with no error and returns a
 * configuration where the field is absent entirely - not `[]`, not `null` - and
 * a fresh retrieve agrees. So this call can enable the feature and set the
 * proration and allowed-update behaviour, but it CANNOT restrict which products
 * a customer may switch between. That half stays a Dashboard action, which is
 * why the idempotency check below deliberately does not look at `products`: a
 * field that can never be set would make every run re-apply forever.
 *
 * SANDBOX only. The live-mode portal remains an owner action in full.
 */
async function convergePortalConfiguration(stripe: Stripe): Promise<void> {
  const prices = await stripe.prices.list({
    lookup_keys: PLANS.map((plan) => plan.lookupKey),
    active: true,
    expand: ["data.product"],
  });

  const pricesByProduct = new Map<string, string[]>();
  for (const price of prices.data) {
    const product = price.product;
    if (typeof product === "string" || product.deleted === true) continue;
    pricesByProduct.set(product.id, [
      ...(pricesByProduct.get(product.id) ?? []),
      price.id,
    ]);
  }
  const switchable = [...pricesByProduct].map(([product, priceIds]) => ({
    product,
    prices: priceIds,
  }));

  const configurations = await stripe.billingPortal.configurations.list({ limit: 10 });
  const target = configurations.data.find((entry) => entry.is_default);
  if (target === undefined) {
    log("would", "skip portal: the account has no default configuration");
    return;
  }

  const update = target.features.subscription_update;
  const alreadyCorrect =
    update?.enabled === true &&
    update.default_allowed_updates.includes("price") &&
    update.proration_behavior === "create_prorations";

  if (alreadyCorrect) {
    log(APPLY ? "did" : "would", `portal ${target.id} already allows plan switching`);
    return;
  }
  if (!APPLY) {
    log("would", `enable plan switching on portal ${target.id} for ${PLANS.length} tiers`);
    return;
  }

  await stripe.billingPortal.configurations.update(target.id, {
    features: {
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        // Sent even though Stripe drops it, so the intent is on the wire and a
        // future API that honours it needs no change here.
        products: switchable,
        proration_behavior: "create_prorations",
      },
    },
  });
  log(
    "did",
    `enabled plan switching on portal ${target.id}; the switchable-product list is NOT settable by API and remains a Dashboard action`,
  );
}

async function main(): Promise<void> {
  const secretKey = requireEnv("STRIPE_SECRET_KEY");
  assertSandboxKey(secretKey);
  const webhookUrl = requireEnv("NIXUS_WEBHOOK_URL");
  if (!webhookUrl.startsWith("https://")) {
    throw new Error("NIXUS_WEBHOOK_URL must be https");
  }

  for (const plan of PLANS) assertPlanIsContractValid(plan);

  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
  });

  process.stdout.write(
    `Stripe sandbox setup — mode=test ${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}\n\n`,
  );

  // A tier has one Product and one Price per interval, so the Product is converged once per tier.
  const productIds = new Map<string, string | undefined>();
  for (const plan of PLANS) {
    if (!productIds.has(plan.tier)) {
      productIds.set(plan.tier, await convergeProduct(stripe, plan));
    }
    await convergePrice(stripe, plan, productIds.get(plan.tier));
  }
  await convergePromotionCode(stripe);
  await convergeWebhookEndpoint(stripe, webhookUrl);
  await convergePortalConfiguration(stripe);

  process.stdout.write(
    "\nDone. Dashboard-only items this script deliberately does not touch:\n" +
      "  - Managed Payments enablement and the business location\n" +
      "  - the LIVE Customer Portal configuration (the sandbox one is set above)\n" +
      "  - the dunning / smart-retry schedule, which is the ONLY grace period in the system (AD-11)\n" +
      "  - the free-trial reminder email (Settings > Subscriptions and emails): Stripe sends it 7 days\n" +
      "    before a trial ends and never in a sandbox, so it has to be switched on in live mode\n" +
      "  - live mode\n",
  );
}

main().catch((error: unknown) => {
  // Never print the error object wholesale: a Stripe error can carry the request body.
  process.stderr.write(
    `stripe-sandbox-setup failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
