import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ADMIN_OVERRIDE_MAX_DURATION_SECONDS,
  ADMIN_OVERRIDE_REASON_MAX_LENGTH,
  BILLING_BODY_MAX_BYTES,
  BILLING_CAPABILITIES,
  BILLING_CLIENT_VERSION_HEADER,
  BILLING_ERROR_CODES,
  BILLING_ERROR_HTTP_STATUS,
  BILLING_GATEWAY_RESPONSES,
  BILLING_VALIDATION_FIELDS,
  BILLING_VALIDATION_REASONS,
  BILLING_VERSIONED_RESOURCES,
  CHECKOUT_DESTINATIONS,
  ENTITLEMENT_SOURCES,
  ENTITLEMENT_STATEMENT_KEY_SPEC,
  ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS,
  ENTITLEMENT_STATEMENT_PREFIX,
  ENTITLEMENT_STATEMENT_REFRESH_FRACTION,
  ENTITLEMENT_STATEMENT_SIGNING_ALGORITHM,
  ENTITLEMENT_STATEMENT_TTL_SECONDS,
  ENTITLEMENT_STATUSES,
  PLAN_INTERVALS,
  PLAN_LOOKUP_KEY_MAX_LENGTH,
  PLAN_TRIAL_MAX_DAYS,
  PROMOTION_CODE_MAX_LENGTH,
  grantsCapability,
  isBillingCapability,
  isBillingErrorCode,
  isEntitlementSource,
  isEntitlementStatus,
  isPlanLookupKeyShaped,
  isPromotionCodeShaped,
  isTrialPlan,
  toBillingCapabilities,
  toBillingErrorCode,
  toEntitlementStatus,
  type AdminOverrideRequest,
  type AdminOverrideResponse,
  type BillingCapability,
  type BillingClientTooOldError,
  type BillingError,
  type BillingErrorCode,
  type BillingErrorResponse,
  type BillingGatewayResponseType,
  type BillingPremiumRequiredError,
  type BillingValidationError,
  type BillingVersionConflictError,
  type CheckoutRequest,
  type CheckoutResponse,
  type EntitlementResponse,
  type EntitlementStatementClaims,
  type EntitlementStripeState,
  type PlanCatalogEntry,
  type PlanCatalogResponse,
  type PortalResponse,
} from "./billing";

const HERE = dirname(fileURLToPath(import.meta.url));

/* The instant every fixture is written from. `statement_claims_*.iat` pins it, so the statement
 * window, the paid period end and the override expiry are all checked against one clock. */
const FIXTURE_NOW = 1_795_003_200;

/* Values a fixture carries that an error message may never echo (billing AD-14). */
const NEVER_ECHOED = [
  "LAUNCH2026",
  "classic_monthly_cad",
  "advance_monthly_cad",
  "advance_trial",
  "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "9b2c4a16-7d58-4f1e-bc33-2a6f0e5d7c91",
  "checkout.stripe.com",
  "billing.stripe.com",
] as const;

/* ------------------------------------------------------------------------------------------------
 * Compile-time key locks.
 *
 * `Record<keyof T, true>` is the lock: adding a member to the interface makes the literal miss a
 * key, removing one makes it excess. `keysOf` then hands the runtime the sorted key list, so a
 * fixture that gains, loses or renames a member fails the suite.
 * ---------------------------------------------------------------------------------------------- */

function keysOf<T>(coverage: Record<keyof T, true>): readonly string[] {
  return Object.keys(coverage).sort();
}

const PLAN_CATALOG_ENTRY_KEYS = keysOf<PlanCatalogEntry>({
  tier: true,
  lookup_key: true,
  unit_amount_cents: true,
  currency: true,
  interval: true,
  display_order: true,
  capabilities: true,
  monthly_request_limit: true,
  trial_period_days: true,
});

const PLAN_CATALOG_RESPONSE_KEYS = keysOf<PlanCatalogResponse>({
  plans: true,
  cache_ttl_seconds: true,
});

const ENTITLEMENT_RESPONSE_KEYS = keysOf<EntitlementResponse>({
  tier: true,
  capabilities: true,
  status: true,
  current_period_end: true,
  monthly_request_limit: true,
  source: true,
  statement: true,
  statement_exp: true,
  version: true,
  stripe_state: true,
});

const ENTITLEMENT_STRIPE_STATE_KEYS = keysOf<EntitlementStripeState>({
  tier: true,
  status: true,
  current_period_end: true,
});

const STATEMENT_CLAIMS_KEYS = keysOf<EntitlementStatementClaims>({
  sub: true,
  tier: true,
  capabilities: true,
  monthly_request_limit: true,
  iat: true,
  exp: true,
  key_id: true,
});

/* The claim set is signed as bytes, so its serialisation order is part of the contract: a
 * re-serialised payload with a different member order would not verify. This mirrors the order the
 * interface declares and is asserted against the fixture's own insertion order below. */
const STATEMENT_CLAIMS_ORDER = [
  "sub",
  "tier",
  "capabilities",
  "monthly_request_limit",
  "iat",
  "exp",
  "key_id",
] as const;

const CHECKOUT_REQUEST_KEYS = keysOf<CheckoutRequest>({
  plan_lookup_key: true,
  promotion_code: true,
});

const CHECKOUT_RESPONSE_KEYS = keysOf<CheckoutResponse>({
  url: true,
  destination: true,
});

const PORTAL_RESPONSE_KEYS = keysOf<PortalResponse>({ url: true });

const ADMIN_OVERRIDE_REQUEST_KEYS = keysOf<AdminOverrideRequest>({
  sub: true,
  tier: true,
  capabilities: true,
  monthly_request_limit: true,
  admin_expires_at: true,
  reason: true,
  expected_version: true,
});

const ERROR_RESPONSE_KEYS = keysOf<BillingErrorResponse>({ error: true });

/* `Omit<…, "field" | "reason">` keeps this literal locked to the members every error variant
 * shares: a new common member makes it miss a key. */
const BASE_ERROR_KEYS = keysOf<Omit<BillingValidationError, "field" | "reason">>(
  { code: true, message: true, request_id: true },
);

