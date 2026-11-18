import { gate } from "@/actions/gate";
import { loginLocation, profileLocation } from "./destinations.ts";
import { log } from "./log.ts";

/**
 * Where a visitor goes when they arrive (AD-10).
 *
 * There is no signed-out landing page: `/` and `/fr` are redirects and nothing
 * else. A signed-in visitor is sent to their profile; everyone else — including
 * a visitor whose session has just expired — is sent straight to Managed Login.
 * `/profile` and `/fr/profile` answer the second half from their loaders, which
 * import `loginLocation` from `destinations.ts` directly: this module reaches
 * `gate()` and therefore `node:crypto`, so a loader importing it would drag the
 * whole server chain into the client bundle.
 *
 * Both `Location` values are built in `destinations.ts` from keys into the
 * server-side allow-list, so nothing from the request can reach a `Location`
 * header. The session answer comes from the same `gate()` every loader and
 * server function uses, so "is this session still valid" has one definition.
 */

export type Locale = "en" | "fr";

/** `GET /` and `GET /fr` — never a page, always one of two redirects. */
export async function entryRedirect(locale: Locale): Promise<Response> {
  const session = await gate(false);
  const signedIn = session.state === "ok";

  log("info", {
    route: locale === "fr" ? "/fr" : "/",
    status: 302,
    code: signedIn ? "entry_to_profile" : "entry_to_login",
  });

  return new Response(null, {
    status: 302,
    headers: new Headers([
      ["location", signedIn ? profileLocation(locale) : loginLocation(locale)],
      // A cached entry redirect would send the next visitor on this browser to
      // whichever side of the gate the first one happened to be on.
      ["cache-control", "no-store"],
    ]),
  });
}
