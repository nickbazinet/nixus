import type { Locale } from "./locale";
import { SITE } from "./site";

/**
 * Off-site destinations. Internal pages are reached through router `<Link>`s,
 * so only URLs the router cannot type-check live here.
 */

/** The account app is a separate origin with its own deploy (AD-10). */
export const ACCOUNT_APP_URL = "https://account.nixusapp.com";

export const GITHUB_URL = SITE.repositoryUrl;
export const INSTAGRAM_URL = "https://www.instagram.com/nixusapp/";
export const FACEBOOK_URL = "https://www.facebook.com/people/Nixus/61594399344720/";

/**
 * The account app, in the visitor's language.
 *
 * It mirrors this site's URL scheme — English at the root, French under `/fr`
 * (`apps/account/src/routes/fr/`) — so carrying the language across the origin
 * boundary is a prefix, not a query parameter. Without it, a visitor reading
 * French marketing copy lands on an English checkout.
 */
export function accountAppUrl(locale: Locale): string {
  return locale === "fr" ? `${ACCOUNT_APP_URL}/fr` : ACCOUNT_APP_URL;
}

/**
 * Where a pricing-page plan button sends a visitor. Checkout lives in the
 * account app (AD-8), and a plan travels as its `lookup_key`, never as a
 * Stripe `price_id` (AD-6).
 */
export function billingPlanUrl(locale: Locale, planLookupKey: string): string {
  return `${accountAppUrl(locale)}/billing?plan=${encodeURIComponent(planLookupKey)}`;
}
