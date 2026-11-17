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
