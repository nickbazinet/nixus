import { createFileRoute } from "@tanstack/react-router";

import { entryRedirect } from "@/server/entry";

/** `GET /fr` — the French half of the entry redirect. See `routes/index.tsx`. */
export const Route = createFileRoute("/fr/")({
  server: { handlers: { GET: () => entryRedirect("fr") } },
});
