import {
  ACCOUNT_ERROR_HTTP_STATUS,
  type AccountError,
  type AccountErrorCode,
  type AccountErrorResponse,
  type ValidationField,
  type ValidationReason,
  type VersionedResource,
} from "@nixus/shared";

/*
 * The one error vocabulary of the profile API (AD-13). Every refusal the Lambda
 * itself produces is one of these, the HTTP status always comes from the shared
 * contract's `ACCOUNT_ERROR_HTTP_STATUS`, and the message is a fixed English
 * sentence that never carries a submitted value (AD-12).
 */

export type SimpleErrorCode = Exclude<
  AccountErrorCode,
  "validation" | "version_conflict"
>;

export interface ValidationFailure {
  readonly code: "validation";
  readonly field: ValidationField;
  readonly reason: ValidationReason;
}

export interface ConflictFailure {
  readonly code: "version_conflict";
  readonly resource: VersionedResource;
  /** `null` when the resource does not exist, which is itself a conflict (AD-4). */
  readonly current_version: number | null;
}

export interface SimpleFailure {
  readonly code: SimpleErrorCode;
}

export type AccountFailure = ValidationFailure | ConflictFailure | SimpleFailure;

const SIMPLE_MESSAGES: Readonly<Record<SimpleErrorCode, string>> = {
  unauthorized: "Authentication required.",
  reauthentication_required: "Sign in again to continue.",
  payload_too_large: "The request is too large.",
  unsupported_media: "Only PNG and JPEG images are accepted.",
  rate_limited: "Too many requests.",
  unavailable: "The profile service is unavailable.",
};

const CONFLICT_MESSAGES: Readonly<Record<VersionedResource, string>> = {
  profile: "The profile changed since it was loaded.",
  avatar: "The profile picture changed since it was loaded.",
};

function assertNever(value: never): never {
  throw new Error(`unhandled failure: ${JSON.stringify(value)}`);
}

export function messageFor(failure: AccountFailure): string {
  switch (failure.code) {
    case "validation":
      return "A profile field was refused.";
    case "version_conflict":
      return CONFLICT_MESSAGES[failure.resource];
    case "unauthorized":
    case "reauthentication_required":
    case "payload_too_large":
    case "unsupported_media":
    case "rate_limited":
    case "unavailable":
      return SIMPLE_MESSAGES[failure.code];
    default:
      return assertNever(failure);
  }
}

export function statusFor(failure: AccountFailure): number {
  return ACCOUNT_ERROR_HTTP_STATUS[failure.code];
}

/** The wire envelope. `field`/`reason`/`resource`/`current_version` appear only on their own code. */
export function errorBodyFor(
  failure: AccountFailure,
  requestId: string
): AccountErrorResponse {
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
    default: {
      const error: AccountError = {
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
export class AccountFailureError extends Error {
  readonly failure: AccountFailure;

  constructor(failure: AccountFailure) {
    super(failure.code);
    this.name = "AccountFailureError";
    this.failure = failure;
  }
}

export function fail(code: SimpleErrorCode): never {
  throw new AccountFailureError({ code });
}

export function failValidation(
  field: ValidationField,
  reason: ValidationReason
): never {
  throw new AccountFailureError({ code: "validation", field, reason });
}

export function failConflict(
  resource: VersionedResource,
  currentVersion: number | null
): never {
  throw new AccountFailureError({
    code: "version_conflict",
    resource,
    current_version: currentVersion,
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
 * `unavailable`, with no detail from the underlying error on the wire (AD-12).
 */
export function failureFromUnknown(error: unknown): AccountFailure {
  if (error instanceof AccountFailureError) return error.failure;

  const name = error instanceof Error ? error.name : "";
  return THROTTLING_ERROR_NAMES.includes(name)
    ? { code: "rate_limited" }
    : { code: "unavailable" };
}
