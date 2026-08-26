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
