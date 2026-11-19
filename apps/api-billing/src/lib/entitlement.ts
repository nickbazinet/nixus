import {
  ENTITLEMENT_STATUSES,
  isEntitlementStatus,
  toBillingCapabilities,
  toEntitlementStatus,
  type BillingCapability,
  type EntitlementResponse,
  type EntitlementSource,
  type EntitlementStatus,
} from "@nixus/shared";
import type Stripe from "stripe";

import { deriveProductGrant, expandedProductOf } from "./catalog.ts";
import { logBillingAnomaly } from "./logging.ts";
import { emitBillingMetric } from "./metrics.ts";

/*
 * The pure derivation at the centre of AD-5: a Stripe `Subscription` plus the
 * Product metadata it points at becomes the entitlement the authority records.
 * Nothing here reads the environment, calls Stripe, or writes DynamoDB, which is
 * what makes every rule below a unit test rather than an integration one.
 */

/** A signed-in account with no subscription record. A real tier, not an absence. */
export const FREE_TIER = "free";

/**
 * THE predicate, and deliberately the only one: which statuses grant
 * capabilities is decided here and may not be re-derived anywhere else.
 *
 * `past_due` GRANTS. Dunning grace is Stripe's, configured in the Dashboard
 * (AD-11), so Nixus keeps granting for exactly as long as Stripe reports the
 * subscription live and hard-codes no retry window of its own. The alternative -
 * revoking on the first failed charge - would cut off a customer whose smart
 * retry was going to succeed.
 *
 * Every other member grants NOTHING: `canceled`, `unpaid`, `incomplete`,
 * `incomplete_expired`, `paused` and `none`.
 */
export const GRANTING_ENTITLEMENT_STATUSES: readonly EntitlementStatus[] = [
  "active",
  "trialing",
  "past_due",
];

export function grantsCapabilities(status: EntitlementStatus): boolean {
  return GRANTING_ENTITLEMENT_STATUSES.includes(status);
}

/**
 * Stripe's `Subscription.status` is a wider, open-ended union than the
 * contract's. A value this build does not contain maps to `none` - which grants
 * nothing - and is logged, rather than being invented into the closed union
 * where it would need a grant decision nobody made.
 */
export function entitlementStatusFromStripe(args: {
  readonly status: string;
  readonly requestId: string;
}): EntitlementStatus {
  if (isEntitlementStatus(args.status)) return args.status;

  logBillingAnomaly({
    request_id: args.requestId,
    anomaly: "unknown_subscription_status",
  });
  return toEntitlementStatus(args.status);
}

/**
 * `current_period_end` is NOT on the Subscription object: it lives on each
 * subscription ITEM. With several items the MINIMUM is taken, because that is
 * the earliest moment the grant could lapse and a statement must never outlive
 * the shortest period it depends on.
 *
 * No items at all is a malformed subscription rather than an eternal one, so it
 * yields `null`.
 */
export function subscriptionPeriodEnd(
  subscription: Stripe.Subscription,
): number | null {
  const ends = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((end): end is number => typeof end === "number");

  return ends.length === 0 ? null : Math.min(...ends);
}

export interface DerivedEntitlement {
  readonly tier: string;
  readonly capabilities: readonly BillingCapability[];
  readonly status: EntitlementStatus;
  readonly current_period_end: number | null;
  readonly monthly_request_limit: number | null;
  /** AD-6's paid-but-capability-less case reached this derivation. */
  readonly malformed: boolean;
}

export const FREE_ENTITLEMENT: DerivedEntitlement = {
  tier: FREE_TIER,
  capabilities: [],
  status: "none",
  current_period_end: null,
  monthly_request_limit: null,
  malformed: false,
};

interface SubscriptionGrant {
  readonly tier: string;
  readonly capabilities: readonly BillingCapability[];
  readonly monthlyRequestLimit: number | null;
  readonly malformed: boolean;
}

/**
 * One subscription's grant. A subscription normally carries one item; when it
 * carries several, the capability grant is the UNION of their Products and the
 * tier LABEL comes from the first item, because a tier is a display and
 * operations string and never a gate (AD-1) while a capability is the thing that
 * must not be silently dropped.
 */
