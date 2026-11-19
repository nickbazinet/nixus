import type { EntitlementSource } from "@nixus/shared";
import type Stripe from "stripe";

import {
  deriveEntitlement,
  ENTITLEMENT_ATTRIBUTES,
  isAdminOverrideLive,
  toEntitlementRecord,
  type DerivedEntitlement,
} from "../lib/entitlement.ts";
import { BillingFailureError } from "../lib/errors.ts";
import { logBillingAnomaly } from "../lib/logging.ts";
import { emitBillingMetric } from "../lib/metrics.ts";
import { signStatement } from "../lib/signing.ts";
import {
  configuredStripeMode,
  getStripeClient,
  verifyStripeEvent,
} from "../lib/stripe.ts";
import {
  entitlementKey,
  eventMarkerKey,
  getItem,
  isUuidShaped,
  subForStripeCustomerId,
  writeEntitlementStateAdvance,
} from "../lib/table.ts";

/*
 * `POST /webhook` - unauthenticated at the edge, authenticated by the Stripe
 * signature INSIDE this handler (AD-3, AD-5).
 *
 * AD-5 fixes the order of operations and this file follows it with nothing
 * interleaved: verify the signature over the RAW bytes inside Stripe's timestamp
 * tolerance window, before the body is parsed and before any DynamoDB or Stripe
 * call -> reject an event whose `livemode` disagrees with the configured mode ->
 * acknowledge an irrelevant event type -> read the EVENT# marker and acknowledge
 * a known id as a no-op -> RE-FETCH the subscription from Stripe, because the
 * payload is a trigger and never the data source -> sign the statement -> write
 * the ENTITLEMENT item and the EVENT# marker in ONE transaction -> acknowledge.
 *
 * A signing failure fails the whole event, which Stripe then retries; the handler
 * never writes an entitlement it could not sign.
 */

export interface WebhookAck {
  readonly received: true;
}

const ACK: WebhookAck = { received: true };

/**
 * The CLOSED set of events that converge an entitlement. `invoice.paid` is the
 * current event, not the legacy `invoice.payment_succeeded`. Anything else -
 * a dispute, a trial reminder, or a type Stripe adds later - is acknowledged
 * with a 2xx and logged, never an error.
 *
 * A Stripe-INITIATED refund or cancellation arrives as one of these ordinary
 * types and is an ordinary event rather than an anomaly (AD-5).
 */
export const RELEVANT_EVENT_TYPES: readonly string[] = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "checkout.session.completed",
];

/** Written by `POST /checkout` into `subscription_data.metadata`, so the linkage
 * survives on the Subscription and appears on every later event (AD-8). */
export const SUBSCRIPTION_SUB_METADATA_KEY = "nixus_sub";

/**
 * How long an `EVENT#` dedupe marker is kept. A STORAGE-reclamation horizon, not
 * the dedupe window and not a grace period: Stripe retries a failed delivery for
 * about three days and DynamoDB deletes an expired item only "within a few
 * days", so 30 days covers both and a replay inside Stripe's own retry schedule
 * always finds its marker.
 */
const EVENT_MARKER_RETENTION_SECONDS = 30 * 24 * 60 * 60;

/** A refused signature, a stale timestamp and a `livemode` mismatch are one
 * answer: a 400 naming the request body and carrying nothing from it (AD-14). */
function failUnverifiable(): never {
  throw new BillingFailureError({
    code: "validation",
    field: "body",
    reason: "invalid_format",
  });
}

function readStoredString(
  item: Record<string, unknown> | undefined,
  name: string,
): string | null {
  const value = item?.[name];
  return typeof value === "string" ? value : null;
}