const VALIDATION_ERROR_KEYS = keysOf<BillingValidationError>({
  code: true,
  message: true,
  request_id: true,
  field: true,
  reason: true,
});

const VERSION_CONFLICT_ERROR_KEYS = keysOf<BillingVersionConflictError>({
  code: true,
  message: true,
  request_id: true,
  resource: true,
  current_version: true,
});

const PREMIUM_REQUIRED_ERROR_KEYS = keysOf<BillingPremiumRequiredError>({
  code: true,
  message: true,
  request_id: true,
  capability: true,
});

const CLIENT_TOO_OLD_ERROR_KEYS = keysOf<BillingClientTooOldError>({
  code: true,
  message: true,
  request_id: true,
  minimum_client_version: true,
});

const ERROR_CODE_COVERAGE: Record<BillingErrorCode, true> = {
  no_subscription: true,
  unauthorized: true,
  reauthentication_required: true,
  validation: true,
  premium_required: true,
  version_conflict: true,
  rate_limited: true,
  unavailable: true,
  promotion_invalid: true,
  checkout_in_progress: true,
  client_too_old: true,
};

const GATEWAY_RESPONSE_COVERAGE: Record<BillingGatewayResponseType, true> = {
  UNAUTHORIZED: true,
  ACCESS_DENIED: true,
  EXPIRED_TOKEN: true,
  MISSING_AUTHENTICATION_TOKEN: true,
  THROTTLED: true,
  REQUEST_TOO_LARGE: true,
  DEFAULT_4XX: true,
  DEFAULT_5XX: true,
};

/* ------------------------------------------------------------------------------------------------
 * Fixture readers.
 *
 * `resolveJsonModule` is off in this package, so the fixture arrives as `unknown` exactly as it
 * does over the wire. Each reader *constructs* its declared type member by member: the annotated
 * return type is the compile-time proof that the fixture is assignable to the contract, and the
 * runtime checks are the proof that the JSON really carries those shapes.
 * ---------------------------------------------------------------------------------------------- */

type RawRecord = Record<string, unknown>;

function fail(label: string, expected: string, value: unknown): never {
  throw new Error(
    `billing fixture \`${label}\` is not ${expected} (received ${String(value)})`,
  );
}

function asRecord(value: unknown, label: string): RawRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(label, "an object", value);
  }
  return value as RawRecord;
}

function record(parent: RawRecord, key: string): RawRecord {
  return asRecord(parent[key], key);
}

function recordList(parent: RawRecord, key: string): readonly RawRecord[] {
  const value = parent[key];
  if (!Array.isArray(value)) return fail(key, "an array", value);
  const entries = value as readonly unknown[];
  return entries.map((entry, index) => asRecord(entry, `${key}[${index}]`));
}

function requireKeys(
  label: string,
  value: RawRecord,
  keys: readonly string[],
): RawRecord {
  const actual = Object.keys(value).sort();
  const matches =
    actual.length === keys.length &&
    actual.every((key, index) => key === keys[index]);
  if (!matches) {
    throw new Error(
      `billing fixture \`${label}\` carries [${actual.join(", ")}] but the contract declares [${keys.join(", ")}]`,
    );
  }
  return value;
}

function text(parent: RawRecord, key: string): string {
  const value = parent[key];
  return typeof value === "string" ? value : fail(key, "a string", value);
}

function integer(parent: RawRecord, key: string): number {
  const value = parent[key];
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : fail(key, "an integer", value);
}

function nullableInteger(parent: RawRecord, key: string): number | null {
  const value = parent[key];
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : fail(key, "an integer or null", value);
}

function nullableText(parent: RawRecord, key: string): string | null {
  const value = parent[key];
  if (value === null) return null;
  return typeof value === "string" ? value : fail(key, "a string or null", value);
}

/** Resolves a wire value onto a closed union, refusing anything the union does not list. */
function member<T extends string>(
  parent: RawRecord,
  key: string,
  allowed: readonly T[],
  label: string,
): T {
  const value = parent[key];
  const found =
    typeof value === "string"
      ? allowed.find((candidate) => candidate === value)
      : undefined;
  return found ?? fail(key, label, value);
}

function capabilityList(
  parent: RawRecord,
  key: string,
): readonly BillingCapability[] {
  const value = parent[key];
  if (!Array.isArray(value)) return fail(key, "an array", value);
  const entries = value as readonly unknown[];
  const granted: BillingCapability[] = [];
  for (const entry of entries) {
    if (isBillingCapability(entry)) granted.push(entry);
    else fail(key, "a BILLING_CAPABILITIES member", entry);
  }
  return granted;
}

function readPlanCatalogEntry(value: RawRecord): PlanCatalogEntry {
  requireKeys("plan_catalog.plans[]", value, PLAN_CATALOG_ENTRY_KEYS);
  return {
    tier: text(value, "tier"),
    lookup_key: text(value, "lookup_key"),
    unit_amount_cents: integer(value, "unit_amount_cents"),
    currency: text(value, "currency"),
    interval: member(value, "interval", PLAN_INTERVALS, "a PLAN_INTERVALS member"),
    display_order: integer(value, "display_order"),
    capabilities: capabilityList(value, "capabilities"),
    monthly_request_limit: nullableInteger(value, "monthly_request_limit"),
    trial_period_days: nullableInteger(value, "trial_period_days"),
  };
}

function readPlanCatalogResponse(value: RawRecord): PlanCatalogResponse {
  requireKeys("plan_catalog", value, PLAN_CATALOG_RESPONSE_KEYS);
  return {
    plans: recordList(value, "plans").map(readPlanCatalogEntry),
    cache_ttl_seconds: integer(value, "cache_ttl_seconds"),
  };
}

function readStripeState(
  label: string,
  value: RawRecord,
): EntitlementStripeState | null {
  if (value.stripe_state === null) return null;
  const nested = record(value, "stripe_state");
  requireKeys(`${label}.stripe_state`, nested, ENTITLEMENT_STRIPE_STATE_KEYS);
  return {
    tier: text(nested, "tier"),
    status: member(
      nested,
      "status",
      ENTITLEMENT_STATUSES,
      "an ENTITLEMENT_STATUSES member",
    ),
    current_period_end: nullableInteger(nested, "current_period_end"),
  };
}

