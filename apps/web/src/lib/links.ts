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
 * Where a pricing-page plan button sends a visitor. Checkout lives in the
 * account app (AD-8), and a plan travels as its `lookup_key`, never as a
 * Stripe `price_id` (AD-6).
 */
export function billingPlanUrl(planLookupKey: string): string {
  return `${ACCOUNT_APP_URL}/billing?plan=${encodeURIComponent(planLookupKey)}`;
}
