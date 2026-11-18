/**
 * Post-authentication destinations (AD-10, adversary H11).
 *
 * A destination is a KEY into this map, never a URL. `/auth/login?next=…` accepts
 * only a key; anything else — `//evil.example`, `/\evil.example`,
 * `https://evil.example`, `https://account.nixusapp.com.evil.example`,
 * `javascript:…` — resolves to the default. No request-supplied string ever
 * reaches a `Location` header or a client-side redirect, so there is nothing for a
 * prefix, suffix or scheme check to get wrong.
 */

export const DESTINATIONS = {
  profile: "/profile",
  "profile-fr": "/fr/profile",
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

/**
 * The two `Location` values the entry redirects issue.
 *
 * Built from constants only: the profile path is read out of the map above by
 * key, and the login URL carries that same KEY plus a locale from a two-member
 * union. No request-supplied string reaches either, so neither is an open
 * redirect regardless of what the request asked for.
 */
export function profileLocation(locale: "en" | "fr"): string {
  return destinationPath(profileDestination(locale));
}

export function loginLocation(locale: "en" | "fr"): string {
  return `/auth/login?next=${profileDestination(locale)}&lang=${locale}`;
}
