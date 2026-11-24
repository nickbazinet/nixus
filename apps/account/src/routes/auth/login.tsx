import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";

import { beginLogin } from "@/server/auth-flow";
import { redirectResponse } from "@/server/responses";
import { runtime } from "@/server/runtime";

/**
 * `GET /auth/login?next=<destination key>&lang=fr&plan=<lookup key>`
 *
 * Opens one attempt: a single-use pre-auth record holding `state`, `nonce`, the
 * PKCE verifier and the plan the visitor asked for, bound to the browser by a
 * `__Host-` cookie, then a 302 to Managed Login. `next` is a KEY into the
 * server-side destination map, never a URL; `plan` is shape-checked against the
 * billing contract and kept server-side until the callback re-attaches it to a
 * billing destination.
 */
export const Route = createFileRoute("/auth/login")({
  server: {
    handlers: {
      GET: async () => {
        const deps = runtime();
        const url = new URL(getRequest().url);
        const language = url.searchParams.get("lang") === "fr" ? "fr" : "en";

        return redirectResponse(
          await beginLogin(deps, {
            next: url.searchParams.get("next"),
            plan: url.searchParams.get("plan"),
            language,
          }),
        );
      },
    },
  },
});
