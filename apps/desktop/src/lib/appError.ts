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

export interface GenericAppError {
  readonly type: string | undefined;
  readonly message: string | undefined;
}

export type ParsedAppError = HostedAiError | GenericAppError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isHostedAiError(error: ParsedAppError): error is HostedAiError {
  return error.type === "hosted_ai";
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
 */
export function userAvatarMessageKey(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (error.type !== "validation") return null;
  const field = error.field;
  if (typeof field !== "string") return null;
  // Own-property only, for the same reason as the two maps above.
  if (!Object.prototype.hasOwnProperty.call(USER_AVATAR_MESSAGE_KEYS, field)) {
    return null;
  }
  return USER_AVATAR_MESSAGE_KEYS[field as UserAvatarRejection];
}
