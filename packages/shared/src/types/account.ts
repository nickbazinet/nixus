/**
 * Canonical Nixus Cloud profile wire contract (AD-13), shared by the profile Lambda
 * (`@nixus/api-account`), the account app (`apps/account`) and, through a Rust mirror with
 * parity tests, the desktop. snake_case on every wire; absent is `null`, never `""`.
 *
 * Evolution is additive only: clients ignore unknown response fields and map an unknown error
 * code to `unavailable`. The unions are closed so a new literal fails compilation on every side.
 */

/** A range label, not an amount: stored verbatim as the categorical code. */
export const INCOME_BRACKETS = [
  "under_50k",
  "50k_99k",
  "100k_149k",
  "150k_249k",
  "250k_plus",
] as const;
export type IncomeBracket = (typeof INCOME_BRACKETS)[number];

/**
 * The curated ISO 4217 subset an income bracket may be expressed in. Unrelated to the desktop's
 * account-currency allow-list (`db/account::VALID_CURRENCIES`), which this must never be compared to.
 */
export const INCOME_BRACKET_CURRENCIES = [
  "CAD",
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CHF",
  "JPY",
  "CNY",
  "INR",
  "MXN",
  "BRL",
  "SEK",
  "NOK",
  "DKK",
  "NZD",
  "SGD",
  "HKD",
  "ZAR",
  "KRW",
  "PLN",
] as const;
export type IncomeBracketCurrency = (typeof INCOME_BRACKET_CURRENCIES)[number];

export const PROFILE_MIN_AGE_YEARS = 18;
export const PROFILE_MAX_AGE_YEARS = 120;

/** `PUT /v1/profile` request-body ceiling, in bytes. */
export const PROFILE_BODY_MAX_BYTES = 16 * 1024;

export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg"] as const;
export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

/** Longest edge of the stored derivative, read from the image header. */
export const AVATAR_MAX_EDGE_PX = 256;
/** Measured on the DECODED bytes, never on the base64 text. */
export const AVATAR_MAX_DECODED_BYTES = 64 * 1024;
/** `PUT /v1/profile/avatar` request-body ceiling, covering the base64 encoding and JSON framing. */
export const AVATAR_BODY_MAX_BYTES = 96 * 1024;

/** The editable demographic field set, identical in the cloud and in a local document (AD-6). */
export interface ProfileFields {
  readonly first_name: string | null;
  readonly last_name: string | null;
  /** `YYYY-MM-DD`. */
  readonly birth_date: string | null;
  readonly income_bracket: IncomeBracket | null;
  /** Uppercase ISO 4217. A bracket requires it; it may be set without a bracket. */
  readonly income_bracket_currency: IncomeBracketCurrency | null;
  /** ISO 3166-1 alpha-2. */
  readonly country_code: string | null;
  /** ISO 3166-2, cross-checked against `country_code`. */
  readonly subdivision_code: string | null;
}

export const PROFILE_FIELD_NAMES = [
  "first_name",
  "last_name",
  "birth_date",
  "income_bracket",
  "income_bracket_currency",
  "country_code",
  "subdivision_code",
] as const satisfies readonly (keyof ProfileFields)[];
export type ProfileFieldName = (typeof PROFILE_FIELD_NAMES)[number];

/** `GET /v1/profile` and `PUT /v1/profile` success body. No `pk`, `sk` or `sub` ever appears. */
export interface CloudProfile extends ProfileFields {
  /** Server-owned, integer >= 1, bumped on every accepted write. */
  readonly version: number;
  /** Set once at creation, never overwritten. ISO 8601. */
  readonly created_at: string;
  readonly updated_at: string;
  /** The AVATAR item's version, so a client fetches the bytes only when this changes. */
  readonly avatar_version: number | null;
}

export type GetProfileResponse = CloudProfile | null;

/**
 * `PUT /v1/profile` — a whole-document replace. `expected_version` is mandatory: `null` means
 * create-only, a number means "only if the stored version is exactly this".
 */
export interface PutProfileRequest extends ProfileFields {
  readonly expected_version: number | null;
}

export type PutProfileResponse = CloudProfile;

/** The one avatar wire shape on every surface. No filename, on any route. */
export interface AvatarPayload {
  readonly mime_type: AvatarMimeType;
  /** Standard base64 of the derivative's bytes. */
  readonly data: string;
}

export interface CloudAvatar extends AvatarPayload {
  readonly version: number;
  readonly updated_at: string;
}

export type GetAvatarResponse = CloudAvatar | null;

export interface PutAvatarRequest extends AvatarPayload {
  readonly expected_version: number | null;
}

export type PutAvatarResponse = CloudAvatar;

export interface LocationSubdivision {
  readonly code: string;
  readonly name_en: string;
  readonly name_fr: string | null;
}

export interface LocationCountry {
  readonly code: string;
  readonly name_en: string;
  readonly name_fr: string | null;
  readonly subdivisions: readonly LocationSubdivision[];
}

