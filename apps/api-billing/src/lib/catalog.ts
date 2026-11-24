import {
  isPlanLookupKeyShaped,
  toBillingCapabilities,
  PLAN_TRIAL_MAX_DAYS,
  type BillingCapability,
  type PlanCatalogEntry,
  type PlanInterval,
} from "@nixus/shared";
import type Stripe from "stripe";

import { logDroppedCapability } from "./logging.ts";
import { emitBillingMetric } from "./metrics.ts";
import { getStripeClient } from "./stripe.ts";

/*
 * AD-6: Stripe IS the catalog. No amount, currency amount, `price_id` or
 * tier->capability table appears in this file or any other; everything below is
 * read from Stripe at runtime and validated against the closed capability union.
 *
 * THE metadata contract, authoritative for the setup script that creates the
 * Products. These four keys on the Stripe PRODUCT are the entire interface
 * between an operator and this service:
 *
 *   nixus_tier                   required  opaque lowercase snake_case code
 *   nixus_capabilities           required  comma-separated BILLING_CAPABILITIES names
 *   nixus_monthly_request_limit  optional  positive integer, absent means no limit
 *   nixus_display_order          optional  positive integer, ascending
 *
 * Absent, empty or unparseable `nixus_tier` or `nixus_capabilities` is the
 * MALFORMED case AD-6 defines rather than discovers: no capability is granted and
 * `CatalogMetadataMalformed` is emitted so the alarm fires. A typo therefore
 * never grants a capability, and never silently revokes one without an alert.
 *
 * One key lives on the PRICE rather than on the Product, because it varies
 * between two Prices of the same tier:
 *
 *   nixus_trial_days             optional  positive integer <= PLAN_TRIAL_MAX_DAYS
 *
 * It exists because Stripe Checkout honours a free trial only when the SESSION
 * asks for one: `subscription_data.trial_period_days` (or `trial_end`) is the
 * documented parameter, a trial configured on the Price object is not read by
 * Checkout, and the newer Trial Offer objects are not supported by Checkout
 * Sessions outside a private preview. So the trial length has to reach this
 * service as configuration and be passed at session creation - which keeps it
 * operator-owned in Stripe rather than a literal in a handler.
 */

export const CATALOG_TIER_METADATA_KEY = "nixus_tier";
export const CATALOG_CAPABILITIES_METADATA_KEY = "nixus_capabilities";
export const CATALOG_MONTHLY_REQUEST_LIMIT_METADATA_KEY =
  "nixus_monthly_request_limit";
export const CATALOG_DISPLAY_ORDER_METADATA_KEY = "nixus_display_order";
export const CATALOG_TRIAL_DAYS_METADATA_KEY = "nixus_trial_days";

/** The same shape `validateAdminOverrideRequest` enforces, so one tier code is
 * acceptable to both writers. The value is never compared, only carried (AD-1). */
const TIER_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const TIER_MAX_LENGTH = 32;

/** `prices.list` accepts at most ten lookup keys per call, and the catalog is
 * read in ONE call so the whole answer shares one cache entry. */
const MAX_LOOKUP_KEYS = 10;

/**
 * The published key set is CONFIGURATION, not a list in a handler: adding a tier
 * is then a parameter change plus a Stripe Dashboard change, with no deploy
 * (AD-6). Order is significant - it is the `display_order` fallback.
 */
export function catalogLookupKeys(): readonly string[] {
  const configured = process.env.CATALOG_LOOKUP_KEYS;
  if (!configured) {
    throw new Error("CATALOG_LOOKUP_KEYS is not configured");
  }

  const keys = configured
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  if (keys.length === 0 || keys.length > MAX_LOOKUP_KEYS) {
    throw new Error("CATALOG_LOOKUP_KEYS is not configured");
  }
  for (const key of keys) {
    if (!isPlanLookupKeyShaped(key)) {
      // The configured VALUE is not echoed: it reaches logs and errors from here.
      throw new Error("CATALOG_LOOKUP_KEYS holds a malformed lookup key");
    }
  }
  return keys;
}

/**
 * THE single cache bound (AD-6), declared once in the stack. `GET /plans`
 * returns it as `cache_ttl_seconds` and the `Cache-Control` header derives from
 * it; no second TTL exists anywhere in this service.
 */
export function catalogCacheTtlSeconds(): number {
  const configured = process.env.CATALOG_CACHE_TTL_SECONDS;
  const parsed = Number(configured);
  if (!configured || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("CATALOG_CACHE_TTL_SECONDS is not configured");
  }
  return parsed;
}

