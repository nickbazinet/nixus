import type { BillingCapability, BillingErrorCode } from "@nixus/shared";

/*
 * The only logging transport of this service, and AD-14's mechanism rather than
 * a rule anyone has to remember.
 *
 * The allow-list is EXPLICIT and the signature is what enforces it. Loggable, and
 * only loggable: `sub`, `route`, `method`, `status`, `latency_ms`, `error_code`,
 * `stripe_event_type`, `stripe_event_id`, `tier`, `capabilities`, `request_id`.
 *
 * Never logged, under any circumstances: the Stripe secret key, the webhook
 * signing secret, raw webhook bodies, `stripe_customer_id`,
 * `stripe_subscription_id`, promotion codes, statement bytes, tokens, cookies and
 * any card data. Two things make that structural rather than conventional:
 *
 *   1. `NeverLogged` types every forbidden member as `never`, so a caller that
 *      passes one does not compile - not even through a variable, where an excess
 *      property check alone would not fire; and
 *   2. `logRequest` constructs the emitted object member by member from named
 *      fields, and never spreads its argument - so a member that reached it
 *      anyway still cannot reach CloudWatch.
 *
 * src/lib/logging.test.ts hands the serializer a payload carrying every forbidden
 * field and asserts the emitted line contains none of them (AD-16).
 */

export interface LoggableRequestFields {
  readonly request_id: string;
  readonly route: string;
  readonly method: string;
  readonly status: number;
  readonly latency_ms: number;
  /** Absent on an unauthenticated route, and on a rejected identity. */
  readonly sub?: string;
  readonly error_code?: BillingErrorCode;
  readonly stripe_event_type?: string;
  readonly stripe_event_id?: string;
  /** Opaque tier code. Display and operations only; never a gate (AD-1). */
  readonly tier?: string;
  readonly capabilities?: readonly BillingCapability[];
}

/**
 * Every field AD-14 forbids, typed `never`. A caller holding one of these cannot
 * be passed to the serializer at all, which is the difference between a mechanism
 * and a prohibition.
 */
export interface NeverLogged {
  readonly stripe_secret_key?: never;
  readonly stripe_webhook_secret?: never;
  readonly stripe_signature?: never;
  readonly raw_body?: never;
  readonly body?: never;
  readonly stripe_customer_id?: never;
  readonly stripe_subscription_id?: never;
  readonly promotion_code?: never;
  readonly statement?: never;
  readonly token?: never;
  readonly access_token?: never;
  readonly refresh_token?: never;
  readonly id_token?: never;
  readonly authorization?: never;
  readonly cookie?: never;
  readonly card?: never;
  readonly card_number?: never;
  readonly cvv?: never;
  readonly payment_method?: never;
}

export type RequestLogFields = LoggableRequestFields & NeverLogged;

export function logRequest(fields: RequestLogFields): void {
  // Constructed member by member from the allow-list. Never a spread of
  // `fields`: a spread is how an extra member arrives in CloudWatch.
  const line = {
    event: "billing_request",
    request_id: fields.request_id,
    sub: fields.sub ?? null,
    route: fields.route,
    method: fields.method,
    status: fields.status,
    latency_ms: fields.latency_ms,
    error_code: fields.error_code ?? null,
    stripe_event_type: fields.stripe_event_type ?? null,
    stripe_event_id: fields.stripe_event_id ?? null,
    tier: fields.tier ?? null,
    capabilities: fields.capabilities ?? null,
  };

  if (fields.status >= 500) {
    console.error(JSON.stringify(line));
    return;
  }
  console.log(JSON.stringify(line));
}

/**
 * A throw that escaped the router's own classification. Only the error's class
 * name is recorded: an exception message can carry a Stripe key, a raw webhook
 * body, or a customer identifier.
 */
export function logUnhandled(requestId: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event: "billing_unhandled_error",
      request_id: requestId,
      error_name: error instanceof Error ? error.name : "unknown",
    }),
  );
}

/**
 * AD-6's warning path: a capability name arriving from Stripe Product metadata
 * that this build's closed union does not recognise. The NAME is loggable - it is
 * operator-authored configuration, not user data - and nothing else of the
 * Product is.
 */
export function logDroppedCapability(args: {
  readonly request_id: string;
  readonly dropped_capability: string;
}): void {
  console.log(
    JSON.stringify({
      event: "billing_capability_dropped",
      request_id: args.request_id,
      dropped_capability: args.dropped_capability,
    }),
  );
}

/**
 * A named, CLOSED set of conditions an operator has to be able to find in the
 * logs but which are not request outcomes: a Stripe subscription status this
 * build's union does not contain, AD-18's duplicate live subscriptions, AD-2's
 * override out-ranking a converging webhook, and AD-9's free-statement rate
 * limit biting.
 *
 * The union is closed for the same reason the request serializer's field list
 * is: an anomaly name supplied by a caller would be a free-text channel into
 * CloudWatch, and a free-text channel is how a customer identifier gets logged
 * (AD-14). Only the name, the request id and the Stripe event id - all three
 * already on the allow-list - are emitted.
 */
export const BILLING_ANOMALIES = [
  "unknown_subscription_status",
  "duplicate_live_subscription",
  "admin_override_precedence",
  "free_statement_rate_limited",
  "unrecognised_event_type",
  "livemode_mismatch",
  "signature_rejected",
  "converged_by_newer_event",
] as const;
export type BillingAnomaly = (typeof BILLING_ANOMALIES)[number];

export function logBillingAnomaly(
  args: {
    readonly request_id: string;
    readonly anomaly: BillingAnomaly;
    readonly sub?: string;
    readonly stripe_event_type?: string;
    readonly stripe_event_id?: string;
  } & NeverLogged,
): void {
  console.log(
    JSON.stringify({
      event: "billing_anomaly",
      request_id: args.request_id,
      anomaly: args.anomaly,
      sub: args.sub ?? null,
      stripe_event_type: args.stripe_event_type ?? null,
      stripe_event_id: args.stripe_event_id ?? null,
    }),
  );
}

/**
 * AD-2's and AD-14's audit of an administrative grant. The actor, the subject,
 * the reason and the grant are recorded in CloudWatch and in NO `audit_log` row
 * in the SQLite domain sense.
 *
 * The `reason` is the one operator-authored free-text value this service ever
 * logs, and AD-14 names it explicitly as auditable. It is length-bounded by
 * `ADMIN_OVERRIDE_REASON_MAX_LENGTH` before it reaches here, and it is the only
 * record of WHY a capability was granted outside a payment.
 */
export function logAdminOverride(
  args: {
    readonly request_id: string;
    readonly actor_sub: string;
    readonly subject_sub: string;
    readonly reason: string;
    readonly tier: string;
    readonly capabilities: readonly BillingCapability[];
    readonly admin_expires_at: number;
  } & NeverLogged,
): void {
  console.log(
    JSON.stringify({
      event: "billing_admin_override",
      request_id: args.request_id,
      actor_sub: args.actor_sub,
      subject_sub: args.subject_sub,
      reason: args.reason,
      tier: args.tier,
      capabilities: args.capabilities,
      admin_expires_at: args.admin_expires_at,
    }),
  );
}
