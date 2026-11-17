import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";

import { completeCallback } from "@/server/auth-flow";
import { parseCookies } from "@/server/cookies";
import { authFailurePage } from "@/server/error-page";
import { redirectResponse, languageFromAcceptLanguage } from "@/server/responses";
import { runtime } from "@/server/runtime";
import { PREAUTH_COOKIE } from "@/server/sessions";

/**
 * `GET /auth/callback`
 *
 * The one registered callback. Every refusal happens before a token exchange and
 * renders a non-recoverable page rather than redirecting, so nothing from the
 * request is ever reflected.
 */
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async () => {
        const deps = runtime();
        const request = getRequest();
        const url = new URL(request.url);

        const outcome = await completeCallback(deps, {
          query: url.searchParams,
          preAuthCookie: parseCookies(request.headers.get("cookie"))[PREAUTH_COOKIE],
        });

        if (outcome.kind === "failure") {
          return authFailurePage({
            code: outcome.code,
            status: outcome.status,
            language: languageFromAcceptLanguage(request.headers.get("accept-language")),
            setCookie: outcome.setCookie,
          });
        }

        return redirectResponse(outcome);
      },
    },
  },
});
