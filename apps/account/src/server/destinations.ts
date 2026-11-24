import { isPlanLookupKeyShaped } from "@nixus/shared";

/**
 * Post-authentication destinations (AD-10, adversary H11).
 *
 * A destination is a KEY into this map, never a URL. `/auth/login?next=…` accepts
 * only a key; anything else — `//evil.example`, `/\evil.example`,
 * `https://evil.example`, `https://account.nixusapp.com.evil.example`,
 * `javascript:…` — resolves to the default. No request-supplied string ever
 * reaches a `Location` header or a client-side redirect, so there is nothing for a
 * prefix, suffix or scheme check to get wrong.
 *
 * One request-supplied value DOES survive the round trip — `plan` — and it is
 * fenced in three ways rather than trusted: it is shape-validated by the billing
 * contract's own `isPlanLookupKeyShaped`, it is only ever appended as a QUERY
 * value to a path read out of the map by key, and it is only appended at all when
 * that key is a billing one. See `planQuery` below.
 */

export const DESTINATIONS = {
  profile: "/profile",
  "profile-fr": "/fr/profile",
  billing: "/billing",
  "billing-fr": "/fr/billing",
  // Stripe's `success_url` is built from a server-side path constant on the
  // billing API's side (billing AD-8); these two keys are what lets the SAME
  // landing page be reached through `/auth/login?next=…` when the session has
  // lapsed while the visitor was away on Stripe's own pages.
  "checkout-complete": "/checkout/complete",
  "checkout-complete-fr": "/fr/checkout/complete",
  home: "/",
  "home-fr": "/fr",
} as const satisfies Record<string, `/${string}`>;

export type DestinationKey = keyof typeof DESTINATIONS;

export const DEFAULT_DESTINATION: DestinationKey = "profile";
export const DEFAULT_DESTINATION_FR: DestinationKey = "profile-fr";

export function isDestinationKey(value: unknown): value is DestinationKey {
  return typeof value === "string" && Object.hasOwn(DESTINATIONS, value);
}

/** The only way a destination becomes a path. An unknown key is the default. */
export function destinationPath(key: DestinationKey): string {
  return DESTINATIONS[key];
}

/**
 * Narrow an untrusted `next` query value to a key.
 *
 * `fallback` lets `/fr/…` sign-ins land back in French without the request being
 * able to name an arbitrary path.
 */
export function resolveDestinationKey(
  value: unknown,
  fallback: DestinationKey = DEFAULT_DESTINATION,
): DestinationKey {
  return isDestinationKey(value) ? value : fallback;
}

/**
 * The profile destination for a locale — a key, so the only two paths an entry
 * redirect can name are the two already in the map above.
 */
export function profileDestination(locale: "en" | "fr"): DestinationKey {
  return locale === "fr" ? DEFAULT_DESTINATION_FR : DEFAULT_DESTINATION;
}

/** The billing destination for a locale, by key, for the same reason. */
export function billingDestination(locale: "en" | "fr"): DestinationKey {
  return locale === "fr" ? "billing-fr" : "billing";
}

/**
 * Whether a destination is one of the two pages that understand `?plan=`.
 *
 * Membership of a literal pair rather than a prefix test on the PATH: the plan is
 * re-attached after authentication, and the page it lands on is the only thing
 * that may ever see it. `/profile`, `/`, and the Stripe-return pages get nothing
 * — a plan on them would be a request-supplied value travelling further than the
 * one surface that validates it against the catalog.
 */
export function isBillingDestination(key: DestinationKey): boolean {
  return key === "billing" || key === "billing-fr";
}

/**
 * Narrow an untrusted `plan` query value to a lookup key, or `null`.
 *
 * Shape only, by the billing contract's own predicate (billing AD-6): whether the
 * key names a published Price is decided later, by the billing page, against the
 * catalog it actually loaded. A malformed value is DROPPED rather than refused,
 * because a stale pricing link must still produce a working sign-in.
 */
export function resolvePlanLookupKey(value: unknown): string | null {
  return isPlanLookupKeyShaped(value) ? value : null;
}

/**
 * `?plan=…` for a destination, or `""`.
 *
 * The only place a plan becomes part of a location, and the reason this is safe:
 *
 *  - The value passed `isPlanLookupKeyShaped`, whose pattern admits lowercase
 *    letters, digits and underscores only, up to 64 characters. It can hold no
 *    `&`, `#`, `/`, `\`, `:` or `%`, so it cannot open a second query parameter,
 *    terminate the query, climb a path or introduce a scheme.
 *  - It is appended to a path that still comes out of the closed map by key, so
 *    the origin and the path are constants no matter what the request asked for.
 *  - It is dropped entirely for a destination that is not a billing one.
 *
 * `encodeURIComponent` is the identity function on a value of that shape. It is
 * applied anyway so the safety of this function does not depend on the pattern
 * staying exactly as narrow as it is today.
 */
function planQuery(destination: DestinationKey, plan: unknown): string {
  if (!isBillingDestination(destination)) return "";
  const lookupKey = resolvePlanLookupKey(plan);
  return lookupKey === null ? "" : `plan=${encodeURIComponent(lookupKey)}`;
}

/** The Stripe-return landing page for a locale, by key, for the same reason. */
export function checkoutCompleteDestination(locale: "en" | "fr"): DestinationKey {
  return locale === "fr" ? "checkout-complete-fr" : "checkout-complete";
}

/**
 * The `Location` values the entry redirects and the page loaders issue.
 *
 * Built from constants only: the path is read out of the map above by key, and
 * the login URL carries that same KEY plus a locale from a two-member union. No
 * request-supplied string reaches either, so neither is an open redirect
 * regardless of what the request asked for.
 */
export function profileLocation(locale: "en" | "fr"): string {
  return destinationPath(profileDestination(locale));
}

/**
 * Where the callback sends the browser once a session exists.
 *
 * The path is a constant from the map; the plan the visitor asked for before
 * signing in is re-attached only when the destination is a billing page, so the
 * pricing page's "Start your free trial" link survives Managed Login instead of
 * dropping the visitor on a plan list they have to navigate again.
 */
export function destinationLocation(destination: DestinationKey, plan: unknown): string {
  const query = planQuery(destination, plan);
  const path = destinationPath(destination);
  return query === "" ? path : `${path}?${query}`;
}

export function loginLocationFor(
  destination: DestinationKey,
  locale: "en" | "fr",
  plan: unknown = null,
): string {
  const query = planQuery(destination, plan);
  const base = `/auth/login?next=${destination}&lang=${locale}`;
  return query === "" ? base : `${base}&${query}`;
}

export function loginLocation(locale: "en" | "fr"): string {
  return loginLocationFor(profileDestination(locale), locale);
}

/**
 * Where a signed-out visitor to `/billing` or `/checkout/complete` is sent.
 *
 * It carries the BILLING key rather than the profile one so a visitor who
 * arrived from the pricing page lands back on the page they asked for after
 * Managed Login, instead of on a profile form. Still a key into the closed map
 * above, so this is not a widening of what a request can name.
 *
 * `plan` is the one request-supplied value it forwards, and only after the shape
 * check above. Without it the plan deep link dies at the sign-in gate and the
 * visitor has to return to the pricing page and click the same button again.
 */
export function billingLoginLocation(locale: "en" | "fr", plan: unknown = null): string {
  return loginLocationFor(billingDestination(locale), locale, plan);
}