function readEntitlementResponse(
  label: string,
  value: RawRecord,
): EntitlementResponse {
  requireKeys(label, value, ENTITLEMENT_RESPONSE_KEYS);
  return {
    tier: text(value, "tier"),
    capabilities: capabilityList(value, "capabilities"),
    status: member(
      value,
      "status",
      ENTITLEMENT_STATUSES,
      "an ENTITLEMENT_STATUSES member",
    ),
    current_period_end: nullableInteger(value, "current_period_end"),
    monthly_request_limit: nullableInteger(value, "monthly_request_limit"),
    source: member(
      value,
      "source",
      ENTITLEMENT_SOURCES,
      "an ENTITLEMENT_SOURCES member",
    ),
    statement: text(value, "statement"),
    statement_exp: integer(value, "statement_exp"),
    version: nullableInteger(value, "version"),
    stripe_state: readStripeState(label, value),
  };
}

function readStatementClaims(
  label: string,
  value: RawRecord,
): EntitlementStatementClaims {
  requireKeys(label, value, STATEMENT_CLAIMS_KEYS);
  return {
    sub: text(value, "sub"),
    tier: text(value, "tier"),
    capabilities: capabilityList(value, "capabilities"),
    monthly_request_limit: nullableInteger(value, "monthly_request_limit"),
    iat: integer(value, "iat"),
    exp: integer(value, "exp"),
    key_id: text(value, "key_id"),
  };
}

function readCheckoutRequest(label: string, value: RawRecord): CheckoutRequest {
  requireKeys(label, value, CHECKOUT_REQUEST_KEYS);
  return {
    plan_lookup_key: text(value, "plan_lookup_key"),
    promotion_code: nullableText(value, "promotion_code"),
  };
}

function readCheckoutResponse(label: string, value: RawRecord): CheckoutResponse {
  requireKeys(label, value, CHECKOUT_RESPONSE_KEYS);
  return {
    url: text(value, "url"),
    destination: member(
      value,
      "destination",
      CHECKOUT_DESTINATIONS,
      "a CHECKOUT_DESTINATIONS member",
    ),
  };
}

function readPortalResponse(value: RawRecord): PortalResponse {
  requireKeys("portal_response", value, PORTAL_RESPONSE_KEYS);
  return { url: text(value, "url") };
}

function readAdminOverrideRequest(value: RawRecord): AdminOverrideRequest {
  requireKeys("admin_override_request", value, ADMIN_OVERRIDE_REQUEST_KEYS);
  return {
    sub: text(value, "sub"),
    tier: text(value, "tier"),
    capabilities: capabilityList(value, "capabilities"),
    monthly_request_limit: nullableInteger(value, "monthly_request_limit"),
    admin_expires_at: integer(value, "admin_expires_at"),
    reason: text(value, "reason"),
    expected_version: nullableInteger(value, "expected_version"),
  };
}

function readBillingError(value: RawRecord): BillingError {
  const code = member(
    value,
    "code",
    BILLING_ERROR_CODES,
    "a BILLING_ERROR_CODES member",
  );
  const label = `errors[].error:${code}`;
  const base = {
    message: text(value, "message"),
    request_id: text(value, "request_id"),
  };

  switch (code) {
    case "validation":
      requireKeys(label, value, VALIDATION_ERROR_KEYS);
      return {
        code,
        ...base,
        field: member(
          value,
          "field",
          BILLING_VALIDATION_FIELDS,
          "a BILLING_VALIDATION_FIELDS member",
        ),
        reason: member(
          value,
          "reason",
          BILLING_VALIDATION_REASONS,
          "a BILLING_VALIDATION_REASONS member",
        ),
      };
    case "version_conflict":
      requireKeys(label, value, VERSION_CONFLICT_ERROR_KEYS);
      return {
        code,
        ...base,
        resource: member(
          value,
          "resource",
          BILLING_VERSIONED_RESOURCES,
          "a BILLING_VERSIONED_RESOURCES member",
        ),
        current_version: nullableInteger(value, "current_version"),
      };
    case "premium_required":
      requireKeys(label, value, PREMIUM_REQUIRED_ERROR_KEYS);
      return {
        code,
        ...base,
        capability: member(
          value,
          "capability",
          BILLING_CAPABILITIES,
          "a BILLING_CAPABILITIES member",
        ),
      };
    case "client_too_old":
      requireKeys(label, value, CLIENT_TOO_OLD_ERROR_KEYS);
      return {
        code,
        ...base,
        minimum_client_version: text(value, "minimum_client_version"),
      };
    default:
      requireKeys(label, value, BASE_ERROR_KEYS);
      return { code, ...base };
  }
}

function readErrorResponse(value: RawRecord, index: number): BillingErrorResponse {
  requireKeys(`errors[${index}]`, value, ERROR_RESPONSE_KEYS);
  return { error: readBillingError(record(value, "error")) };
}

type BillingFixtures = {
  readonly plan_catalog: PlanCatalogResponse;
  readonly entitlement_paid: EntitlementResponse;
  readonly entitlement_free: EntitlementResponse;
  readonly entitlement_admin_override_over_paid: EntitlementResponse;
  readonly statement_claims_paid: EntitlementStatementClaims;
  readonly statement_claims_free: EntitlementStatementClaims;
  readonly checkout_request_with_promotion: CheckoutRequest;
  readonly checkout_request_without_promotion: CheckoutRequest;
  readonly checkout_response_checkout: CheckoutResponse;
  readonly checkout_response_portal: CheckoutResponse;
  readonly portal_response: PortalResponse;
  readonly admin_override_request: AdminOverrideRequest;
  readonly admin_override_response: AdminOverrideResponse;
  readonly errors: readonly BillingErrorResponse[];
};

const RAW: RawRecord = asRecord(
  JSON.parse(readFileSync(join(HERE, "billing.fixtures.json"), "utf8")),
  "billing.fixtures.json",
);

/* One typed value per wire shape. `AdminOverrideResponse` is read with the entitlement reader on
 * purpose: the contract aliases the two, and this binding is what would break if that changed. */
