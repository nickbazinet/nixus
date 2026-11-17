import {
  VALIDATION_FIELDS,
  VALIDATION_REASONS,
  toAccountErrorCode,
  type AccountErrorCode,
  type ValidationField,
  type ValidationReason,
} from "@nixus/shared";

/**
 * Typed reading of the `AppError` envelope the Rust backend returns from `invoke()`.
 *
 * Before this existed, each call site cast the rejection to an inline
 * `{ message?, type? }` shape, so a variant nobody had branched on fell through to a
 * generic message. That is exactly what `hosted_ai` did: chat replaced it with a
 * hardcoded English retry line, and project advice and trends insight discarded the
 * error object entirely.
 */

/** `AppError::HostedAi`'s `code`, mirroring `CloudAiErrorCode` in the wire contract. */
export type HostedAiErrorCode =
  | "validation"
  | "unauthorized"
  | "reauthentication_required"
  | "premium_required"
  | "payload_too_large"
  | "quota_exhausted"
  | "hosted_unavailable"
  | "unsupported_encoding";

const HOSTED_AI_CODES: readonly HostedAiErrorCode[] = [
  "validation",
  "unauthorized",
  "reauthentication_required",
  "premium_required",
  "payload_too_large",
  "quota_exhausted",
  "hosted_unavailable",
  "unsupported_encoding",
];

export interface HostedAiError {
  readonly type: "hosted_ai";
  readonly code: HostedAiErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}

/**
 * `AppError::Sync`'s `code` (AD-16). The backend's `SyncFault::code` is the authority;
 * every value here is one of its arms. `code` is the discriminator the UI switches on
 * because `message` is a fixed support-grade English sentence, never a localized one and
 * never anything derived from the user's data.
 */
export type SyncErrorCode =
  | "local_only"
  | "not_entitled"
  | "frozen"
  | "account_mismatch"
  | "owner_mismatch"
  | "owner_malformed"
  | "state_unavailable"
  | "signed_out"
  | "not_configured"
  | "offline"
  | "identity_rejected"
  | "remote_missing"
  | "install_collision"
  | "forbidden"
  | "credentials_expired"
  | "remote_changed"
  | "transport"
  | "snapshot_build"
  | "dataset_busy"
  | "update_needed"
  | "snapshot_invalid"
  | "restore_failed"
  | "profile_create_failed"
  | "not_enabled"
  | "no_pending_prompt"
  | "actor_unavailable"
  | "image_missing"
  | "image_corrupt"
  | "segment_invalid"
  | "apply_failed"
  | "clock_skew"
  | "payload_too_large"
  | "restore_not_found"
  | "restore_parent_missing"
  | "restore_conflict";

const SYNC_CODES: readonly SyncErrorCode[] = [
  "local_only",
  "not_entitled",
  "frozen",
  "account_mismatch",
  "owner_mismatch",
  "owner_malformed",
  "state_unavailable",
  "signed_out",
  "not_configured",
  "offline",
  "identity_rejected",
  "remote_missing",
  "install_collision",
  "forbidden",
  "credentials_expired",
  "remote_changed",
  "transport",
  "snapshot_build",
  "dataset_busy",
  "update_needed",
  "snapshot_invalid",
  "restore_failed",
  "profile_create_failed",
  "not_enabled",
  "no_pending_prompt",
  "actor_unavailable",
  "image_missing",
  "image_corrupt",
  "segment_invalid",
  "apply_failed",
  "clock_skew",
  "payload_too_large",
  "restore_not_found",
  "restore_parent_missing",
  "restore_conflict",
];

export interface SyncError {
  readonly type: "sync";
  readonly code: SyncErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}

/**
 * i18n key for a sync failure, keyed on `code` rather than on `message`.
 *
 * Exhaustive with no `default`, so a code added to `SyncErrorCode` is a compile error here rather
 * than a silent generic sentence. The grouping is by what the user has to DO: the codes that only
 * differ in which internal step failed share one key, while every code with its own next action
 * (sign in, upgrade, reconnect, update the app, answer a prompt, contact support) gets its own.
 *
 * `not_entitled` and `frozen` deliberately name no tier (AD-14): the wording is about the account's
 * access to multi-computer sync, which is the one capability flag the backend checks.
 */
