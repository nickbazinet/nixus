import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cookie values, `state`, `nonce` and the PKCE verifier are all CSPRNG material,
 * and none of them is ever stored in the clear: a session row is keyed by the
 * SHA-256 of its cookie value, so a dump of the table hands an attacker no
 * usable cookie (AD-10).
 */

/** 32 bytes of CSPRNG, base64url — safe as a cookie value and as a `state`. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** PKCE S256 challenge for a verifier, per RFC 7636. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/**
 * Constant-time comparison for `state` and `nonce`.
 *
 * Length is compared first and non-constant-time on purpose: `timingSafeEqual`
 * throws on a length mismatch, and the length of a CSPRNG token is not a secret.
 */
export function secureEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
