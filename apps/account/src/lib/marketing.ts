import type { Locale } from "./i18n";

/**
 * Links back out to nixusapp.com.
 *
 * Absolute and locale-aware: this app is a separate origin from the marketing
 * site, so a relative path would resolve against `account.nixusapp.com` and
 * 404. The host is a constant here rather than configuration because it is the
 * public brand address, not a deployment detail — nothing in the auth or
 * session path reads it, and no request-supplied value can reach it.
 */

const MARKETING_ORIGIN = "https://nixusapp.com";

export function marketingHomeUrl(locale: Locale): string {
  return locale === "fr" ? `${MARKETING_ORIGIN}/fr/` : `${MARKETING_ORIGIN}/`;
}

export function marketingPrivacyUrl(locale: Locale): string {
  return locale === "fr" ? `${MARKETING_ORIGIN}/fr/privacy` : `${MARKETING_ORIGIN}/privacy`;
}

export function marketingTermsUrl(locale: Locale): string {
  return locale === "fr" ? `${MARKETING_ORIGIN}/fr/terms` : `${MARKETING_ORIGIN}/terms`;
}