export function syncMessageKey(code: SyncErrorCode): string {
  switch (code) {
    case "local_only":
      return "sync.errorLocalOnly";
    case "not_entitled":
      return "sync.errorNotEntitled";
    case "frozen":
      return "sync.errorFrozen";
    case "account_mismatch":
    case "owner_mismatch":
      return "sync.errorAccountMismatch";
    case "owner_malformed":
    case "snapshot_invalid":
      return "sync.errorCloudCopyUnreadable";
    case "state_unavailable":
    case "dataset_busy":
      return "sync.errorDatasetBusy";
    case "signed_out":
    case "identity_rejected":
    case "credentials_expired":
      return "sync.errorSignedOut";
    case "not_configured":
      return "sync.errorNotConfigured";
    case "offline":
      return "sync.errorOffline";
    // Kept apart from `offline` even though both are transport-shaped: `parseAppError` degrades an
    // unrecognized code to `transport`, so this arm is also what a newer backend's unknown failure
    // renders as, and telling that user "no connection" would be a confident wrong diagnosis.
    case "transport":
      return "sync.errorTransport";
    case "remote_missing":
      return "sync.errorRemoteMissing";
    case "install_collision":
      return "sync.errorInstallCollision";
    case "forbidden":
      return "sync.errorForbidden";
    case "remote_changed":
      return "sync.errorRemoteChanged";
    case "snapshot_build":
      return "sync.errorSnapshotBuild";
    case "update_needed":
      return "sync.errorUpdateNeeded";
    case "restore_failed":
      return "sync.errorRestoreFailed";
    case "profile_create_failed":
      return "sync.errorProfileCreateFailed";
    case "not_enabled":
      return "sync.errorNotEnabled";
    case "no_pending_prompt":
      return "sync.errorNoPendingPrompt";
    case "actor_unavailable":
      return "sync.errorActorUnavailable";
    case "image_missing":
      return "sync.errorImageMissing";
    case "image_corrupt":
      return "sync.errorImageCorrupt";
    // Kept apart from every transport code: a change arrived and could not be read or written, so
    // the cloud copy is intact, nothing is lost, and the next action is to wait or to update —
    // never to reconnect.
    case "segment_invalid":
      return "sync.errorSegmentInvalid";
    case "apply_failed":
      return "sync.errorApplyFailed";
    // Its own key because it is the only sync failure whose fix is outside Nixus entirely.
    case "clock_skew":
      return "sync.errorClockSkew";
    // Its own key because nothing here is broken and no retry will help: something is simply too
    // big to send, and the only next step is on the user's side.
    case "payload_too_large":
      return "sync.errorPayloadTooLarge";
    // The three restore refusals each name a different next action: nothing to restore any more,
    // restore what it belonged to first, or deal with the thing that took its place.
    case "restore_not_found":
      return "recentlyDeleted.errorNotFound";
    case "restore_parent_missing":
      return "recentlyDeleted.errorParentMissing";
    case "restore_conflict":
      return "recentlyDeleted.errorConflict";
  }
}

/**
 * `AppError::CloudProfile` (AD-13): one variant for both profile homes, local validation
 * included. `code`, `field` and `reason` are the shared account contract's vocabularies; the UI
 * resolves its EN/FR text from them and never renders `message`, which carries no value (AD-12).
 */
export interface CloudProfileError {
  readonly type: "cloud_profile";
  readonly code: AccountErrorCode;
  readonly message: string;
  readonly field: ValidationField | null;
  readonly reason: ValidationReason | null;
  readonly recoverable: boolean;
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return allowed.find((member) => member === value) ?? null;
}

export interface GenericAppError {
  readonly type: string | undefined;
  readonly message: string | undefined;
}

export type ParsedAppError =
  | HostedAiError
  | SyncError
  | CloudProfileError
  | GenericAppError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isHostedAiError(error: ParsedAppError): error is HostedAiError {
  return error.type === "hosted_ai";
}

export function isSyncError(error: ParsedAppError): error is SyncError {
  return error.type === "sync";
}

export function isCloudProfileError(
  error: ParsedAppError,
): error is CloudProfileError {
  return error.type === "cloud_profile";
}

