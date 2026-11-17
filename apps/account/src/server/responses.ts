import type { FlowRedirect } from "./auth-flow.ts";

/**
 * Framework-free 302s.
 *
 * The auth routes build their own `Response` rather than throwing the router's
 * `redirect()` because each one has to attach `Set-Cookie` headers alongside the
 * `Location`, and `cache-control: no-store` — a cached redirect carrying a
 * `Set-Cookie` would hand one visitor's session to the next.
 */
export function redirectResponse(outcome: FlowRedirect): Response {
  const headers = new Headers({
    location: outcome.location,
    "cache-control": "no-store",
  });
  for (const cookie of outcome.setCookie) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/**
 * Locale for the sign-in failure page only.
 *
 * The callback path carries no locale and its pre-auth record — which does, in its
 * destination key — has already been consumed or was never there. `Accept-Language`
 * is the only signal left, and it decides nothing but which of two fixed sentences
 * is shown.
 */
export function languageFromAcceptLanguage(header: string | null): "en" | "fr" {
  return header?.toLowerCase().startsWith("fr") ? "fr" : "en";
}