const FIXTURES: BillingFixtures = {
  plan_catalog: readPlanCatalogResponse(record(RAW, "plan_catalog")),
  entitlement_paid: readEntitlementResponse(
    "entitlement_paid",
    record(RAW, "entitlement_paid"),
  ),
  entitlement_free: readEntitlementResponse(
    "entitlement_free",
    record(RAW, "entitlement_free"),
  ),
  entitlement_admin_override_over_paid: readEntitlementResponse(
    "entitlement_admin_override_over_paid",
    record(RAW, "entitlement_admin_override_over_paid"),
  ),
  statement_claims_paid: readStatementClaims(
    "statement_claims_paid",
    record(RAW, "statement_claims_paid"),
  ),
  statement_claims_free: readStatementClaims(
    "statement_claims_free",
    record(RAW, "statement_claims_free"),
  ),
  checkout_request_with_promotion: readCheckoutRequest(
    "checkout_request_with_promotion",
    record(RAW, "checkout_request_with_promotion"),
  ),
  checkout_request_without_promotion: readCheckoutRequest(
    "checkout_request_without_promotion",
    record(RAW, "checkout_request_without_promotion"),
  ),
  checkout_response_checkout: readCheckoutResponse(
    "checkout_response_checkout",
    record(RAW, "checkout_response_checkout"),
  ),
  checkout_response_portal: readCheckoutResponse(
    "checkout_response_portal",
    record(RAW, "checkout_response_portal"),
  ),
  portal_response: readPortalResponse(record(RAW, "portal_response")),
  admin_override_request: readAdminOverrideRequest(
    record(RAW, "admin_override_request"),
  ),
  admin_override_response: readEntitlementResponse(
    "admin_override_response",
    record(RAW, "admin_override_response"),
  ),
  errors: recordList(RAW, "errors").map(readErrorResponse),
};

const ERRORS: readonly BillingError[] = FIXTURES.errors.map(
  (envelope) => envelope.error,
);

function assertNever(value: never): never {
  throw new Error(`unhandled error variant: ${JSON.stringify(value)}`);
}