function idOf(value: string | { readonly id: string } | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * The subscription this event is about, from whichever shape its object has.
 *
 * `invoice.subscription` no longer exists: an Invoice names its subscription
 * through `parent.subscription_details.subscription`. An event with no
 * subscription at all - a one-off invoice, or a Checkout Session that bought
 * nothing recurring - yields `null` and is acknowledged with nothing to converge.
 */
export function subscriptionIdOf(event: Stripe.Event): string | null {
  const object = event.data.object;

  if (object.object === "subscription") return object.id;
  if (object.object === "invoice") {
    return idOf(object.parent?.subscription_details?.subscription ?? null);
  }
  if (object.object === "checkout.session") return idOf(object.subscription);
  return null;
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && isUuidShaped(value) ? value : null;
}

/**
 * The `sub` the EVENT PAYLOAD itself carries, if any. This is what lets AD-5's
 * dedupe read come BEFORE the Stripe re-fetch: a replay of any event produced by
 * this service's own checkout is recognised without a single outbound call,
 * because `POST /checkout` puts the linkage on the Subscription and Stripe
 * snapshots it onto every Invoice.
 *
 * The payload is still never a DATA source - only an identity hint, and a
 * shape-checked one. The entitlement is always derived from the re-fetched
 * subscription.
 */
export function subFromEventPayload(event: Stripe.Event): string | null {
  const object = event.data.object;

  if (object.object === "subscription") {
    return uuidOrNull(object.metadata?.[SUBSCRIPTION_SUB_METADATA_KEY]);
  }
  if (object.object === "invoice") {
    return uuidOrNull(
      object.parent?.subscription_details?.metadata?.[
        SUBSCRIPTION_SUB_METADATA_KEY
      ],
    );
  }
  if (object.object === "checkout.session") {
    return (
      uuidOrNull(object.client_reference_id) ??
      uuidOrNull(object.metadata?.[SUBSCRIPTION_SUB_METADATA_KEY])
    );
  }
  return null;
}

/**
 * AD-5's `sub` resolution for an event whose payload carried no linkage. A
 * webhook arrives keyed by Stripe CUSTOMER and never by `sub`, so the re-fetched
 * subscription's metadata is tried and then the GSI - the only route home for a
 * subscription created outside this service.
 */
async function resolveSubFromSubscription(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const fromMetadata = uuidOrNull(
    subscription.metadata?.[SUBSCRIPTION_SUB_METADATA_KEY],
  );
  if (fromMetadata !== null) return fromMetadata;

  const customerId = idOf(subscription.customer);
  return customerId === null ? null : subForStripeCustomerId(customerId);
}

/**
 * EVERY subscription of the customer, not only the one the event named: AD-18
 * requires the authority to grant the UNION when one `sub` somehow holds more
 * than one live subscription, and it cannot notice a second one by looking at
 * the first.
 *
 * `expand` carries `items.data.price.product` because the tier and the
 * capability list live in Product metadata, and because `current_period_end` is
 * on the ITEMS rather than on the subscription.
 */
async function fetchSubscriptions(args: {
  readonly stripe: Stripe;
  readonly subscriptionId: string;
}): Promise<readonly Stripe.Subscription[]> {
  const { stripe, subscriptionId } = args;

  const named = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product"],
  });

  const customerId = idOf(named.customer);
  if (customerId === null) return [named];

  const all = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    expand: ["data.items.data.price.product"],
  });

  // The named subscription is authoritative for itself: the list is a second
  // read and may not yet reflect a just-created subscription.
  return [named, ...all.data.filter((entry) => entry.id !== named.id)];
}

/**
 * AD-5's watermark, and the justification for the choice.
 *
 * `event.created` (Unix SECONDS) is used as-is, with no synthetic tiebreak,
 * because a tiebreak derived from this service's own clock or from the delivery
 * order would not be monotonic in the order STRIPE generated the events - and
 * that is the only ordering the guard exists to respect. Two events CAN share a
 * second, so the strictly-advancing condition can refuse a genuinely newer
 * event; that case is handled by `convergedByNewerEvent` below, which
 * acknowledges instead of failing. Acknowledging is sound precisely because this
 * handler CONVERGES: every write records what Stripe reported at fetch time, so
 * losing the race means the state that won is at least as fresh as the one that
 * lost.
 */
export function eventWatermark(event: Stripe.Event): number {
  return event.created;
}

/**
 * Distinguishes AD-5's two conflicts, which `writeEntitlementStateAdvance`
 * reports as one. A stored watermark at or above ours means a newer event
 * already converged this entitlement - benign. Anything else is a genuine
 * version race, which has to fail so Stripe retries.
 */
async function convergedByNewerEvent(args: {
  readonly sub: string;
  readonly watermark: number;
}): Promise<boolean> {
  const item = await getItem(entitlementKey(args.sub));
  if (item === undefined) return false;

  const stored = toEntitlementRecord(item).event_watermark;
  return stored !== null && stored >= args.watermark;
}

interface EffectiveState {
  readonly state: DerivedEntitlement;
  readonly source: EntitlementSource;
  readonly adminExpiresAt: number | null;
  readonly adminReason: string | null;
  readonly adminActor: string | null;
}

const STRIPE_SOURCED = {
  source: "stripe",
  adminExpiresAt: null,
  adminReason: null,
  adminActor: null,
} as const satisfies Omit<EffectiveState, "state">;

