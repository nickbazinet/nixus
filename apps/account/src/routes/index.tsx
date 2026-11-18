import { createFileRoute } from "@tanstack/react-router";

import { entryRedirect } from "@/server/entry";

/**
 * `GET /`
 *
 * Signed in → the profile. Signed out or expired → Managed Login. There is no
 * page here: the signed-out landing page it replaced was a dead end that showed
 * a visitor a heading and asked them to press a button to do the only thing the
 * site does.
 */
export const Route = createFileRoute("/")({
  server: { handlers: { GET: () => entryRedirect("en") } },
});