/**
 * What a Stripe Product's metadata grants. Shared by the public catalog and by
 * AD-5's subscription derivation, so an operator's metadata is parsed by exactly
 * one implementation and the pricing page can never advertise a capability the
 * entitlement would not grant.
 */
export interface ProductGrant {
  readonly tier: string;
  readonly capabilities: readonly BillingCapability[];
  readonly monthlyRequestLimit: number | null;
  readonly displayOrder: number | null;
  /** AD-6's defined failure: recorded, alarmed, and granting nothing. */
  readonly malformed: boolean;
}

/**
 * `price.product` is an expandable field typed `string | Product | DeletedProduct`.
 * A caller that forgot `expand` would otherwise read `metadata` off a bare id
 * string and silently derive an empty grant, so the unexpanded case throws here
 * instead of being cast away.
 */
export function expandedProductOf(price: Stripe.Price): Stripe.Product {
  const product = price.product;
  if (typeof product === "string") {
    throw new Error("the Stripe Price was read without its Product expanded");
  }
  if (product.deleted === true) {
    throw new Error("the Stripe Price names a deleted Product");
  }
  return product;
}

function readMetadata(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readPositiveInteger(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
  maximum = Number.MAX_SAFE_INTEGER,
): { readonly value: number | null; readonly unparseable: boolean } {
  const raw = readMetadata(metadata, key);
  if (raw === undefined) return { value: null, unparseable: false };

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    return { value: null, unparseable: true };
  }
  return { value: parsed, unparseable: false };
}

function readTier(product: Stripe.Product): string | null {
  const tier = readMetadata(product.metadata, CATALOG_TIER_METADATA_KEY);
  if (tier === undefined) return null;
  if (tier.length > TIER_MAX_LENGTH || !TIER_PATTERN.test(tier)) return null;
  return tier;
}

/**
 * The trial length this Price is sold with, read from PRICE metadata.
 *
 * An out-of-range or non-integer value is `unparseable` rather than "no trial":
 * a Price advertised as a trial that Checkout would open at full price is the
 * one outcome a customer would call fraud, so it is refused and alarmed like any
 * other malformed metadata (AD-6) instead of degrading to a sale.
 */
function readTrialDays(
  price: Stripe.Price,
): { readonly value: number | null; readonly unparseable: boolean } {
  return readPositiveInteger(
    price.metadata,
    CATALOG_TRIAL_DAYS_METADATA_KEY,
    PLAN_TRIAL_MAX_DAYS,
  );
}

/**
 * An unrecognised capability name is DROPPED with a warning rather than
 * refused, because an operator's typo must not fail a paying customer's webhook
 * (AD-6). The name itself is loggable - it is operator-authored configuration,
 * not user data - and nothing else of the Product is.
 */
function readCapabilities(
  product: Stripe.Product,
  requestId: string,
): { readonly capabilities: readonly BillingCapability[]; readonly usable: boolean } {
  const raw = readMetadata(product.metadata, CATALOG_CAPABILITIES_METADATA_KEY);
  if (raw === undefined) return { capabilities: [], usable: false };

  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  const capabilities = toBillingCapabilities(names);
  for (const name of names) {
    if (!(capabilities as readonly string[]).includes(name)) {
      logDroppedCapability({ request_id: requestId, dropped_capability: name });
    }
  }

  // Names were supplied but none survived validation: unparseable, not merely
  // partially mistyped.
  return { capabilities, usable: names.length > 0 && capabilities.length > 0 };
}

/**
 * The ONE parser of AD-6's metadata contract. A malformed Product yields the
 * paid-but-capability-less grant and emits `CatalogMetadataMalformed`; the metric
 * is fire-and-forget because failing the caller would turn an operator's typo
 * into a failed webhook, which is the opposite of the intended behaviour.
 */
export function deriveProductGrant(args: {
  readonly product: Stripe.Product;
  readonly requestId: string;
}): ProductGrant {
  const { product, requestId } = args;

  const tier = readTier(product);
  const { capabilities, usable } = readCapabilities(product, requestId);
  const limit = readPositiveInteger(
    product.metadata,
    CATALOG_MONTHLY_REQUEST_LIMIT_METADATA_KEY,
  );
  const order = readPositiveInteger(
    product.metadata,
    CATALOG_DISPLAY_ORDER_METADATA_KEY,
  );

  const malformed =
    tier === null || !usable || limit.unparseable || order.unparseable;

  if (malformed) {
    void emitBillingMetric("CatalogMetadataMalformed");
  }

  return {
    tier: tier ?? "",
    // A malformed Product grants NOTHING, even if some capability name parsed.
    capabilities: malformed ? [] : capabilities,
    monthlyRequestLimit: malformed ? null : limit.value,
    displayOrder: order.value,
    malformed,
  };
}

