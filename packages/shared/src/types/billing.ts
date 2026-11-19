/**
 * Canonical Nixus Cloud billing and entitlement wire contract (billing AD-13), shared by the
 * billing Lambda (`@nixus/api-billing`), the account app (`apps/account`), the marketing site
 * (`apps/web`) and, through a Rust mirror with parity tests, the desktop
 * (`apps/desktop/src-tauri/src/entitlements.rs`).
 *
 * snake_case on every wire; absent is `null`, never `""`. Evolution is additive only: clients
 * ignore unknown response fields, ignore an unknown capability name, and map an unknown error code
 * to `unavailable`. The unions are closed so a new literal fails compilation on every side.
 *
 * Two rules in here are load-bearing and are what the whole tier model rests on:
 *
 * 1. **`capabilities[]` is the only thing a gate may read.** `tier` crosses the wire as an opaque
 *    string a surface may display and operations may act on, and that no code anywhere may compare
 *    (billing AD-1). That is what makes "add a tier" a Stripe Dashboard change with no deploy.
 * 2. **The capability union is closed at compile time.** A capability name may never originate at
 *    runtime: the authority validates every name arriving from Stripe Product metadata against
 *    this union and drops what it does not recognise (billing AD-6).
 */

/**
 * Every capability any tier may grant. Sorted, and closed at compile time on purpose: a gate that
 * tests a member of this union is exhaustive, where a lookup against a runtime list could silently
 * miss. Adding a member is a deliberate release on both the TS and the Rust side (billing AD-1).
 *
 * A capability may be granted before any code consumes it — `household_net_worth` is granted by
 * Classic today and has no consumer yet, which this contract explicitly permits.
 */
export const BILLING_CAPABILITIES = [
  "hosted_ai",
  "household_net_worth",
  "multi_device_sync",
] as const;
export type BillingCapability = (typeof BILLING_CAPABILITIES)[number];

/**
 * The subscription lifecycle state as the authority last converged it from Stripe. Carried for
 * display and operations only — `none` is an ordinary signed-in free account, not an error, and
 * never a gate. A gate reads `capabilities[]` (billing AD-1).
 */