function grantOf(
  subscription: Stripe.Subscription,
  requestId: string,
): SubscriptionGrant {
  const grants = subscription.items.data.map((item) =>
    deriveProductGrant({
      product: expandedProductOf(item.price),
      requestId,
    }),
  );

  const first = grants[0];
  if (first === undefined) {
    return { tier: "", capabilities: [], monthlyRequestLimit: null, malformed: true };
  }

  return {
    tier: first.tier,
    capabilities: toBillingCapabilities(
      grants.flatMap((grant) => [...grant.capabilities]),
    ),
    monthlyRequestLimit: grants.reduce<number | null>(
      (limit, grant) =>
        grant.monthlyRequestLimit === null
          ? limit
          : Math.max(limit ?? 0, grant.monthlyRequestLimit),
      null,
    ),
    malformed: grants.some((grant) => grant.malformed),
  };
}

/** Deterministic ordering, so two invocations given the same set derive the same
 * tier label rather than whichever Stripe happened to list first. */
function byId(a: Stripe.Subscription, b: Stripe.Subscription): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * AD-5's derivation, and AD-18's duplicate-subscription rule.
 *
 * More than one LIVE subscription for one `sub` is a DEFECT, not a state to
 * model: the union of capabilities is granted so nobody loses access while an
 * operator reconciles, the alarm metric fires, and the architecture never
 * silently picks one.
 */
export function deriveEntitlement(args: {
  readonly subscriptions: readonly Stripe.Subscription[];
  readonly requestId: string;
}): DerivedEntitlement {
  const { subscriptions, requestId } = args;
  if (subscriptions.length === 0) return FREE_ENTITLEMENT;

  const ordered = [...subscriptions].sort(byId);
  const statuses = new Map<string, EntitlementStatus>(
    ordered.map((subscription) => [
      subscription.id,
      entitlementStatusFromStripe({ status: subscription.status, requestId }),
    ]),
  );

  const live = ordered.filter((subscription) =>
    grantsCapabilities(statuses.get(subscription.id) ?? "none"),
  );

  if (live.length > 1) {
    logBillingAnomaly({
      request_id: requestId,
      anomaly: "duplicate_live_subscription",
    });
    void emitBillingMetric("DuplicateSubscription");
  }

  const considered = live.length > 0 ? live : [ordered[0]!];
  const grants = considered.map((subscription) =>
    grantOf(subscription, requestId),
  );
  const periodEnds = considered
    .map((subscription) => subscriptionPeriodEnd(subscription))
    .filter((end): end is number => end !== null);

  const granting = live.length > 0;
  const malformed = grants.some((grant) => grant.malformed);
  const capabilities = toBillingCapabilities(
    grants.flatMap((grant) => [...grant.capabilities]),
  );

  return {
    tier: grants[0]!.tier,
    // A status Stripe does not report as live grants nothing, whatever the
    // Product metadata says.
    capabilities: granting ? capabilities : [],
    status: statuses.get(considered[0]!.id) ?? "none",
    current_period_end: periodEnds.length === 0 ? null : Math.min(...periodEnds),
    monthly_request_limit: granting
      ? grants.reduce<number | null>(
          (limit, grant) =>
            grant.monthlyRequestLimit === null
              ? limit
              : Math.max(limit ?? 0, grant.monthlyRequestLimit),
          null,
        )
      : null,
    malformed,
  };
}

/*
 * The stored `ENTITLEMENT` item (AD-4). Every attribute name is spelled here and
 * nowhere else, so the webhook writer, the admin writer and the read path cannot
 * drift apart on one.
 */

export const ENTITLEMENT_ATTRIBUTES = {
  tier: "tier",
  capabilities: "capabilities",
  status: "status",
  currentPeriodEnd: "current_period_end",
  monthlyRequestLimit: "monthly_request_limit",
  source: "source",
  statement: "statement",
  statementExp: "statement_exp",
  statementIat: "statement_iat",
  createdAt: "created_at",
  updatedAt: "updated_at",
  adminExpiresAt: "admin_expires_at",
  adminReason: "admin_reason",
  adminActor: "admin_actor",
  /* AD-2's separate attributes: while an override is live a converging webhook
   * records the Stripe-derived state HERE and does not touch the live grant, so
   * the override is restorable from recorded state once it expires. */
  stripeTier: "stripe_tier",
  stripeCapabilities: "stripe_capabilities",
  stripeStatus: "stripe_status",
  stripeCurrentPeriodEnd: "stripe_current_period_end",
  stripeMonthlyRequestLimit: "stripe_monthly_request_limit",
} as const;

export interface EntitlementRecord {
  readonly tier: string;
  readonly capabilities: readonly BillingCapability[];
  readonly status: EntitlementStatus;
  readonly current_period_end: number | null;
  readonly monthly_request_limit: number | null;
  readonly source: EntitlementSource;
  readonly statement: string;
  readonly statement_exp: number;
  readonly statement_iat: number;
  readonly version: number;
  readonly event_watermark: number | null;
  readonly admin_expires_at: number | null;
  readonly stripe_state: DerivedEntitlement | null;
}

