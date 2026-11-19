import { describe, expect, it } from "vitest";

import {
  DESTINATIONS,
  DEFAULT_DESTINATION,
  billingDestination,
  billingLoginLocation,
  checkoutCompleteDestination,
  destinationPath,
  isDestinationKey,
  loginLocation,
  loginLocationFor,
  profileDestination,
  profileLocation,
  resolveDestinationKey,
} from "./destinations.ts";

/*
 * Adversary H11: the post-authentication destination is a KEY, so the only thing
 * to prove is that an unknown key resolves to the default and that no declared
 * destination is anything but a same-origin path.
 */

describe("the destination map", () => {
  it.each(Object.entries(DESTINATIONS))("maps %s to the absolute path %s", (_key, path) => {
    expect(path.startsWith("/")).toBe(true);
    // A protocol-relative or backslash-escaped path is a different ORIGIN to a
    // browser, which is exactly what makes `//evil.example` an open redirect.
    expect(path.startsWith("//")).toBe(false);
    expect(path).not.toContain("\\");
    expect(path).not.toContain(":");
    expect(path).not.toContain("..");
  });
});

describe("resolveDestinationKey", () => {
  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "http://evil.example",
    "https://account.nixusapp.com.evil.example",
    "javascript:alert(1)",
    "/profile",
    "/fr/profile",
    "PROFILE",
    "profile\n",
    "",
    "   ",
  ])("falls back to the default for %j", (value) => {
    expect(resolveDestinationKey(value)).toBe(DEFAULT_DESTINATION);
  });

  it.each([null, undefined, 0, {}, [], true])("falls back to the default for %j", (value) => {
    expect(resolveDestinationKey(value)).toBe(DEFAULT_DESTINATION);
  });

  it("honours the declared fallback rather than the English default", () => {
    expect(resolveDestinationKey("nonsense", "profile-fr")).toBe("profile-fr");
  });

  it.each(Object.keys(DESTINATIONS))("accepts the declared key %s", (key) => {
    expect(resolveDestinationKey(key)).toBe(key);
    expect(isDestinationKey(key)).toBe(true);
  });

  it("refuses an inherited Object member as a key", () => {
    expect(isDestinationKey("toString")).toBe(false);
    expect(isDestinationKey("constructor")).toBe(false);
    expect(resolveDestinationKey("__proto__")).toBe(DEFAULT_DESTINATION);
  });
});

describe("destinationPath", () => {
  it("only ever returns a declared path", () => {
    for (const key of Object.keys(DESTINATIONS)) {
      expect(Object.values(DESTINATIONS)).toContain(
        destinationPath(key as keyof typeof DESTINATIONS),
      );
    }
  });
});

/*
 * The entry redirects (`/`, `/fr`, and the signed-out arm of `/profile`) build
 * their `Location` here. There is no signed-out landing page any more, so these
 * two strings are the only thing standing between an arriving visitor and the
 * sign-in page — and the only thing that could become an open redirect if a
 * request-supplied value ever reached them.
 */
describe("the entry redirect locations", () => {
  it("sends each locale to its own profile, by key", () => {
    expect(profileDestination("en")).toBe("profile");
    expect(profileDestination("fr")).toBe("profile-fr");
    expect(profileLocation("en")).toBe("/profile");
    expect(profileLocation("fr")).toBe("/fr/profile");
  });

  it("carries the destination KEY into login, never a path", () => {
    expect(loginLocation("en")).toBe("/auth/login?next=profile&lang=en");
    expect(loginLocation("fr")).toBe("/auth/login?next=profile-fr&lang=fr");
  });

  it("resolves its own `next` value back to the key it meant", () => {
    for (const locale of ["en", "fr"] as const) {
      const next = new URL(loginLocation(locale), "https://account.invalid").searchParams.get(
        "next",
      );
      expect(resolveDestinationKey(next)).toBe(profileDestination(locale));
    }
  });

  it.each(["en", "fr"] as const)("stays same-origin and absolute for %s", (locale) => {
    for (const location of [
      profileLocation(locale),
      loginLocation(locale),
      billingLoginLocation(locale),
    ]) {
      expect(location.startsWith("/")).toBe(true);
      expect(location.startsWith("//")).toBe(false);
      expect(location).not.toContain("\\");
      expect(location).not.toContain("..");
      // No scheme, no authority: a browser can only read these as this origin.
      expect(location).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
    }
  });
});

/*
 * The billing surfaces (billing AD-8). Stripe sends a visitor back to
 * `/checkout/complete` after a hosted Checkout, and the pricing page sends them
 * to `/billing?plan=…`, so both have to be reachable by KEY after a sign-in
 * round trip — a `next=` that could name a path is the thing the whole map
 * exists to prevent.
 */
describe("the billing destinations", () => {
  it("names the four billing paths by key, in both locales", () => {
    expect(billingDestination("en")).toBe("billing");
    expect(billingDestination("fr")).toBe("billing-fr");
    expect(checkoutCompleteDestination("en")).toBe("checkout-complete");
    expect(checkoutCompleteDestination("fr")).toBe("checkout-complete-fr");

    expect(destinationPath("billing")).toBe("/billing");
    expect(destinationPath("billing-fr")).toBe("/fr/billing");
    expect(destinationPath("checkout-complete")).toBe("/checkout/complete");
    expect(destinationPath("checkout-complete-fr")).toBe("/fr/checkout/complete");
  });

  it("sends a signed-out billing visitor back to billing, not to the profile", () => {
    expect(billingLoginLocation("en")).toBe("/auth/login?next=billing&lang=en");
    expect(billingLoginLocation("fr")).toBe("/auth/login?next=billing-fr&lang=fr");
  });

  it("resolves its own `next` value back to the key it meant", () => {
    for (const locale of ["en", "fr"] as const) {
      const next = new URL(
        billingLoginLocation(locale),
        "https://account.invalid",
      ).searchParams.get("next");
      expect(resolveDestinationKey(next)).toBe(billingDestination(locale));
    }
  });

  it("carries no plan, promotion code or other query value into the login url", () => {
    for (const locale of ["en", "fr"] as const) {
      expect(billingLoginLocation(locale)).toBe(
        `/auth/login?next=${billingDestination(locale)}&lang=${locale}`,
      );
    }
  });

  it("builds every login location from a key in the closed map", () => {
    for (const key of Object.keys(DESTINATIONS)) {
      const location = loginLocationFor(key as keyof typeof DESTINATIONS, "en");
      const next = new URL(location, "https://account.invalid").searchParams.get("next");
      expect(isDestinationKey(next)).toBe(true);
    }
  });
});

