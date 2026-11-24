/*
 * The server-side destination allow-list (AD-8, profile AD-10). Every URL the
 * caller is ever sent to is composed HERE from a configured origin plus one of
 * the fixed paths below. No request-supplied URL is accepted, echoed or
 * redirected to, on any route.
 */

const CHECKOUT_SUCCESS_PATH = "/checkout/complete";
// Checkout is only ever started from the account app's billing page; the
// marketing `/pricing` page lives on a different origin and 404s here.
const CHECKOUT_CANCEL_PATH = "/billing";
const PORTAL_RETURN_PATH = "/billing";

export const ALLOWED_DESTINATION_PATHS: readonly string[] = [
  CHECKOUT_SUCCESS_PATH,
  CHECKOUT_CANCEL_PATH,
  PORTAL_RETURN_PATH,
];

/**
 * The account app's own origin, from configuration. Validated as an
 * `https://host` with no path, query or fragment, because anything else would
 * let a mis-set parameter turn a fixed path into an attacker-chosen URL.
 */
export function accountAppOrigin(): string {
  const configured = process.env.ACCOUNT_APP_ORIGIN;
  if (!configured) {
    throw new Error("ACCOUNT_APP_ORIGIN is not configured");
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("ACCOUNT_APP_ORIGIN is not a valid origin");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/"
  ) {
    throw new Error("ACCOUNT_APP_ORIGIN is not a valid origin");
  }
  return parsed.origin;
}

function destination(path: string): string {
  return `${accountAppOrigin()}${path}`;
}

export function checkoutSuccessUrl(): string {
  return destination(CHECKOUT_SUCCESS_PATH);
}

export function checkoutCancelUrl(): string {
  return destination(CHECKOUT_CANCEL_PATH);
}

export function portalReturnUrl(): string {
  return destination(PORTAL_RETURN_PATH);
}
