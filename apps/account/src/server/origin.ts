/**
 * `Origin` verification for every state-changing request (AD-10, adversary L3).
 *
 * Compared against the CONFIGURED public origin, never against the request's own
 * `Host`: behind CloudFront with `AllViewerExceptHostHeader` the server sees the
 * Lambda Web Function endpoint's domain as `Host`, so a `Host`-derived comparison
 * would compare a value the viewer never sent against itself.
 *
 * A missing `Origin` is a refusal, not a pass. Browsers send `Origin` on every
 * CORS-relevant and every non-GET fetch; the requests that omit it are the ones
 * no browser made.
 */

export type OriginCheck = "ok" | "missing" | "mismatch";

export function checkOrigin(originHeader: string | null, publicOrigin: string): OriginCheck {
  if (originHeader === null || originHeader === "") return "missing";
  // Exact string equality on the serialized origin. A URL-parse-and-compare would
  // accept `https://account.nixusapp.com:443` and other spellings a browser never
  // emits, and widening the accepted set here buys nothing.
  return originHeader === publicOrigin ? "ok" : "mismatch";
}

export function isSameOrigin(originHeader: string | null, publicOrigin: string): boolean {
  return checkOrigin(originHeader, publicOrigin) === "ok";
}