export const ENTITLEMENT_STATUSES = [
  /** Signed in with no subscription record. The free tier. */
  "none",
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

/**
 * Which writer produced the entitlement. `app_store` and `play` are reserved so a store receipt can
 * become a third writer under the AD-2 precedence rules with no model change; neither is written
 * today.
 */
export const ENTITLEMENT_SOURCES = [
  "stripe",
  "app_store",
  "play",
  "admin",
] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export const PLAN_INTERVALS = ["month", "year"] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

/**
 * Shape check only. The authoritative test is membership of the catalog `GET /v1/billing/plans`
 * currently publishes, because a `lookup_key` this matches may still name no Price (billing AD-8).
 * By convention a key is `<tier>_<interval>_<currency>`, e.g. `classic_monthly_cad`.
 */
export const PLAN_LOOKUP_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
export const PLAN_LOOKUP_KEY_MAX_LENGTH = 64;

/**
 * Shape check only, so a code is never forwarded to Stripe unvalidated and never echoed back in an
 * error (billing AD-8, AD-14). Whether the code exists and is redeemable is Stripe's answer.
 */
export const PROMOTION_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
export const PROMOTION_CODE_MAX_LENGTH = 64;

/** Request-body ceiling on every authorized billing route, in bytes. */
export const BILLING_BODY_MAX_BYTES = 4 * 1024;

/**
 * One entry of the public price catalog. Read from Stripe, cached, and carrying no user data and no
 * `price_id` (billing AD-6). Amounts are Stripe's, for display only — Nixus stores no money.
 *
 * The catalog lists **paid** plans only. The pricing page's Local and Free columns are baked copy
 * with no Stripe Price behind them, so they never appear here.
 */
export interface PlanCatalogEntry {
  /** Opaque lowercase tier code from Stripe Product `metadata.nixus_tier`. Display only. */
  readonly tier: string;
  readonly lookup_key: string;
  /** Integer minor units, as Stripe reports them. Display only; never stored by Nixus. */
  readonly unit_amount_cents: number;
  /** Uppercase ISO 4217. The list currency — a visitor may be charged in their own at checkout. */
  readonly currency: string;
  readonly interval: PlanInterval;
  /** Ascending. Stable ordering for the pricing page, operator-controlled from Stripe metadata. */
  readonly display_order: number;
  /** Validated against `BILLING_CAPABILITIES`; an unrecognised name was dropped server-side. */
  readonly capabilities: readonly BillingCapability[];
  readonly monthly_request_limit: number | null;
}

/**
 * `GET /v1/billing/plans`. Public, unauthenticated, cacheable.
 *
 * `cache_ttl_seconds` is the single cache bound in the system (billing AD-6): CloudFront and every
 * client cache derive from it rather than adding their own, so the advertised-versus-charged drift
 * window is exactly this value.
 */
export interface PlanCatalogResponse {
  readonly plans: readonly PlanCatalogEntry[];
  readonly cache_ttl_seconds: number;
}

/**
 * The signed entitlement statement (billing AD-9). A compact three-part token:
 *
 *     NXS1.<base64url(claims JSON)>.<base64url(DER ECDSA signature)>
 *
 * The signing input is the UTF-8 bytes of the first two parts joined by a dot — `NXS1.<payload>` —
 * signed with a KMS asymmetric `ECC_NIST_P256` key using `ECDSA_SHA_256`. base64url is unpadded.
 *
 * It is deliberately not a JWT: there is no negotiable `alg`, so there is no algorithm-confusion
 * surface and the Rust verifier needs no JOSE stack.
 */
export const ENTITLEMENT_STATEMENT_PREFIX = "NXS1";
export const ENTITLEMENT_STATEMENT_SIGNING_ALGORITHM = "ECDSA_SHA_256";
export const ENTITLEMENT_STATEMENT_KEY_SPEC = "ECC_NIST_P256";

/** `exp = iat + this`, further clamped to `current_period_end` only when a period end exists. */
export const ENTITLEMENT_STATEMENT_TTL_SECONDS = 24 * 60 * 60;

/**
 * `GET /entitlement` mints a fresh statement once the stored one's remaining life falls below this
 * fraction of its window (billing AD-9). Half, so a device that revalidates on start and sign-in is
 * never served something close to expiry.
 */
export const ENTITLEMENT_STATEMENT_REFRESH_FRACTION = 0.5;

/**
 * How far ahead of the device clock an `iat` may sit before the statement is refused outright. The
 * device also persists a monotonic high-water mark of the latest verified `iat`, so the clock cannot
 * be rewound below it (billing AD-9).
 */
export const ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * The claim set, verbatim, in the order they are serialised. Key order is fixed because the bytes
 * are what gets signed: a re-serialised payload with a different member order would not verify.
 */
export interface EntitlementStatementClaims {
  /** The Cognito `sub` this statement is bound to. A statement for another `sub` grants nothing. */
  readonly sub: string;
  /** Opaque tier code. Display and operations only; never a gate. */
  readonly tier: string;
  /** The authoritative grant. Sorted, deduplicated, every member of `BILLING_CAPABILITIES`. */
  readonly capabilities: readonly BillingCapability[];
  readonly monthly_request_limit: number | null;
  /** Epoch seconds. */
  readonly iat: number;
  /** Epoch seconds. */
  readonly exp: number;
  /** Identifies the signing key, so rotation and revocation need no format change. */
  readonly key_id: string;
}

/**
 * `GET /v1/billing/entitlement`.
 *
 * A *device* consumer reads `statement` and verifies it offline; a *server-side* consumer reads the
 * `ENTITLEMENT` item directly and never parses a statement. One representation per consumer class,
 * so the two can never disagree about what they may trust (billing AD-4).
 *
 * A signed-in account with no subscription receives a normal, verifiable statement with an empty
 * `capabilities` array — that is what lets a client tell *verified free* apart from *could not reach
 * the server* (billing AD-9).
 */
/**
 * The Stripe-derived state as the authority last converged it (billing AD-2, AD-5).
 *
 * Carries NO `capabilities` and no `monthly_request_limit`, and that absence is the
 * design: `EntitlementResponse.capabilities` stays the only grant in this contract,
 * and this field must be structurally incapable of becoming a second one (AD-1).
 */
export interface EntitlementStripeState {
  /** Opaque tier code of the subscribed Product. Display only, never compared. */
  readonly tier: string;
  readonly status: EntitlementStatus;
  /** Epoch seconds. `null` when Stripe reported no period. */
  readonly current_period_end: number | null;
}

export interface EntitlementResponse {
  readonly tier: string;
  readonly capabilities: readonly BillingCapability[];
  /**
   * The EFFECTIVE grant's status, under AD-2 precedence. NOT evidence that a Stripe
   * relationship exists — a live admin override pins this to `none` while Stripe is
   * still billing the account. Read `stripe_state` for that question.
   */
  readonly status: EntitlementStatus;
  /** Epoch seconds, or `null` on a free entitlement, which has no period. */
  readonly current_period_end: number | null;
  readonly monthly_request_limit: number | null;
  readonly source: EntitlementSource;
  /** The compact signed statement. Never logged (billing AD-14). */
  readonly statement: string;
  /** Epoch seconds. Mirrors the statement's own `exp` so a client need not decode to schedule. */
  readonly statement_exp: number;
  /** Server-owned. `null` on a free entitlement derived with no stored record. */
  readonly version: number | null;
  /**
   * `null` when the authority has never converged a Stripe state for this account,
   * which is distinct from "Stripe says free". Non-null is the only evidence in this
   * contract that a commercial relationship exists.
   */
  readonly stripe_state: EntitlementStripeState | null;
}

export const CHECKOUT_DESTINATIONS = ["checkout", "portal"] as const;
export type CheckoutDestination = (typeof CHECKOUT_DESTINATIONS)[number];

/**
 * `POST /v1/billing/checkout`. `plan_lookup_key` is validated against the live catalog before
 * Stripe is called; `promotion_code` is shape-checked and never echoed back (billing AD-8).
 */
export interface CheckoutRequest {
  readonly plan_lookup_key: string;
  readonly promotion_code: string | null;
}

/**
 * An account that already has a live subscription is routed to the Customer Portal for a plan
 * change rather than to a second Checkout Session (billing AD-18), so the caller opens `url` either
 * way and `destination` only tells it which surface it is about to show.
 */
export interface CheckoutResponse {
  readonly url: string;
  readonly destination: CheckoutDestination;
}

/** `POST /v1/billing/portal`. The customer is resolved from the caller's own record, never from a
 * request parameter (billing AD-3). */
export interface PortalResponse {
  readonly url: string;
}

/**
 * `POST /v1/billing/admin/override` — the authenticated administrative grant that replaces the
 * manual `put-item` runbook (billing AD-2). Always time-boxed, always carrying a reason, and ranked
 * above a converging webhook until it expires.
 */
export interface AdminOverrideRequest {
  /** The subject being granted. The only route on which a `sub` is a request parameter. */
  readonly sub: string;
  readonly tier: string;
  readonly capabilities: readonly BillingCapability[];
  readonly monthly_request_limit: number | null;
  /** Epoch seconds. Mandatory: an override is never open-ended. */
  readonly admin_expires_at: number;
  /** Recorded server-side for audit. Never a personal detail (billing AD-14). */
  readonly reason: string;
  /** `null` creates, a number requires the stored version to match exactly. */
  readonly expected_version: number | null;
}

export type AdminOverrideResponse = EntitlementResponse;

export const ADMIN_OVERRIDE_REASON_MAX_LENGTH = 256;
/** An override may not be granted for longer than this, so one can never become permanent. */
export const ADMIN_OVERRIDE_MAX_DURATION_SECONDS = 90 * 24 * 60 * 60;

/**
 * The header a client states its own version in, so `GET /entitlement` can refuse to serve a
 * build below the server-side minimum. Together with the embedded trusted-key set and its
 * `not_after`, this is the revocation path for a leaked signing key (billing AD-9).
 */
export const BILLING_CLIENT_VERSION_HEADER = "x-nixus-client-version";

export const BILLING_ERROR_CODES = [
  "unauthorized",
  "reauthentication_required",
  "validation",
  /**
   * "Your plan does not include this capability" — narrowed from its original "you are not a
   * premium user" meaning, because under two paid tiers that sentence lies to a paying subscriber
   * (billing AD-12). Pinned to 403 below and never 401.
   */
  "premium_required",
  "version_conflict",
  "rate_limited",
  "unavailable",
  "promotion_invalid",
  "checkout_in_progress",
  /**
   * Additive extension to AD-13's enumerated union, required by AD-9's revocation path: a client
   * below the server-side minimum version is refused a statement. It is its own code rather than
   * `reauthentication_required` because signing the user out would be the wrong remedy and would
   * reintroduce exactly the "a plan or client limitation read as an auth failure" confusion AD-12
   * exists to prevent. Older clients map it to `unavailable`, which is the correct conservative
   * behaviour for a build that cannot be served.
   */
  "client_too_old",
] as const;
export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

/** Fields a `validation` error may blame: a request member, or the request itself. */
export const BILLING_VALIDATION_FIELDS = [
  "plan_lookup_key",
  "promotion_code",
  "sub",
  "tier",
  "capabilities",
  "monthly_request_limit",
  "admin_expires_at",
  "reason",
  "expected_version",
  "body",
] as const;
export type BillingValidationField = (typeof BILLING_VALIDATION_FIELDS)[number];

/**
 * Why a field was refused. Stable, so every surface resolves its own EN/FR text from
 * `code` + `field` + `reason`; the submitted value is never echoed (billing AD-14).
 */
export const BILLING_VALIDATION_REASONS = [
  /** Not a string / number / array / null where one was required. */
  "invalid_type",
  /** Unparseable or malformed: a bad lookup-key shape, invalid JSON, a non-integer timestamp. */
  "invalid_format",
  /** A mandatory member is absent. */
  "required",
  /** Not in the allow-list: an unknown capability name, or a `lookup_key` the catalog does not publish. */
  "not_allowed",
  "too_long",
  /** A number outside its permitted range, including an override duration beyond the maximum. */
  "out_of_range",
  /** A timestamp that has already passed where a future one was required. */
  "in_past",
  /** The body carries a member this contract does not define. */
  "unknown_field",
] as const;
export type BillingValidationReason =
  (typeof BILLING_VALIDATION_REASONS)[number];

export const BILLING_VERSIONED_RESOURCES = ["entitlement"] as const;
export type BillingVersionedResource =
  (typeof BILLING_VERSIONED_RESOURCES)[number];

interface BillingErrorBase<C extends BillingErrorCode> {
  readonly code: C;
  /** Fixed English sentence for logs and support; never rendered raw, never carries a value. */
  readonly message: string;
  readonly request_id: string;
}

export interface BillingValidationError extends BillingErrorBase<"validation"> {
  readonly field: BillingValidationField;
  readonly reason: BillingValidationReason;
}

export interface BillingVersionConflictError
  extends BillingErrorBase<"version_conflict"> {
  readonly resource: BillingVersionedResource;
  /** `null` when no record exists (a numbered write against an absent entitlement). */
  readonly current_version: number | null;
}

/**
 * Names the capability the caller's plan does not include, so a surface can route them to an
 * upgrade instead of reading as an error, and so a Classic subscriber is never told they need
 * premium (billing AD-12).
 */
export interface BillingPremiumRequiredError
  extends BillingErrorBase<"premium_required"> {
  readonly capability: BillingCapability;
}

/** Carries the minimum the server will serve, so a client can tell the user what to install. */
export interface BillingClientTooOldError
  extends BillingErrorBase<"client_too_old"> {
  readonly minimum_client_version: string;
}

export type BillingError =
  | BillingValidationError
  | BillingVersionConflictError
  | BillingPremiumRequiredError
  | BillingClientTooOldError
  | BillingErrorBase<
      Exclude<
        BillingErrorCode,
        "validation" | "version_conflict" | "premium_required" | "client_too_old"
      >
    >;

export interface BillingErrorResponse {
  readonly error: BillingError;
}

/**
 * The HTTP status each code is returned with by the billing Lambda.
 *
 * `premium_required` is pinned to 403 and is never 401, so no client mistakes a plan limitation for
 * an expired session and sends the user to re-authenticate (billing AD-12). `reauthentication_required`
 * keeps the profile API's 403, distinguished by its `code`, not by its status.
 */
export const BILLING_ERROR_HTTP_STATUS = {
  unauthorized: 401,
  reauthentication_required: 403,
  validation: 400,
  premium_required: 403,
  version_conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  promotion_invalid: 400,
  checkout_in_progress: 409,
  client_too_old: 403,
} as const satisfies Record<BillingErrorCode, number>;

/**
 * Every API Gateway–owned rejection on the billing API emits the envelope with this code
 * (billing AD-13). `ACCESS_DENIED` is the insufficient-scope 403, which a client reclassifies as
 * `reauthentication_required` because a refresh cannot add a scope. `status: null` keeps the
 * gateway's own status code.
 *
 * `REQUEST_TOO_LARGE` maps to `validation` rather than its own code: the union is closed, an
 * oversized billing body is a malformed request, and `BILLING_BODY_MAX_BYTES` is the documented
 * bound a caller is expected to respect.
 */
export const BILLING_GATEWAY_RESPONSES = {
  UNAUTHORIZED: { status: 401, code: "unauthorized" },
  ACCESS_DENIED: { status: 403, code: "unauthorized" },
  EXPIRED_TOKEN: { status: 401, code: "unauthorized" },
  MISSING_AUTHENTICATION_TOKEN: { status: 401, code: "unauthorized" },
  THROTTLED: { status: 429, code: "rate_limited" },
  REQUEST_TOO_LARGE: { status: 413, code: "validation" },
  DEFAULT_4XX: { status: null, code: "unavailable" },
  DEFAULT_5XX: { status: 503, code: "unavailable" },
} as const satisfies Record<
  string,
  { readonly status: number | null; readonly code: BillingErrorCode }
>;
export type BillingGatewayResponseType = keyof typeof BILLING_GATEWAY_RESPONSES;

export function isBillingCapability(
  value: unknown,
): value is BillingCapability {
  return (
    typeof value === "string" &&
    (BILLING_CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * Normalises a capability list arriving from anywhere — Stripe Product metadata, a stored record, a
 * statement, a newer server — onto the closed union: unknown names are dropped, duplicates
 * collapsed, and the result sorted so two representations of the same grant are byte-identical
 * (billing AD-1, AD-6).
 */
export function toBillingCapabilities(
  value: unknown,
): readonly BillingCapability[] {
  if (!Array.isArray(value)) return [];
  const kept = new Set<BillingCapability>();
  for (const entry of value) {
    if (isBillingCapability(entry)) kept.add(entry);
  }
  return BILLING_CAPABILITIES.filter((capability) => kept.has(capability));
}

export function isBillingErrorCode(code: unknown): code is BillingErrorCode {
  return (
    typeof code === "string" &&
    (BILLING_ERROR_CODES as readonly string[]).includes(code)
  );
}

/** Maps any wire code — including one a newer server added — onto the closed union. */
export function toBillingErrorCode(code: unknown): BillingErrorCode {
  return isBillingErrorCode(code) ? code : "unavailable";
}

export function isEntitlementStatus(value: unknown): value is EntitlementStatus {
  return (
    typeof value === "string" &&
    (ENTITLEMENT_STATUSES as readonly string[]).includes(value)
  );
}

/** An unrecognised status is reported as `none`: no capability is implied by a status either way. */
export function toEntitlementStatus(value: unknown): EntitlementStatus {
  return isEntitlementStatus(value) ? value : "none";
}

export function isEntitlementSource(value: unknown): value is EntitlementSource {
  return (
    typeof value === "string" &&
    (ENTITLEMENT_SOURCES as readonly string[]).includes(value)
  );
}

export function isPlanLookupKeyShaped(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= PLAN_LOOKUP_KEY_MAX_LENGTH &&
    PLAN_LOOKUP_KEY_PATTERN.test(value)
  );
}

export function isPromotionCodeShaped(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= PROMOTION_CODE_MAX_LENGTH &&
    PROMOTION_CODE_PATTERN.test(value)
  );
}

/** True when the grant includes the capability. The only shape a gate may take (billing AD-1). */
export function grantsCapability(
  capabilities: readonly BillingCapability[],
  capability: BillingCapability,
): boolean {
  return capabilities.includes(capability);
}

/**
 * THE predicate, and deliberately the only one: which statuses grant capabilities is
 * decided here and may not be re-derived anywhere else.
 *
 * `past_due` GRANTS. Dunning grace is Stripe's, configured in the Dashboard (AD-11),
 * so Nixus keeps granting for exactly as long as Stripe reports the subscription live
 * and hard-codes no retry window of its own. The alternative - revoking on the first
 * failed charge - would cut off a customer whose smart retry was going to succeed.
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
