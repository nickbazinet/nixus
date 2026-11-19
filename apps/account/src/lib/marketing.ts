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

function marketingUrl(locale: Locale, path: string): string {
  return locale === "fr" ? `${MARKETING_ORIGIN}/fr${path}` : `${MARKETING_ORIGIN}${path}`;
}

export function marketingHomeUrl(locale: Locale): string {
  return marketingUrl(locale, "/");
}

export function marketingFeaturesUrl(locale: Locale): string {
  return marketingUrl(locale, "/features");
}

export function marketingPricingUrl(locale: Locale): string {
  return marketingUrl(locale, "/pricing");
}

export function marketingDownloadUrl(locale: Locale): string {
  return marketingUrl(locale, "/download");
}

export function marketingPrivacyUrl(locale: Locale): string {
  return marketingUrl(locale, "/privacy");
}

export function marketingTermsUrl(locale: Locale): string {
  return marketingUrl(locale, "/terms");
}
