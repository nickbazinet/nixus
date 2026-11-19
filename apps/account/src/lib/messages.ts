import type { TFunction } from "i18next";

/**
 * Error text comes from `code` + `field` + `reason` (AD-12, adversary H8).
 *
 * The server's `message` is never rendered: it is a fixed English sentence for
 * logs and support, and the validation envelope deliberately carries no submitted
 * value. The most specific key that exists wins, so a new `reason` falls back to
 * the code's sentence rather than to a blank.
 */

export interface RefusalKeys {
  readonly code: string;
  readonly field: string | null;
  readonly reason: string | null;
}

export function refusalText(t: TFunction, refusal: RefusalKeys): string {
  const keys = [
    refusal.field && refusal.reason ? `field.${refusal.field}.${refusal.reason}` : null,
    refusal.reason ? `reason.${refusal.reason}` : null,
    `error.${refusal.code}`,
    "error.unavailable",
  ].filter((key): key is string => key !== null);

  return t(keys);
}

export function fieldLabel(t: TFunction, field: string | null): string | null {
  return field === null ? null : t(`field.${field}`);
}

/**
 * The same resolution for a billing refusal, with billing-specific sentences.
 *
 * `billing.error.<code>` is tried BEFORE `error.<code>` because the shared
 * sentences name the profile service, which would be the wrong thing to say
 * here: a billing read that failed leaves the plan unchanged, and saying so is
 * what stops a user assuming their subscription lapsed.
 */
export function billingRefusalText(t: TFunction, refusal: RefusalKeys): string {
  const keys = [
    refusal.field && refusal.reason ? `field.${refusal.field}.${refusal.reason}` : null,
    refusal.reason ? `reason.${refusal.reason}` : null,
    `billing.error.${refusal.code}`,
    `error.${refusal.code}`,
    "billing.error.unavailable",
  ].filter((key): key is string => key !== null);

  return t(keys);
}
