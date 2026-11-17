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