/** Compile-time exhaustiveness over the error union's per-code members. */
function describeError(error: BillingError): string {
  switch (error.code) {
    case "validation":
      return `validation:${error.field}:${error.reason}`;
    case "version_conflict":
      return `version_conflict:${error.resource}:${String(error.current_version)}`;
    case "premium_required":
      return `premium_required:${error.capability}`;
    case "client_too_old":
      return `client_too_old:${error.minimum_client_version}`;
    case "unauthorized":
    case "reauthentication_required":
    case "rate_limited":
    case "unavailable":
    case "promotion_invalid":
    case "checkout_in_progress":
    case "no_subscription":
      return error.code;
    default:
      return assertNever(error);
  }
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/* ------------------------------------------------------------------------------------------------
 * Closed unions (billing AD-13)
 * ---------------------------------------------------------------------------------------------- */

describe("billing contract: closed unions", () => {
  it("keeps the capability union sorted ascending with no duplicates", () => {
    const capabilities = [...BILLING_CAPABILITIES];
    expect(capabilities).toEqual([...capabilities].sort());
    expect(new Set(capabilities).size).toBe(capabilities.length);
    expect(capabilities).toEqual([
      "hosted_ai",
      "household_net_worth",
      "multi_device_sync",
    ]);
  });

  it("keeps every other union unique", () => {
    const unions = [
      BILLING_ERROR_CODES,
      BILLING_VALIDATION_FIELDS,
      BILLING_VALIDATION_REASONS,
      BILLING_VERSIONED_RESOURCES,
      ENTITLEMENT_STATUSES,
      ENTITLEMENT_SOURCES,
      CHECKOUT_DESTINATIONS,
      PLAN_INTERVALS,
    ] as const;
    for (const union of unions) {
      expect(new Set(union).size).toBe(union.length);
    }
  });

  it("lists exactly the error codes the contract enumerates", () => {
    expect([...BILLING_ERROR_CODES].sort()).toEqual(
      Object.keys(ERROR_CODE_COVERAGE).sort(),
    );
  });

  it("gives every error code one HTTP status, with no extras", () => {
    // The `satisfies Record<BillingErrorCode, number>` in the contract already enforces this; the
    // runtime assertion is here so a future edit to either list cannot drift unnoticed.
    expect(Object.keys(BILLING_ERROR_HTTP_STATUS).sort()).toEqual(
      [...BILLING_ERROR_CODES].sort(),
    );
    for (const code of BILLING_ERROR_CODES) {
      const status = BILLING_ERROR_HTTP_STATUS[code];
      expect(Number.isInteger(status)).toBe(true);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it("pins premium_required to 403 and never 401 (AD-12)", () => {
    expect(BILLING_ERROR_HTTP_STATUS.premium_required).toBe(403);
    expect(BILLING_ERROR_HTTP_STATUS.premium_required).not.toBe(401);
    // A plan limitation and an expired session are distinguished by `code`, not by status.
    expect(BILLING_ERROR_HTTP_STATUS.unauthorized).toBe(401);
    expect(BILLING_ERROR_HTTP_STATUS.reauthentication_required).toBe(403);
  });

  it("emits a known error code from every gateway response, and only those types", () => {
    expect(Object.keys(BILLING_GATEWAY_RESPONSES).sort()).toEqual(
      Object.keys(GATEWAY_RESPONSE_COVERAGE).sort(),
    );
    for (const type of Object.keys(
      GATEWAY_RESPONSE_COVERAGE,
    ) as BillingGatewayResponseType[]) {
      const response = BILLING_GATEWAY_RESPONSES[type];
      expect(isBillingErrorCode(response.code)).toBe(true);
      expect(BILLING_ERROR_CODES).toContain(response.code);
      expect(response.status === null || Number.isInteger(response.status)).toBe(
        true,
      );
    }
    expect(BILLING_GATEWAY_RESPONSES.THROTTLED.code).toBe("rate_limited");
    expect(BILLING_GATEWAY_RESPONSES.REQUEST_TOO_LARGE.code).toBe("validation");
    expect(BILLING_GATEWAY_RESPONSES.ACCESS_DENIED.code).toBe("unauthorized");
    expect(BILLING_GATEWAY_RESPONSES.DEFAULT_4XX.status).toBeNull();
  });

  it("states the client version in a lowercase header and refuses an old build with its own code", () => {
    expect(BILLING_CLIENT_VERSION_HEADER).toBe("x-nixus-client-version");
    expect(BILLING_CLIENT_VERSION_HEADER).toBe(
      BILLING_CLIENT_VERSION_HEADER.toLowerCase(),
    );
    expect(BILLING_ERROR_CODES).toContain("client_too_old");
    expect(BILLING_ERROR_HTTP_STATUS.client_too_old).toBe(403);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Normalisers
 * ---------------------------------------------------------------------------------------------- */

const CAPABILITY_CASES: readonly {
  readonly name: string;
  readonly input: unknown;
  readonly expected: readonly BillingCapability[];
}[] = [
  { name: "an unknown name only", input: ["custom_dashboards"], expected: [] },
  {
    name: "a mix of known and unknown names",
    input: ["custom_dashboards", "multi_device_sync", "hosted_ai"],
    expected: ["hosted_ai", "multi_device_sync"],
  },
  {
    name: "duplicates",
    input: ["hosted_ai", "hosted_ai", "hosted_ai"],
    expected: ["hosted_ai"],
  },
  { name: "a non-array string", input: "hosted_ai", expected: [] },
  { name: "a non-array object", input: { hosted_ai: true }, expected: [] },
  { name: "null", input: null, expected: [] },
  { name: "undefined", input: undefined, expected: [] },
  { name: "an empty array", input: [], expected: [] },
  {
    name: "every known name in reverse order",
    input: ["multi_device_sync", "household_net_worth", "hosted_ai"],
    expected: ["hosted_ai", "household_net_worth", "multi_device_sync"],
  },
  {
    name: "non-string entries",
    input: [1, null, undefined, {}, ["hosted_ai"], "hosted_ai"],
    expected: ["hosted_ai"],
  },
];

describe("billing contract: normalisers", () => {
  it.each(CAPABILITY_CASES)(
    "toBillingCapabilities normalises $name",
    ({ input, expected }) => {
      const normalised = toBillingCapabilities(input);
      expect(normalised).toEqual(expected);
      expect([...normalised]).toEqual([...normalised].sort());
      expect(new Set(normalised).size).toBe(normalised.length);
    },
  );

  it("maps an unknown, numeric, null or absent error code to unavailable", () => {
    expect(toBillingErrorCode("quota_exhausted")).toBe("unavailable");
    expect(toBillingErrorCode(42)).toBe("unavailable");
    expect(toBillingErrorCode(null)).toBe("unavailable");
    expect(toBillingErrorCode(undefined)).toBe("unavailable");
    for (const code of BILLING_ERROR_CODES) {
      expect(toBillingErrorCode(code)).toBe(code);
      expect(isBillingErrorCode(code)).toBe(true);
    }
    expect(isBillingErrorCode("quota_exhausted")).toBe(false);
  });

  it("maps an unrecognised status to none", () => {
    expect(toEntitlementStatus("expired")).toBe("none");
    expect(toEntitlementStatus(7)).toBe("none");
    expect(toEntitlementStatus(null)).toBe("none");
    expect(toEntitlementStatus(undefined)).toBe("none");
    for (const status of ENTITLEMENT_STATUSES) {
      expect(toEntitlementStatus(status)).toBe(status);
      expect(isEntitlementStatus(status)).toBe(true);
    }
    expect(isEntitlementStatus("expired")).toBe(false);
  });

  it("recognises exactly the sources and capabilities the unions list", () => {
    for (const source of ENTITLEMENT_SOURCES) {
      expect(isEntitlementSource(source)).toBe(true);
    }
    expect(isEntitlementSource("paypal")).toBe(false);
    expect(isEntitlementSource(null)).toBe(false);
    for (const capability of BILLING_CAPABILITIES) {
      expect(isBillingCapability(capability)).toBe(true);
    }
    expect(isBillingCapability("custom_dashboards")).toBe(false);
    expect(isBillingCapability(1)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Shape checks (billing AD-8)
 * ---------------------------------------------------------------------------------------------- */

const LOOKUP_KEY_CASES: readonly {
  readonly name: string;
  readonly input: unknown;
  readonly shaped: boolean;
}[] = [
  { name: "classic_monthly_cad", input: "classic_monthly_cad", shaped: true },
  { name: "advance_monthly_cad", input: "advance_monthly_cad", shaped: true },
  { name: "a key with digits in a segment", input: "classic_v2_cad", shaped: true },
  {
    name: "a key of exactly the maximum length",
    input: `a_${"b".repeat(PLAN_LOOKUP_KEY_MAX_LENGTH - 2)}`,
    shaped: true,
  },
  { name: "an uppercase key", input: "Classic_monthly_cad", shaped: false },
  { name: "a leading digit", input: "1classic_monthly_cad", shaped: false },
  { name: "a leading underscore", input: "_classic_monthly_cad", shaped: false },
  { name: "a trailing underscore", input: "classic_monthly_cad_", shaped: false },
  { name: "a single segment with no underscore", input: "classic", shaped: false },
  { name: "an empty string", input: "", shaped: false },
  {
    name: "a key over the maximum length",
    input: `a_${"b".repeat(PLAN_LOOKUP_KEY_MAX_LENGTH)}`,
    shaped: false,
  },
  { name: "a number", input: 1, shaped: false },
  { name: "null", input: null, shaped: false },
  { name: "undefined", input: undefined, shaped: false },
  { name: "an array", input: ["classic_monthly_cad"], shaped: false },
];

const PROMOTION_CODE_CASES: readonly {
  readonly name: string;
  readonly input: unknown;
  readonly shaped: boolean;
}[] = [
  { name: "a typical code", input: "LAUNCH2026", shaped: true },
  { name: "a code with - and _", input: "early-bird_2026", shaped: true },
  {
    name: "a code of exactly the maximum length",
    input: "A".repeat(PROMOTION_CODE_MAX_LENGTH),
    shaped: true,
  },
  { name: "an empty string", input: "", shaped: false },
  {
    name: "a code over the maximum length",
    input: "A".repeat(PROMOTION_CODE_MAX_LENGTH + 1),
    shaped: false,
  },
  { name: "a code with a space", input: "LAUNCH 2026", shaped: false },
  { name: "a code with a percent sign", input: "LAUNCH%2026", shaped: false },
  { name: "a code with a slash", input: "LAUNCH/2026", shaped: false },
  { name: "a number", input: 2026, shaped: false },
  { name: "null", input: null, shaped: false },
  { name: "undefined", input: undefined, shaped: false },
];

describe("billing contract: shape checks", () => {
  it.each(LOOKUP_KEY_CASES)(
    "isPlanLookupKeyShaped on $name",
    ({ input, shaped }) => {
      expect(isPlanLookupKeyShaped(input)).toBe(shaped);
    },
  );

  it.each(PROMOTION_CODE_CASES)(
    "isPromotionCodeShaped on $name",
    ({ input, shaped }) => {
      expect(isPromotionCodeShaped(input)).toBe(shaped);
    },
  );
});

/* ------------------------------------------------------------------------------------------------
 * Capability gating (billing AD-1)
 * ---------------------------------------------------------------------------------------------- */

describe("billing contract: capability gating", () => {
  const classic: readonly BillingCapability[] = [
    "household_net_worth",
    "multi_device_sync",
  ];

  it("is true only for a present member", () => {
    for (const capability of BILLING_CAPABILITIES) {
      expect(grantsCapability(BILLING_CAPABILITIES, capability)).toBe(true);
      expect(grantsCapability([], capability)).toBe(false);
      expect(grantsCapability(classic, capability)).toBe(
        classic.includes(capability),
      );
    }
    expect(grantsCapability(classic, "hosted_ai")).toBe(false);
    expect(grantsCapability(classic, "household_net_worth")).toBe(true);
  });

  it("gates on capabilities alone, never on tier or status", () => {
    // The admin override fixture grants three capabilities while `status` is `none`, and the free
    // fixture grants none while being a perfectly ordinary signed-in account: a gate that read
    // either `status` or the opaque `tier` would answer wrongly on both.
    const override = FIXTURES.admin_override_response;
    expect(override.status).toBe("none");
    expect(grantsCapability(override.capabilities, "hosted_ai")).toBe(true);

    const free = FIXTURES.entitlement_free;
    expect(free.status).toBe("none");
    expect(grantsCapability(free.capabilities, "hosted_ai")).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Signed statement constants (billing AD-9)
 * ---------------------------------------------------------------------------------------------- */

describe("billing contract: signed statement constants", () => {
  it("keeps the statement window and its refresh point coherent", () => {
    expect(ENTITLEMENT_STATEMENT_PREFIX).toBe("NXS1");
    expect(ENTITLEMENT_STATEMENT_TTL_SECONDS).toBe(86_400);
    expect(ENTITLEMENT_STATEMENT_REFRESH_FRACTION).toBeGreaterThan(0);
    expect(ENTITLEMENT_STATEMENT_REFRESH_FRACTION).toBeLessThan(1);
  });

  it("pins the non-negotiable signing algorithm and key spec", () => {
    expect(ENTITLEMENT_STATEMENT_SIGNING_ALGORITHM).toBe("ECDSA_SHA_256");
    expect(ENTITLEMENT_STATEMENT_KEY_SPEC).toBe("ECC_NIST_P256");
  });

  it("keeps the tolerated clock skew far inside the refresh window", () => {
    expect(ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS).toBeGreaterThan(0);
    expect(ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS).toBeLessThan(
      ENTITLEMENT_STATEMENT_TTL_SECONDS * ENTITLEMENT_STATEMENT_REFRESH_FRACTION,
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * Shared fixtures (also deserialized by the Rust mirror)
 * ---------------------------------------------------------------------------------------------- */

/** `NXS1.<base64url(claims)>.<base64url(signature)>`, unpadded, with no negotiable `alg`. */
function expectStatementShape(statement: string): void {
  const parts = statement.split(".");
  expect(parts).toHaveLength(3);
  expect(parts[0]).toBe(ENTITLEMENT_STATEMENT_PREFIX);
  expect(statement).not.toContain("=");
  for (const part of parts.slice(1)) {
    expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    // Unpadded base64 never leaves a single trailing character.
    expect(part.length % 4).not.toBe(1);
  }
}

describe("billing contract: plan catalog fixture", () => {
  const catalog = FIXTURES.plan_catalog;

  it("publishes the launch plans in display order", () => {
    expect(catalog.plans.map((plan) => plan.lookup_key)).toEqual([
      "classic_monthly_cad",
      "advance_monthly_cad",
      "advance_trial",
    ]);
    expect(catalog.plans.map((plan) => plan.display_order)).toEqual([1, 2, 2]);
    for (const plan of catalog.plans) {
      expect(plan.currency).toBe("CAD");
      expect(plan.currency).toMatch(/^[A-Z]{3}$/);
      expect(plan.interval).toBe("month");
      expect(isPlanLookupKeyShaped(plan.lookup_key)).toBe(true);
      expect(plan.unit_amount_cents).toBeGreaterThan(0);
      // `tier` crosses the wire as an opaque display string: a non-empty string is the only thing
      // this contract permits a reader to assume about it (AD-1).
      expect(typeof plan.tier).toBe("string");
      expect(plan.tier.length).toBeGreaterThan(0);
    }
    expect(catalog.cache_ttl_seconds).toBeGreaterThan(0);
  });

  /* A trial Price is an ORDINARY catalog entry carrying a trial length. It names the same
   * tier and the same post-trial amount as the plan it leads into, which is exactly why a
   * surface needs `trial_period_days` to tell the two apart instead of listing one plan
   * twice. */
  it("marks the trial Price, and only it, as a trial", () => {
    const trials = catalog.plans.filter(isTrialPlan);
    expect(trials.map((plan) => plan.lookup_key)).toEqual(["advance_trial"]);

    const [trial] = trials;
    expect(trial!.trial_period_days).toBe(7);
    expect(trial!.trial_period_days!).toBeLessThanOrEqual(PLAN_TRIAL_MAX_DAYS);

    const advance = catalog.plans.find(
      (plan) => plan.lookup_key === "advance_monthly_cad",
    )!;
    // The amount after the trial, the tier and the grant are the ordinary plan's.
    expect(trial!.tier).toBe(advance.tier);
    expect(trial!.unit_amount_cents).toBe(advance.unit_amount_cents);
    expect(trial!.capabilities).toEqual(advance.capabilities);
    // A plan sold with no trial carries `null`, never `0` (absent is null, AD-13).
    expect(advance.trial_period_days).toBeNull();
  });

  it("grants Classic its two capabilities and Advance all three", () => {
    const [classic, advance] = catalog.plans;
    expect(classic.capabilities).toEqual([
      "household_net_worth",
      "multi_device_sync",
    ]);
    expect(advance.capabilities).toEqual([
      "hosted_ai",
      "household_net_worth",
      "multi_device_sync",
    ]);
    // Only the hosted-AI plan carries a request quota.
    expect(classic.monthly_request_limit).toBeNull();
    expect(advance.monthly_request_limit).toBeGreaterThan(0);
    expect(grantsCapability(classic.capabilities, "hosted_ai")).toBe(false);
  });

  it("keeps every published grant normalised the way the authority writes it", () => {
    for (const plan of catalog.plans) {
      expect(toBillingCapabilities(plan.capabilities)).toEqual(plan.capabilities);
    }
  });
});

describe("billing contract: entitlement fixtures", () => {
  const paid = FIXTURES.entitlement_paid;
  const free = FIXTURES.entitlement_free;

  it("carries a paid entitlement with a period, a quota and a stored version", () => {
    expect(paid.status).toBe("active");
    expect(paid.capabilities).toEqual([
      "hosted_ai",
      "household_net_worth",
      "multi_device_sync",
    ]);
    expect(paid.monthly_request_limit).toBe(1000);
    expect(paid.source).toBe("stripe");
    expect(paid.version).toBe(7);
    expect(paid.current_period_end).not.toBeNull();
    expectStatementShape(paid.statement);
  });

  it("carries a verifiable free entitlement with no capabilities", () => {
    // `source` is not nullable and the union lists only `stripe`, `app_store`, `play` and `admin`;
    // `app_store`/`play` are reserved and unwritten and `admin` would misreport an override, so
    // `stripe` is the only value this contract permits for an entitlement the Stripe-backed
    // authority derived. A free account is an ordinary account, not an error state.
    expect(free.source).toBe("stripe");
    expect(ENTITLEMENT_SOURCES).toContain(free.source);
    expect(free.tier).toBe("free");
    expect(free.capabilities).toEqual([]);
    expect(free.status).toBe("none");
    expect(free.current_period_end).toBeNull();
    expect(free.monthly_request_limit).toBeNull();
    // `null` version: derived with no stored record. A statement is still minted and verifiable,
    // which is what lets a device tell verified-free from could-not-reach-the-server (AD-9).
    expect(free.version).toBeNull();
    expectStatementShape(free.statement);
  });

  it("mints both statements for a full window, clamped by a period end when one exists", () => {
    for (const entitlement of [paid, free, FIXTURES.admin_override_response]) {
      expect(entitlement.statement_exp).toBe(
        FIXTURE_NOW + ENTITLEMENT_STATEMENT_TTL_SECONDS,
      );
      if (entitlement.current_period_end !== null) {
        expect(entitlement.statement_exp).toBeLessThanOrEqual(
          entitlement.current_period_end,
        );
      }
    }
  });
});

describe("billing contract: statement claim fixtures", () => {
  const paidClaims = FIXTURES.statement_claims_paid;
  const freeClaims = FIXTURES.statement_claims_free;

  it("serialises the claims in the one order the signature is taken over", () => {
    for (const name of ["statement_claims_paid", "statement_claims_free"]) {
      expect(Object.keys(record(RAW, name))).toEqual([
        ...STATEMENT_CLAIMS_ORDER,
      ]);
    }
  });

  it("agrees with the entitlement response it accompanies", () => {
    const pairs = [
      { claims: paidClaims, response: FIXTURES.entitlement_paid },
      { claims: freeClaims, response: FIXTURES.entitlement_free },
    ];
    for (const { claims, response } of pairs) {
      expect(claims.tier).toBe(response.tier);
      expect(claims.capabilities).toEqual(response.capabilities);
      expect(claims.monthly_request_limit).toBe(response.monthly_request_limit);
      expect(claims.exp).toBe(response.statement_exp);
      expect(claims.iat).toBe(FIXTURE_NOW);
      expect(claims.exp - claims.iat).toBe(ENTITLEMENT_STATEMENT_TTL_SECONDS);
      expect(claims.key_id.length).toBeGreaterThan(0);
      expect(claims.sub.length).toBeGreaterThan(0);
    }
  });

  it("binds each statement to its own subject", () => {
    expect(paidClaims.sub).not.toBe(freeClaims.sub);
  });
});

describe("billing contract: checkout, portal and override fixtures", () => {
  it("covers both checkout destinations with an https url", () => {
    const responses = [
      FIXTURES.checkout_response_checkout,
      FIXTURES.checkout_response_portal,
    ];
    expect(responses.map((response) => response.destination)).toEqual([
      ...CHECKOUT_DESTINATIONS,
    ]);
    for (const response of [...responses, FIXTURES.portal_response]) {
      expect(response.url.startsWith("https://")).toBe(true);
    }
  });

  it("covers a checkout request with and without a promotion code", () => {
    const withCode = FIXTURES.checkout_request_with_promotion;
    const withoutCode = FIXTURES.checkout_request_without_promotion;
    expect(withoutCode.promotion_code).toBeNull();
    expect(withCode.promotion_code).not.toBeNull();
    expect(isPromotionCodeShaped(withCode.promotion_code)).toBe(true);
    for (const request of [withCode, withoutCode]) {
      expect(isPlanLookupKeyShaped(request.plan_lookup_key)).toBe(true);
      // Shape only: membership of the published catalog is the authoritative check (AD-8).
      expect(
        FIXTURES.plan_catalog.plans.map((plan) => plan.lookup_key),
      ).toContain(request.plan_lookup_key);
    }
  });

  it("keeps the Stripe state to three members so it can never become a second grant", () => {
    // AD-1: `capabilities[]` is the ONLY grant on this contract. Adding either
    // `capabilities` or `monthly_request_limit` here would create a parallel one
    // that a consumer could gate on, which is why the key set is pinned.
    expect([...ENTITLEMENT_STRIPE_STATE_KEYS].sort()).toEqual([
      "current_period_end",
      "status",
      "tier",
    ]);
  });

  it("distinguishes never-converged from converged-and-dead", () => {
    // The three states that must stay apart: no Stripe relationship at all,
    // a relationship Stripe reports as finished, and a live one.
    expect(FIXTURES.entitlement_free.stripe_state).toBeNull();
    expect(FIXTURES.admin_override_response.stripe_state).toBeNull();
    expect(
      FIXTURES.entitlement_admin_override_over_paid.stripe_state,
    ).not.toBeNull();
  });

  it("pins an override out-ranking a live paid subscription", () => {
    const overridden = FIXTURES.entitlement_admin_override_over_paid;

    expect(overridden.source).toBe("admin");
    // The effective grant says no paid plan while Stripe is actively billing:
    // the shape that let a paying account be charged twice and shown nothing.
    expect(overridden.status).toBe("none");
    expect(overridden.current_period_end).toBeNull();
    expect(overridden.stripe_state?.status).toBe("active");
    expect(overridden.stripe_state?.current_period_end).not.toBeNull();
    // The grant is the override's, NOT the cheaper thing Stripe is billing.
    expect(overridden.tier).not.toBe(overridden.stripe_state?.tier);
    expect(grantsCapability(overridden.capabilities, "hosted_ai")).toBe(true);
  });

  it("time-boxes the admin override and keeps its reason within the audit ceiling", () => {
    const override = FIXTURES.admin_override_request;
    expect(override.admin_expires_at).toBeGreaterThan(FIXTURE_NOW);
    expect(override.admin_expires_at - FIXTURE_NOW).toBeLessThanOrEqual(
      ADMIN_OVERRIDE_MAX_DURATION_SECONDS,
    );
    expect(override.reason.length).toBeGreaterThan(0);
    expect(override.reason.length).toBeLessThanOrEqual(
      ADMIN_OVERRIDE_REASON_MAX_LENGTH,
    );
    // `null` creates; a number would require the stored version to match exactly.
    expect(override.expected_version).toBeNull();
    expect(FIXTURES.admin_override_response.source).toBe("admin");
    expect(FIXTURES.admin_override_response.capabilities).toEqual(
      override.capabilities,
    );
  });

  it("keeps every request body inside the authorized-route ceiling", () => {
    const bodies = [
      FIXTURES.checkout_request_with_promotion,
      FIXTURES.checkout_request_without_promotion,
      FIXTURES.admin_override_request,
    ];
    for (const body of bodies) {
      expect(byteLength(body)).toBeLessThanOrEqual(BILLING_BODY_MAX_BYTES);
    }
  });
});

describe("billing contract: error envelope fixtures", () => {
  it("carries at least one envelope per error code", () => {
    expect(new Set(ERRORS.map((error) => error.code))).toEqual(
      new Set(BILLING_ERROR_CODES),
    );
    for (const error of ERRORS) {
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.request_id.length).toBeGreaterThan(0);
    }
  });

  it("narrows every variant exhaustively", () => {
    const described = ERRORS.map(describeError);
    expect(described).toHaveLength(ERRORS.length);
    expect(described).toContain("premium_required:hosted_ai");
    expect(described).toContain("version_conflict:entitlement:null");
    expect(described).toContain("version_conflict:entitlement:7");
    expect(described).toContain("client_too_old:1.4.0");
    expect(described).toContain("validation:body:unknown_field");
    expect(described).toContain("checkout_in_progress");
  });

  it("reaches every validation field and every validation reason in the contract", () => {
    const validations = ERRORS.filter(
      (error): error is BillingValidationError => error.code === "validation",
    );
    expect([...new Set(validations.map((error) => error.field))].sort()).toEqual(
      [...BILLING_VALIDATION_FIELDS].sort(),
    );
    expect([...new Set(validations.map((error) => error.reason))].sort()).toEqual(
      [...BILLING_VALIDATION_REASONS].sort(),
    );
  });

  it("names the capability a refusal is about, never a tier (AD-12)", () => {
    const refusals = ERRORS.filter(
      (error): error is BillingPremiumRequiredError =>
        error.code === "premium_required",
    );
    expect(refusals.length).toBeGreaterThan(0);
    for (const refusal of refusals) {
      expect(BILLING_CAPABILITIES).toContain(refusal.capability);
      expect(refusal.message.toLowerCase()).not.toContain("premium user");
      expect(refusal.message.toLowerCase()).not.toContain("classic");
      expect(refusal.message.toLowerCase()).not.toContain("advance");
    }
  });

  it("reports a numbered conflict against a versioned resource", () => {
    const conflicts = ERRORS.filter(
      (error): error is BillingVersionConflictError =>
        error.code === "version_conflict",
    );
    expect(conflicts.map((error) => error.current_version)).toEqual([7, null]);
    for (const conflict of conflicts) {
      expect(BILLING_VERSIONED_RESOURCES).toContain(conflict.resource);
    }
  });

  it("tells an outdated client what to install", () => {
    const outdated = ERRORS.filter(
      (error): error is BillingClientTooOldError =>
        error.code === "client_too_old",
    );
    expect(outdated.length).toBeGreaterThan(0);
    for (const error of outdated) {
      expect(error.minimum_client_version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("never echoes a submitted value in a message (AD-14)", () => {
    for (const error of ERRORS) {
      const message = error.message.toLowerCase();
      for (const value of NEVER_ECHOED) {
        expect(message).not.toContain(value.toLowerCase());
      }
      expect(error.message).not.toContain("@");
    }
  });
});