/**
 * AD-2's precedence, applied at the one place a converging webhook could violate
 * it.
 *
 * While an override is LIVE the Stripe-derived state is recorded in the separate
 * `stripe_*` attributes and the live grant is left exactly as the administrator
 * set it. Once the override has EXPIRED the next convergence restores the
 * Stripe-derived state - which is why the shadow attributes are written on every
 * convergence rather than only on the first.
 */
function effectiveState(args: {
  readonly derived: DerivedEntitlement;
  readonly stored: Record<string, unknown> | undefined;
  readonly nowSeconds: number;
  readonly requestId: string;
  readonly event: Stripe.Event;
}): EffectiveState {
  const { derived, stored, nowSeconds } = args;
  if (stored === undefined) return { state: derived, ...STRIPE_SOURCED };

  const record = toEntitlementRecord(stored);
  const live = isAdminOverrideLive({
    source: record.source,
    adminExpiresAt: record.admin_expires_at,
    nowSeconds,
  });
  if (!live) return { state: derived, ...STRIPE_SOURCED };

  logBillingAnomaly({
    request_id: args.requestId,
    anomaly: "admin_override_precedence",
    stripe_event_type: args.event.type,
    stripe_event_id: args.event.id,
  });

  return {
    state: {
      tier: record.tier,
      capabilities: record.capabilities,
      status: record.status,
      current_period_end: record.current_period_end,
      monthly_request_limit: record.monthly_request_limit,
      malformed: false,
    },
    source: "admin",
    adminExpiresAt: record.admin_expires_at,
    adminReason: readStoredString(stored, ENTITLEMENT_ATTRIBUTES.adminReason),
    adminActor: readStoredString(stored, ENTITLEMENT_ATTRIBUTES.adminActor),
  };
}

function entitlementItem(args: {
  readonly sub: string;
  readonly effective: EffectiveState;
  readonly recordedStripeState: DerivedEntitlement;
  readonly statement: string;
  readonly statementIat: number;
  readonly statementExp: number;
  readonly version: number;
  readonly watermark: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}): Record<string, unknown> {
  const { effective, recordedStripeState: recorded } = args;
  const attribute = ENTITLEMENT_ATTRIBUTES;

  return {
    ...entitlementKey(args.sub),
    [attribute.tier]: effective.state.tier,
    [attribute.capabilities]: [...effective.state.capabilities],
    [attribute.status]: effective.state.status,
    [attribute.currentPeriodEnd]: effective.state.current_period_end,
    [attribute.monthlyRequestLimit]: effective.state.monthly_request_limit,
    [attribute.source]: effective.source,
    [attribute.statement]: args.statement,
    [attribute.statementIat]: args.statementIat,
    [attribute.statementExp]: args.statementExp,
    version: args.version,
    event_watermark: args.watermark,
    [attribute.createdAt]: args.createdAt,
    [attribute.updatedAt]: args.updatedAt,
    [attribute.adminExpiresAt]: effective.adminExpiresAt,
    [attribute.adminReason]: effective.adminReason,
    [attribute.adminActor]: effective.adminActor,
    [attribute.stripeTier]: recorded.tier,
    [attribute.stripeCapabilities]: [...recorded.capabilities],
    [attribute.stripeStatus]: recorded.status,
    [attribute.stripeCurrentPeriodEnd]: recorded.current_period_end,
    [attribute.stripeMonthlyRequestLimit]: recorded.monthly_request_limit,
  };
}

async function isReplay(sub: string, eventId: string): Promise<boolean> {
  return (await getItem(eventMarkerKey(sub, eventId))) !== undefined;
}

function isVersionConflict(error: unknown): boolean {
  return (
    error instanceof BillingFailureError &&
    error.failure.code === "version_conflict"
  );
}