/** One published plan, plus the `price_id` only this service may hold: the
 * public `PlanCatalogEntry` never carries it (AD-6). */
export interface CatalogPlan {
  readonly entry: PlanCatalogEntry;
  readonly priceId: string;
}

export interface Catalog {
  readonly plans: readonly CatalogPlan[];
  readonly cacheTtlSeconds: number;
}

function toInterval(price: Stripe.Price): PlanInterval | null {
  // Stripe types `recurring.interval` as an open union, so a value the contract
  // does not declare - `day`, `week`, or one Stripe adds later - is not an
  // interval this catalog can publish.
  const interval: string | undefined = price.recurring?.interval;
  return interval === "month" || interval === "year" ? interval : null;
}

function toCatalogPlan(args: {
  readonly price: Stripe.Price;
  readonly requestId: string;
  readonly configuredOrder: readonly string[];
}): CatalogPlan | null {
  const { price, requestId, configuredOrder } = args;

  const lookupKey = price.lookup_key;
  const interval = toInterval(price);
  if (
    lookupKey === null ||
    interval === null ||
    price.unit_amount === null ||
    price.active !== true
  ) {
    return null;
  }

  const grant = deriveProductGrant({
    product: expandedProductOf(price),
    requestId,
  });
  // A Product with no usable tier identity cannot be displayed or purchased, so
  // it is not published - the metric has already fired. An existing subscription
  // on it still converges, to the paid-but-capability-less entitlement AD-6
  // defines; that path reads the Product off the subscription, not this list.
  if (grant.malformed) return null;

  const trial = readTrialDays(price);
  if (trial.unparseable) {
    void emitBillingMetric("CatalogMetadataMalformed");
    return null;
  }

  // `display_order` is Stripe metadata when the operator set one, and otherwise
  // the 1-based position of the key in CATALOG_LOOKUP_KEYS - so the configured
  // order is the default and the Dashboard is the override.
  const fallbackOrder = configuredOrder.indexOf(lookupKey) + 1;

  return {
    priceId: price.id,
    entry: {
      tier: grant.tier,
      lookup_key: lookupKey,
      unit_amount_cents: price.unit_amount,
      // Stripe reports lowercase; the contract declares uppercase ISO 4217.
      currency: price.currency.toUpperCase(),
      interval,
      display_order: grant.displayOrder ?? fallbackOrder,
      capabilities: grant.capabilities,
      monthly_request_limit: grant.monthlyRequestLimit,
      trial_period_days: trial.value,
    },
  };
}

interface CacheEntry {
  readonly catalog: Catalog;
  readonly expiresAtMs: number;
}

/*
 * ONE in-process cache, bounded by ONE TTL (AD-6). It lives at module scope so
 * it is shared by every request an execution environment serves, and there is
 * deliberately no second cache anywhere in this service.
 */
let cached: CacheEntry | undefined;

/** Test seam: clears the single cache between specs. */
export function resetCatalogCacheForTesting(): void {
  cached = undefined;
}

export async function getCatalog(args: {
  readonly now: Date;
  readonly requestId: string;
}): Promise<Catalog> {
  const { now, requestId } = args;
  const ttlSeconds = catalogCacheTtlSeconds();

  if (cached && cached.expiresAtMs > now.getTime()) {
    return cached.catalog;
  }

  const lookupKeys = catalogLookupKeys();
  const stripe = await getStripeClient();
  const prices = await stripe.prices.list({
    lookup_keys: [...lookupKeys],
    expand: ["data.product"],
    active: true,
  });

  const plans = prices.data
    .map((price) =>
      toCatalogPlan({ price, requestId, configuredOrder: lookupKeys }),
    )
    .filter((plan): plan is CatalogPlan => plan !== null)
    .sort((a, b) => a.entry.display_order - b.entry.display_order);

  const catalog: Catalog = { plans, cacheTtlSeconds: ttlSeconds };
  cached = {
    catalog,
    expiresAtMs: now.getTime() + ttlSeconds * 1000,
  };
  return catalog;
}

/** `null` rather than a throw: whether a key is purchasable is the caller's
 * refusal to phrase, and the submitted value is never echoed (AD-8). */
export function planForLookupKey(
  catalog: Catalog,
  lookupKey: string,
): CatalogPlan | null {
  return catalog.plans.find((plan) => plan.entry.lookup_key === lookupKey) ?? null;
}
