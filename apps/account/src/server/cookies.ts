/**
 * `__Host-` cookie serialization (AD-10).
 *
 * The prefix is a browser-enforced contract: `Secure`, `Path=/`, and no `Domain`.
 * It is what makes the session cookie unsettable by a sibling host, so the
 * attributes are not configurable here — a caller chooses the name, the value and
 * the lifetime, and nothing else.
 */

export interface CookieSpec {
  readonly name: string;
  readonly value: string;
  readonly maxAgeSeconds: number;
}

export function serializeHostCookie({ name, value, maxAgeSeconds }: CookieSpec): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    // Lax, not Strict: the OAuth round-trip returns as a top-level GET navigation
    // from auth.nixusapp.com, and Strict would withhold the pre-auth cookie there,
    // breaking every sign-in. Every state change is a POST with a verified Origin.
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

/** An immediate expiry with an empty value, so a cleared cookie carries nothing. */
export function clearHostCookie(name: string): string {
  return [`${name}=`, "Path=/", "Secure", "HttpOnly", "SameSite=Lax", "Max-Age=0"].join("; ");
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (name === "") continue;
    jar[name] = part.slice(separator + 1).trim();
  }
  return jar;
}