/**
 * Narrows a Tauri rejection. An unrecognized `code` degrades to
 * `hosted_unavailable` rather than being dropped: a server that gains a code this
 * build has never heard of is still a hosted failure, and treating it as unknown
 * would restore the silent fall-through this module exists to remove.
 */
export function parseAppError(error: unknown): ParsedAppError {
  if (!isRecord(error)) {
    return {
      type: undefined,
      message: typeof error === "string" ? error : undefined,
    };
  }

  const type = typeof error.type === "string" ? error.type : undefined;
  const message = typeof error.message === "string" ? error.message : undefined;

  if (type === "hosted_ai") {
    const raw = error.code;
    const code = HOSTED_AI_CODES.includes(raw as HostedAiErrorCode)
      ? (raw as HostedAiErrorCode)
      : "hosted_unavailable";

    return {
      type: "hosted_ai",
      code,
      message: message ?? "",
      recoverable: error.recoverable !== false,
    };
  }

  if (type === "sync") {
    const raw = error.code;
    // An unrecognized code degrades to `transport` rather than being dropped, for the
    // same reason as the hosted-AI table above: a newer backend's failure is still a sync
    // failure, and falling through would restore the silent generic message.
    const code = SYNC_CODES.includes(raw as SyncErrorCode)
      ? (raw as SyncErrorCode)
      : "transport";

    return {
      type: "sync",
      code,
      message: message ?? "",
      recoverable: error.recoverable !== false,
    };
  }

  if (type === "cloud_profile") {
    // An unknown code degrades to `unavailable` (AD-13's evolution rule), never to a generic
    // fall-through; an unknown field or reason degrades to `null` rather than a wrong label.
    return {
      type: "cloud_profile",
      code: toAccountErrorCode(error.code),
      message: message ?? "",
      field: oneOf(VALIDATION_FIELDS, error.field),
      reason: oneOf(VALIDATION_REASONS, error.reason),
      recoverable: error.recoverable !== false,
    };
  }

  return { type, message };
}

/**
 * i18n key for a hosted-AI failure.
 *
 * The four codes the closed fallback table never falls back from — validation, size,
 * encoding, and reauthentication — each need their own wording, because the user's
 * next action differs and a generic "try again" is actively wrong for all four.
 */
export function hostedAiMessageKey(code: HostedAiErrorCode): string {
  switch (code) {
    case "validation":
      return "hostedAi.validation";
    case "payload_too_large":
      return "hostedAi.payloadTooLarge";
    case "unsupported_encoding":
      return "hostedAi.unsupportedEncoding";
    case "reauthentication_required":
      return "hostedAi.reauthenticationRequired";
    case "unauthorized":
      return "hostedAi.unauthorized";
    case "premium_required":
      return "hostedAi.premiumRequired";
    case "quota_exhausted":
      return "hostedAi.quotaExhausted";
    case "hosted_unavailable":
      return "hostedAi.unavailable";
  }
}

/** Whether re-running the same request unchanged could plausibly succeed. */
export function hostedAiIsRetryable(code: HostedAiErrorCode): boolean {
  return !(
    code === "validation" ||
    code === "payload_too_large" ||
    code === "unsupported_encoding" ||
    code === "reauthentication_required"
  );
}

/** Whether the user has to act in the auth/account layer before retrying. */
export function hostedAiNeedsSignIn(code: HostedAiErrorCode): boolean {
  return code === "reauthentication_required" || code === "unauthorized";
}

/**
 * `AppError::Validation`'s `field` values that `ai/attachment.rs` uses to say WHY an
 * attachment was refused, mapped to their i18n key.
 *
 * The reason travels as the field rather than the message because the Rust message is
 * fixed English: each refusal needs its own localized wording, since the user's next
 * action differs (pick a different file vs. shrink this one).
 */
const CHAT_ATTACHMENT_MESSAGE_KEYS = {
  attachment_unsupported_type: "chat.attachmentUnsupportedType",
  attachment_empty: "chat.attachmentEmpty",
  attachment_too_large: "chat.attachmentTooLarge",
  attachment_unreadable: "chat.attachmentUnreadable",
} as const;

export type ChatAttachmentRejection = keyof typeof CHAT_ATTACHMENT_MESSAGE_KEYS;