function readString(item: Record<string, unknown>, name: string): string {
  const value = item[name];
  return typeof value === "string" ? value : "";
}

function readNumberOrNull(
  item: Record<string, unknown>,
  name: string,
): number | null {
  const value = item[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readSource(item: Record<string, unknown>): EntitlementSource {
  const value = item[ENTITLEMENT_ATTRIBUTES.source];
  // `stripe` is the conservative default: it is the only source that a
  // converging webhook may overwrite without AD-2's precedence check.
  return value === "admin" || value === "app_store" || value === "play"
    ? value
    : "stripe";
}

/**
 * The stored item read back into the shape every writer and the read path share.
 * A record missing the recorded Stripe state carries `null` rather than a
 * fabricated one, so "no override has ever converged over this" stays
 * distinguishable from "the Stripe state is free".
 */
export function toEntitlementRecord(
  item: Record<string, unknown>,
): EntitlementRecord {
  const recordedStatus = item[ENTITLEMENT_ATTRIBUTES.stripeStatus];

  return {
    tier: readString(item, ENTITLEMENT_ATTRIBUTES.tier),
    capabilities: toBillingCapabilities(
      item[ENTITLEMENT_ATTRIBUTES.capabilities],
    ),
    status: toEntitlementStatus(item[ENTITLEMENT_ATTRIBUTES.status]),
    current_period_end: readNumberOrNull(
      item,
      ENTITLEMENT_ATTRIBUTES.currentPeriodEnd,
    ),
    monthly_request_limit: readNumberOrNull(
      item,
      ENTITLEMENT_ATTRIBUTES.monthlyRequestLimit,
    ),
    source: readSource(item),
    statement: readString(item, ENTITLEMENT_ATTRIBUTES.statement),
    statement_exp: readNumberOrNull(item, ENTITLEMENT_ATTRIBUTES.statementExp) ?? 0,
    statement_iat: readNumberOrNull(item, ENTITLEMENT_ATTRIBUTES.statementIat) ?? 0,
    version: readNumberOrNull(item, "version") ?? 0,
    event_watermark: readNumberOrNull(item, "event_watermark"),
    admin_expires_at: readNumberOrNull(
      item,
      ENTITLEMENT_ATTRIBUTES.adminExpiresAt,
    ),
    stripe_state:
      typeof recordedStatus === "string"
        ? {
            tier: readString(item, ENTITLEMENT_ATTRIBUTES.stripeTier),
            capabilities: toBillingCapabilities(
              item[ENTITLEMENT_ATTRIBUTES.stripeCapabilities],
            ),
            status: toEntitlementStatus(recordedStatus),
            current_period_end: readNumberOrNull(
              item,
              ENTITLEMENT_ATTRIBUTES.stripeCurrentPeriodEnd,
            ),
            monthly_request_limit: readNumberOrNull(
              item,
              ENTITLEMENT_ATTRIBUTES.stripeMonthlyRequestLimit,
            ),
            malformed: false,
          }
        : null,
  };
}

/** An override OUT-RANKS a converging webhook only while it is live. Expiry is
 * evaluated against the server clock, never against a client-supplied one. */
export function isAdminOverrideLive(args: {
  readonly source: EntitlementSource;
  readonly adminExpiresAt: number | null;
  readonly nowSeconds: number;
}): boolean {
  return (
    args.source === "admin" &&
    args.adminExpiresAt !== null &&
    args.adminExpiresAt > args.nowSeconds
  );
}

/** The wire projection (AD-13). `version` is `null` only on a free entitlement
 * derived with no stored record. */
export function toEntitlementResponse(args: {
  readonly state: DerivedEntitlement;
  readonly source: EntitlementSource;
  readonly statement: string;
  readonly statementExp: number;
  readonly version: number | null;
}): EntitlementResponse {
  return {
    tier: args.state.tier,
    capabilities: args.state.capabilities,
    status: args.state.status,
    current_period_end: args.state.current_period_end,
    monthly_request_limit: args.state.monthly_request_limit,
    source: args.source,
    statement: args.statement,
    statement_exp: args.statementExp,
    version: args.version,
  };
}

/** Exported so a spec can assert the granting set is a strict subset of the
 * contract's union rather than a parallel list that drifted. */
export const ALL_ENTITLEMENT_STATUSES = ENTITLEMENT_STATUSES;
