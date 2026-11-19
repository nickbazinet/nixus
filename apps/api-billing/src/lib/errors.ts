import {
  BILLING_ERROR_HTTP_STATUS,
  type BillingCapability,
  type BillingError,
  type BillingErrorCode,
  type BillingErrorResponse,
  type BillingValidationField,
  type BillingValidationReason,
  type BillingVersionedResource,
} from "@nixus/shared";

/*
 * The one error vocabulary of the billing API (AD-13). Every refusal the Lambda
 * itself produces is one of these, the HTTP status always comes from the shared
 * contract's `BILLING_ERROR_HTTP_STATUS`, and the message is a fixed English
 * sentence that never carries a submitted value, a promotion code, a customer
 * identifier or any statement byte (AD-14).
 */

export type SimpleErrorCode = Exclude<
  BillingErrorCode,
  "validation" | "version_conflict" | "premium_required" | "client_too_old"
>;

export interface ValidationFailure {
  readonly code: "validation";
  readonly field: BillingValidationField;
  readonly reason: BillingValidationReason;
}

export interface ConflictFailure {
  readonly code: "version_conflict";
  readonly resource: BillingVersionedResource;
  /** `null` when no record exists, which is itself a conflict (AD-4). */
  readonly current_version: number | null;
}

/** Names the capability the plan does not include, never a tier (AD-12). */
export interface PremiumRequiredFailure {
  readonly code: "premium_required";
  readonly capability: BillingCapability;
}

/** Carries the floor, so a client can tell the user what to install (AD-9). */
export interface ClientTooOldFailure {
  readonly code: "client_too_old";
  readonly minimum_client_version: string;
}

export interface SimpleFailure {
  readonly code: SimpleErrorCode;
}

export type BillingFailure =
  | ValidationFailure
  | ConflictFailure
  | PremiumRequiredFailure
  | ClientTooOldFailure
  | SimpleFailure;

export const SIMPLE_MESSAGES: Readonly<Record<SimpleErrorCode, string>> = {
  unauthorized: "Authentication required.",
  reauthentication_required: "Sign in again to continue.",
  rate_limited: "Too many requests.",
  unavailable: "The billing service is unavailable.",
  // The code itself is never echoed back (AD-8, AD-14).
  promotion_invalid: "That promotion code cannot be applied.",
  checkout_in_progress: "A checkout is already in progress for this account.",
};

const CONFLICT_MESSAGES: Readonly<Record<BillingVersionedResource, string>> = {
  entitlement: "The entitlement changed since it was loaded.",
};

function assertNever(value: never): never {
  throw new Error(`unhandled failure: ${JSON.stringify(value)}`);
}

export function messageFor(failure: BillingFailure): string {
  switch (failure.code) {
    case "validation":
      return "A billing field was refused.";
    case "version_conflict":
      return CONFLICT_MESSAGES[failure.resource];
    case "premium_required":
      return "Your plan does not include this capability.";
    case "client_too_old":
      return "This version of Nixus is no longer supported.";
    case "unauthorized":
    case "reauthentication_required":
    case "rate_limited":
    case "unavailable":
    case "promotion_invalid":
    case "checkout_in_progress":
      return SIMPLE_MESSAGES[failure.code];
    default:
      return assertNever(failure);
  }
}

export function statusFor(failure: BillingFailure): number {
  return BILLING_ERROR_HTTP_STATUS[failure.code];
}

/**
 * The wire envelope. `field`/`reason`, `resource`/`current_version`,
 * `capability` and `minimum_client_version` appear only on their own code.
 */
export function errorBodyFor(
  failure: BillingFailure,
  requestId: string,
): BillingErrorResponse {
  const message = messageFor(failure);

  switch (failure.code) {
    case "validation":
      return {
        error: {
          code: "validation",
          message,
          request_id: requestId,
          field: failure.field,
          reason: failure.reason,
        },
      };
    case "version_conflict":
      return {
        error: {
          code: "version_conflict",
          message,
          request_id: requestId,
          resource: failure.resource,
          current_version: failure.current_version,
        },
      };
    case "premium_required":
      return {
        error: {
          code: "premium_required",
          message,
          request_id: requestId,
          capability: failure.capability,
        },
      };
    case "client_too_old":
      return {
        error: {
          code: "client_too_old",
          message,
          request_id: requestId,
          minimum_client_version: failure.minimum_client_version,
        },
      };
    default: {
      const error: BillingError = {
        code: failure.code,
        message,
        request_id: requestId,
      };
      return { error };
    }
  }
}

/**
 * Carries a failure out of the layer that detected it. The router is the only
 * place that turns one into a response, so no handler spells an HTTP status.
 */
export class BillingFailureError extends Error {
  readonly failure: BillingFailure;

  constructor(failure: BillingFailure) {
    super(failure.code);
    this.name = "BillingFailureError";
    this.failure = failure;
  }
}

export function fail(code: SimpleErrorCode): never {
  throw new BillingFailureError({ code });
}

export function failValidation(
  field: BillingValidationField,
  reason: BillingValidationReason,
): never {
  throw new BillingFailureError({ code: "validation", field, reason });
}

export function failConflict(
  resource: BillingVersionedResource,
  currentVersion: number | null,
): never {
  throw new BillingFailureError({
    code: "version_conflict",
    resource,
    current_version: currentVersion,
  });
}

export function failPremiumRequired(capability: BillingCapability): never {
  throw new BillingFailureError({ code: "premium_required", capability });
}

export function failClientTooOld(minimumClientVersion: string): never {
  throw new BillingFailureError({
    code: "client_too_old",
    minimum_client_version: minimumClientVersion,
  });
}

const THROTTLING_ERROR_NAMES: readonly string[] = [
  "ProvisionedThroughputExceededException",
  "RequestLimitExceeded",
  "ThrottlingException",
  "TooManyRequestsException",
];

/**
 * Anything the service did not classify itself. DynamoDB throttling is the one
 * failure a client should retry, so it keeps its own code; everything else is
 * `unavailable`, with no detail from the underlying error on the wire - an
 * exception message can carry a key, a raw webhook body, or a customer
 * identifier (AD-14).
 */
export function failureFromUnknown(error: unknown): BillingFailure {
  if (error instanceof BillingFailureError) return error.failure;

  const name = error instanceof Error ? error.name : "";
  return THROTTLING_ERROR_NAMES.includes(name)
    ? { code: "rate_limited" }
    : { code: "unavailable" };
}