/** The i18n key for an attachment refusal, or `null` when the rejection is something else. */
export function chatAttachmentMessageKey(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (error.type !== "validation") return null;
  const field = error.field;
  if (typeof field !== "string") return null;
  // Own-property only: a `field` of "constructor" or "toString" resolves to an inherited
  // function through a plain-object lookup, which would defeat the `?? null` and hand a
  // non-key to `t()`.
  if (!Object.prototype.hasOwnProperty.call(CHAT_ATTACHMENT_MESSAGE_KEYS, field)) {
    return null;
  }
  return CHAT_ATTACHMENT_MESSAGE_KEYS[field as ChatAttachmentRejection];
}

/**
 * `AppError::Validation`'s `field` values a project-image write or validation can carry.
 *
 * The six `project_image_*` literals come from `projects/image.rs` and describe the FILE. The
 * seventh, `project_id`, comes from the write path's archived/missing-project guard and
 * describes the PROJECT, so it gets its own key: "pick another file" is the wrong instruction
 * when the goal itself is gone. `content_mismatch` and `dimensions` stay separate for the same
 * reason — the validator emits `content_mismatch` for a corrupt or truncated header and
 * `dimensions` only once a real width and height were determined and exceeded 12 megapixels.
 */
const PROJECT_IMAGE_MESSAGE_KEYS = {
  project_image_unsupported_type: "projects.image.unsupportedType",
  project_image_empty: "projects.image.empty",
  project_image_too_large: "projects.image.tooLarge",
  project_image_unreadable: "projects.image.unreadable",
  project_image_content_mismatch: "projects.image.contentMismatch",
  project_image_dimensions: "projects.image.dimensions",
  project_id: "projects.image.projectUnavailable",
} as const;

export type ProjectImageRejection = keyof typeof PROJECT_IMAGE_MESSAGE_KEYS;

/**
 * The i18n key for a project-image refusal, or `null` when the rejection is something else.
 *
 * `null` rather than falling back to `unreadable`: a database failure or an unmapped field is
 * not a bad file, and telling someone their perfectly good photograph "could not be read" sends
 * them to replace a file that was never the problem. Callers render a generic failure instead.
 */
export function projectImageMessageKey(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (error.type !== "validation") return null;
  const field = error.field;
  if (typeof field !== "string") return null;
  // Own-property only, for the same reason as the attachment map above.
  if (
    !Object.prototype.hasOwnProperty.call(PROJECT_IMAGE_MESSAGE_KEYS, field)
  ) {
    return null;
  }
  return PROJECT_IMAGE_MESSAGE_KEYS[field as ProjectImageRejection];
}

/**
 * The same refusals a profile-picture upload can carry, mapped to profile-owned copy.
 *
 * The six `project_image_*` literals are shared deliberately: `avatar_store::derive_from_file`
 * calls the same validator rather than forking it, so the fields are identical while the wording
 * is not — "project image" is the wrong noun on the profile page, and the avatar's 256px
 * derivative makes `dimensions` mean something different to the user than it does for a project
 * cover. The seventh, `user_avatar_unprocessable`, has no project counterpart: it means the source
 * passed every check but no derivative under the stored ceiling could be produced, so telling the
 * user their file "is not a usable PNG or JPEG" would send them to replace a file that was fine.
 */
const USER_AVATAR_MESSAGE_KEYS = {
  project_image_unsupported_type: "profile.avatar.unsupportedType",
  project_image_empty: "profile.avatar.empty",
  project_image_too_large: "profile.avatar.tooLarge",
  project_image_unreadable: "profile.avatar.unreadable",
  project_image_content_mismatch: "profile.avatar.contentMismatch",
  project_image_dimensions: "profile.avatar.dimensions",
  user_avatar_unprocessable: "profile.avatar.unprocessable",
} as const;

export type UserAvatarRejection = keyof typeof USER_AVATAR_MESSAGE_KEYS;

/**
 * The i18n key for a profile-picture refusal, or `null` when the rejection is something else.
 *
 * `null` rather than a nearest-neighbour guess, for the same reason `projectImageMessageKey`
 * returns it: a keyring failure or a rejected session is not a bad file, and the caller renders a
 * generic failure instead of sending the user to pick a different picture.
 *
 * Reads BOTH error types on purpose (H7): one photo-picker click can be refused locally as
 * `validation` by the shared image validator, or by the profile API as `cloud_profile`. Gating on
 * the local type alone is what used to drop a server-side refusal into the generic fallback.
 */
