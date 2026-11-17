import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";

import { signOut } from "@/server/auth-flow";
import { parseCookies } from "@/server/cookies";
import { log } from "@/server/log";
import { checkOrigin } from "@/server/origin";
import { redirectResponse } from "@/server/responses";
import { runtime } from "@/server/runtime";
import { SESSION_COOKIE } from "@/server/sessions";

/**
 * `POST /auth/signout`
 *
 * POST and `Origin`-verified, like every other state change: a GET sign-out is
 * triggerable by any third-party page embedding an image. It is a plain form
 * submit so it works with no JavaScript, and a browser always sends `Origin` on a
 * cross-origin form POST — which is exactly the request this refuses.
 *
 * It revokes only THIS session's refresh token on the web client. The desktop app
 * holds its own session and is unaffected (AD-10).
 */
export const Route = createFileRoute("/auth/signout")({
  server: {
    handlers: {
      POST: async () => {
        const deps = runtime();
        const request = getRequest();

        const origin = checkOrigin(request.headers.get("origin"), deps.config.publicOrigin);
        if (origin !== "ok") {
          log("warn", { route: "/auth/signout", status: 403, code: `origin_${origin}` });
          return new Response(null, {
            status: 403,
            headers: { "cache-control": "no-store" },
          });
        }

        return redirectResponse(
          await signOut(deps, {
            sessionCookie: parseCookies(request.headers.get("cookie"))[SESSION_COOKIE],
          }),
        );
      },

      // A GET changes nothing at all — not even the cookie. Clearing it would make
      // a third-party `<img src="/auth/signout">` a working logout CSRF, and
      // "every state change is a verified non-GET" has no useful exception.
      GET: () =>
        new Response(null, {
          status: 302,
          headers: new Headers([
            ["location", "/"],
            ["cache-control", "no-store"],
          ]),
        }),
    },
  },
});