/** `GET /v1/profile/locations`: the bundled ISO 3166 catalog. */
export interface LocationsResponse {
  readonly countries: readonly LocationCountry[];
}

export const ACCOUNT_ERROR_CODES = [
  "unauthorized",
  "reauthentication_required",
  "validation",
  "version_conflict",
  "payload_too_large",
  "unsupported_media",
  "rate_limited",
  "unavailable",
] as const;
export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

/** Fields a `validation` error may blame: a profile field, or a part of the request itself. */
export const VALIDATION_FIELDS = [
  ...PROFILE_FIELD_NAMES,
  "expected_version",
  "mime_type",
  "data",
  "body",
] as const;
export type ValidationField = (typeof VALIDATION_FIELDS)[number];

/**
 * Why a field was refused. Stable, so every surface resolves its own EN/FR text from
 * `code` + `field` + `reason`; the submitted value is never echoed (AD-12).
 */
export const VALIDATION_REASONS = [
  /** Not a string / number / null where one was required. */
  "invalid_type",
  /** Unparseable: a malformed date, invalid JSON, invalid base64. */
  "invalid_format",
  /** A mandatory member is absent, or a dependent value is set without its companion. */
  "required",
  /** Not in the allow-list (bracket, currency, country, subdivision). */
  "not_allowed",
  "in_future",
  "too_young",
  "too_old",
  /** A subdivision was given without a country. */
  "requires_country",
  /** The selected country has no subdivisions to choose from. */
  "no_subdivisions",
  /** The image's longest edge exceeds `AVATAR_MAX_EDGE_PX`. */
  "dimensions_exceeded",
  /** The body carries a member this contract does not define. */
  "unknown_field",
] as const;
export type ValidationReason = (typeof VALIDATION_REASONS)[number];

export const VERSIONED_RESOURCES = ["profile", "avatar"] as const;
export type VersionedResource = (typeof VERSIONED_RESOURCES)[number];

interface AccountErrorBase<C extends AccountErrorCode> {
  readonly code: C;
  /** Fixed English sentence for logs and support; never rendered raw, never carries a value. */
  readonly message: string;
  readonly request_id: string;
}

export interface AccountValidationError extends AccountErrorBase<"validation"> {
  readonly field: ValidationField;
  readonly reason: ValidationReason;
}

export interface AccountVersionConflictError extends AccountErrorBase<"version_conflict"> {
  readonly resource: VersionedResource;
  /** `null` when the resource does not exist (a numbered write against an absent item). */
  readonly current_version: number | null;
}

export type AccountError =
  | AccountValidationError
  | AccountVersionConflictError
  | AccountErrorBase<
      Exclude<AccountErrorCode, "validation" | "version_conflict">
    >;

export interface AccountErrorResponse {
  readonly error: AccountError;
}

/** The HTTP status each code is returned with by the profile Lambda. */
export const ACCOUNT_ERROR_HTTP_STATUS = {
  unauthorized: 401,
  reauthentication_required: 403,
  validation: 400,
  version_conflict: 409,
  payload_too_large: 413,
  unsupported_media: 415,
  rate_limited: 429,
  unavailable: 503,
} as const satisfies Record<AccountErrorCode, number>;

/**
 * Every API Gateway–owned rejection on the profile API emits the envelope with this code (AD-13).
 * `ACCESS_DENIED` is the insufficient-scope 403, which the desktop reclassifies as
 * `reauthentication_required` because a refresh cannot add a scope. `status: null` keeps the
 * gateway's own status code.
 */
export const ACCOUNT_GATEWAY_RESPONSES = {
  UNAUTHORIZED: { status: 401, code: "unauthorized" },
  ACCESS_DENIED: { status: 403, code: "unauthorized" },
  EXPIRED_TOKEN: { status: 401, code: "unauthorized" },
  MISSING_AUTHENTICATION_TOKEN: { status: 401, code: "unauthorized" },
  THROTTLED: { status: 429, code: "rate_limited" },
  REQUEST_TOO_LARGE: { status: 413, code: "payload_too_large" },
  DEFAULT_4XX: { status: null, code: "unavailable" },
  DEFAULT_5XX: { status: 503, code: "unavailable" },
} as const satisfies Record<
  string,
  { readonly status: number | null; readonly code: AccountErrorCode }
>;
export type AccountGatewayResponseType = keyof typeof ACCOUNT_GATEWAY_RESPONSES;

export function isAccountErrorCode(code: unknown): code is AccountErrorCode {
  return (
    typeof code === "string" &&
    (ACCOUNT_ERROR_CODES as readonly string[]).includes(code)
  );
}

/** Maps any wire code — including one a newer server added — onto the closed union. */
export function toAccountErrorCode(code: unknown): AccountErrorCode {
  return isAccountErrorCode(code) ? code : "unavailable";
}