export function userAvatarMessageKey(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (error.type === "cloud_profile") return cloudAvatarMessageKey(error);
  if (error.type !== "validation") return null;
  const field = error.field;
  if (typeof field !== "string") return null;
  // Own-property only, for the same reason as the two maps above.
  if (!Object.prototype.hasOwnProperty.call(USER_AVATAR_MESSAGE_KEYS, field)) {
    return null;
  }
  return USER_AVATAR_MESSAGE_KEYS[field as UserAvatarRejection];
}

/**
 * The four server refusals that mean "this picture is the problem", mapped onto the same copy the
 * local validator's refusals resolve to. Every other code — a conflict, a sign-in, an outage — is
 * about the request rather than the file, so it stays `null` and the caller renders its own state.
 */
function cloudAvatarMessageKey(error: Record<string, unknown>): string | null {
  const code = toAccountErrorCode(error.code);
  if (code === "unsupported_media") return "profile.avatar.unsupportedType";
  if (code === "payload_too_large") return "profile.avatar.tooLarge";
  if (code !== "validation") return null;

  // Only the avatar's own `data` member: a refused `birth_date` is not a picture problem.
  if (oneOf(VALIDATION_FIELDS, error.field) !== "data") return null;

  switch (oneOf(VALIDATION_REASONS, error.reason)) {
    case "dimensions_exceeded":
      return "profile.avatar.dimensions";
    case "invalid_format":
      return "profile.avatar.unreadable";
    default:
      return null;
  }
}

/**
 * The i18n key for a Nixus Cloud profile failure, for every code in the closed union (AD-13).
 *
 * Keyed by `code`, and for a `validation` by its `reason` — never by `message`, which is a fixed
 * English support sentence carrying no submitted value (AD-12). A field is consulted only where it
 * changes the sentence rather than the subject: the form already marks which input was refused, so
 * one key per reason is what the user actually reads.
 */
const CLOUD_PROFILE_CODE_KEYS: Record<AccountErrorCode, string> = {
  unauthorized: "profile.errors.unauthorized",
  reauthentication_required: "profile.errors.reauthenticationRequired",
  validation: "profile.errors.validation.generic",
  version_conflict: "profile.errors.versionConflict",
  payload_too_large: "profile.errors.payloadTooLarge",
  unsupported_media: "profile.errors.unsupportedMedia",
  rate_limited: "profile.errors.rateLimited",
  unavailable: "profile.errors.unavailable",
};

const CLOUD_PROFILE_REASON_KEYS: Record<ValidationReason, string> = {
  invalid_type: "profile.errors.validation.invalidType",
  invalid_format: "profile.errors.validation.invalidFormat",
  required: "profile.errors.validation.required",
  not_allowed: "profile.errors.validation.notAllowed",
  in_future: "profile.errors.validation.inFuture",
  too_young: "profile.errors.validation.tooYoung",
  too_old: "profile.errors.validation.tooOld",
  requires_country: "profile.errors.validation.requiresCountry",
  no_subdivisions: "profile.errors.validation.noSubdivisions",
  dimensions_exceeded: "profile.errors.validation.dimensionsExceeded",
  unknown_field: "profile.errors.validation.unknownField",
};

/**
 * The one field+reason pair whose reason-only sentence would be useless: a bare "this is required"
 * on a currency the user never touched reads as a bug, because what the server is actually refusing
 * is an income bracket left without one (the AD-5 asymmetry).
 */
const CLOUD_PROFILE_FIELD_REASON_KEYS: Partial<
  Record<`${ValidationField}.${ValidationReason}`, string>
> = {
  "income_bracket_currency.required":
    "profile.errors.validation.incomeBracketCurrencyRequired",
};

export function cloudProfileMessageKey(error: CloudProfileError): string {
  if (error.code !== "validation") return CLOUD_PROFILE_CODE_KEYS[error.code];
  if (error.reason === null) return CLOUD_PROFILE_CODE_KEYS.validation;

  if (error.field !== null) {
    const specific =
      CLOUD_PROFILE_FIELD_REASON_KEYS[`${error.field}.${error.reason}`];
    if (specific !== undefined) return specific;
  }

  return CLOUD_PROFILE_REASON_KEYS[error.reason];
}