export async function handleWebhook(args: {
  readonly rawBody: Buffer;
  readonly signatureHeader: string | null;
  readonly now: Date;
  readonly requestId: string;
}): Promise<WebhookAck> {
  const { rawBody, signatureHeader, now, requestId } = args;

  if (signatureHeader === null) {
    logBillingAnomaly({ request_id: requestId, anomaly: "signature_rejected" });
    failUnverifiable();
  }

  let event: Stripe.Event;
  try {
    event = await verifyStripeEvent({ rawBody, signatureHeader });
  } catch {
    // A forged signature AND a request outside the tolerance window both land
    // here: the SDK refuses both, and the distinction is not a caller's business.
    logBillingAnomaly({ request_id: requestId, anomaly: "signature_rejected" });
    failUnverifiable();
  }

  if (event.livemode !== ((await configuredStripeMode()) === "live")) {
    logBillingAnomaly({
      request_id: requestId,
      anomaly: "livemode_mismatch",
      stripe_event_type: event.type,
      stripe_event_id: event.id,
    });
    failUnverifiable();
  }

  if (!RELEVANT_EVENT_TYPES.includes(event.type)) {
    logBillingAnomaly({
      request_id: requestId,
      anomaly: "unrecognised_event_type",
      stripe_event_type: event.type,
      stripe_event_id: event.id,
    });
    return ACK;
  }

  const subscriptionId = subscriptionIdOf(event);
  if (subscriptionId === null) return ACK;

  try {
    return await converge({ event, subscriptionId, now, requestId });
  } catch (error) {
    if (error instanceof BillingFailureError) throw error;
    // The dedicated alarm reads this metric, so an entitlement that never
    // converged is distinguishable from an ordinary 5xx (AD-15).
    await emitBillingMetric("WebhookFailure");
    throw error;
  }
}

async function converge(args: {
  readonly event: Stripe.Event;
  readonly subscriptionId: string;
  readonly now: Date;
  readonly requestId: string;
}): Promise<WebhookAck> {
  const { event, subscriptionId, now, requestId } = args;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const watermark = eventWatermark(event);

  // The dedupe READ comes first for every event whose payload carries the
  // linkage, which is every event this service's own checkout produced: a replay
  // then costs one strongly-consistent read and NO outbound call.
  const hinted = subFromEventPayload(event);
  if (hinted !== null && (await isReplay(hinted, event.id))) return ACK;

  const stripe = await getStripeClient();
  const subscriptions = await fetchSubscriptions({ stripe, subscriptionId });
  const named = subscriptions[0]!;

  const sub = hinted ?? (await resolveSubFromSubscription(named));
  if (sub === null) {
    // Nothing to converge: the customer is unknown to the authority. Logged and
    // acknowledged rather than retried, because a retry cannot make an account
    // appear.
    logBillingAnomaly({
      request_id: requestId,
      anomaly: "unrecognised_event_type",
      stripe_event_type: event.type,
      stripe_event_id: event.id,
    });
    return ACK;
  }

  // The same read for the fallback path, which could not run it any earlier: the
  // GSI lookup that produced the `sub` needs the customer id off the re-fetched
  // subscription. It still precedes every derivation, every signature and every
  // write.
  if (hinted === null && (await isReplay(sub, event.id))) return ACK;

  const stored = await getItem(entitlementKey(sub));
  const record = stored === undefined ? undefined : toEntitlementRecord(stored);

  const derived = deriveEntitlement({ subscriptions, requestId });
  const effective = effectiveState({
    derived,
    stored,
    nowSeconds,
    requestId,
    event,
  });

  // Signed BEFORE the write, and a failure propagates untouched: the handler
  // never writes an entitlement it could not sign (AD-5).
  const signed = await signStatement({
    sub,
    tier: effective.state.tier,
    capabilities: effective.state.capabilities,
    monthlyRequestLimit: effective.state.monthly_request_limit,
    currentPeriodEnd: effective.state.current_period_end,
    now,
  });

  const timestamp = now.toISOString();
  const item = entitlementItem({
    sub,
    effective,
    recordedStripeState: derived,
    statement: signed.statement,
    statementIat: signed.claims.iat,
    statementExp: signed.claims.exp,
    version: (record?.version ?? 0) + 1,
    watermark,
    createdAt:
      readStoredString(stored, ENTITLEMENT_ATTRIBUTES.createdAt) ?? timestamp,
    updatedAt: timestamp,
  });

  try {
    const outcome = await writeEntitlementStateAdvance({
      sub,
      entitlementItem: item,
      expectedVersion: record?.version ?? null,
      eventId: event.id,
      eventWatermark: watermark,
      eventMarkerExpiresAt: nowSeconds + EVENT_MARKER_RETENTION_SECONDS,
    });
    // `duplicate_event` is a replay that raced the dedupe read above.
    void outcome;
  } catch (error) {
    if (!isVersionConflict(error)) throw error;

    if (await convergedByNewerEvent({ sub, watermark })) {
      // An OLDER event lost to a newer one, or two events shared a second. The
      // state that won is at least as fresh, so this is a no-op rather than a
      // failure Stripe should retry.
      logBillingAnomaly({
        request_id: requestId,
        anomaly: "converged_by_newer_event",
        sub,
        stripe_event_type: event.type,
        stripe_event_id: event.id,
      });
      return ACK;
    }
    throw error;
  }

  return ACK;
}
